"""Unified agent runtime invoker.

This module centralizes the LLM/tool loop so websocket chat, task execution,
heartbeat, scheduler, and agent-to-agent flows can share the same runtime.
"""

from __future__ import annotations

import inspect
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import select

from app.database import async_session
from app.kernel import AgentKernel, ExecutionIdentityRef, InvocationRequest, KernelDependencies, RuntimeConfig, ToolExpansionResult
from app.models.agent import Agent
from app.models.user import User
from app.runtime.context import RuntimeContext
from app.runtime.prompt_builder import build_runtime_prompt
from app.runtime.session import SessionContext
from app.skills import SkillParser, SkillRegistry, WorkspaceSkillLoader
from app.services.agent_context import build_agent_context
from app.services.agent_tools import AGENT_TOOLS, execute_tool, get_agent_tools_for_llm
from app.services.knowledge_inject import fetch_relevant_knowledge
from app.services.llm_utils import LLMMessage, create_llm_client, get_max_tokens
from app.services.memory_service import (
    build_memory_context,
    maybe_compress_messages,
    persist_runtime_memory,
)
from app.services.token_tracker import (
    estimate_tokens_from_chars,
    extract_usage_tokens,
    record_token_usage,
)
from app.tools import ensure_workspace
from app.tools.packs import TOOL_PACKS

logger = logging.getLogger(__name__)

ChunkCallback = Callable[[str], Awaitable[None] | None]
ThinkingCallback = Callable[[str], Awaitable[None] | None]
ToolCallback = Callable[[dict], Awaitable[None] | None]
ToolExecutor = Callable[[str, dict], Awaitable[str] | str]
EventCallback = Callable[[dict], Awaitable[None] | None]


@dataclass(slots=True)
class AgentInvocationRequest:
    model: Any
    messages: list[dict]
    agent_name: str
    role_description: str
    agent_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    execution_identity: ExecutionIdentityRef | None = None
    on_chunk: ChunkCallback | None = None
    on_tool_call: ToolCallback | None = None
    on_thinking: ThinkingCallback | None = None
    on_event: EventCallback | None = None
    supports_vision: bool = False
    memory_context: str = ""
    memory_session_id: str | None = None
    memory_messages: list[dict] | None = None
    session_context: SessionContext | None = None
    system_prompt_suffix: str = ""
    tool_executor: ToolExecutor | None = None
    initial_tools: list[dict] | None = None
    core_tools_only: bool = True
    expand_tools: bool = True
    max_tool_rounds: int | None = None


@dataclass(slots=True)
class AgentInvocationResult:
    content: str
    tokens_used: int = 0
    final_tools: list[dict] | None = None
    parts: list[dict] | None = None


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _resolve_runtime_config(agent_id: uuid.UUID | None) -> RuntimeConfig:
    if not agent_id:
        return RuntimeConfig(tenant_id=None, max_tool_rounds=50)

    try:
        async with async_session() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent:
                return RuntimeConfig(tenant_id=None, max_tool_rounds=50)

            quota_message = None
            if agent.max_tokens_per_day and agent.tokens_used_today >= agent.max_tokens_per_day:
                quota_message = (
                    f"⚠️ Daily token usage has reached the limit "
                    f"({agent.tokens_used_today:,}/{agent.max_tokens_per_day:,}). "
                    "Please try again tomorrow or ask admin to increase the limit."
                )
            elif agent.max_tokens_per_month and agent.tokens_used_month >= agent.max_tokens_per_month:
                quota_message = (
                    f"⚠️ Monthly token usage has reached the limit "
                    f"({agent.tokens_used_month:,}/{agent.max_tokens_per_month:,}). "
                    "Please ask admin to increase the limit."
                )

            return RuntimeConfig(
                tenant_id=agent.tenant_id,
                max_tool_rounds=agent.max_tool_rounds or 50,
                quota_message=quota_message,
            )
    except Exception as exc:
        logger.warning("Failed to resolve runtime config for agent %s: %s", agent_id, exc)
        return RuntimeConfig(tenant_id=None, max_tool_rounds=50)


async def _resolve_current_user_name(user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None

    try:
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                return user.display_name or user.username
    except Exception as exc:
        logger.debug("Failed to resolve current user name for %s: %s", user_id, exc)
    return None


def _apply_vision_transform(api_messages: list[LLMMessage], supports_vision: bool) -> list[LLMMessage]:
    if supports_vision:
        image_pattern = r"\[image_data:(data:image/[^;]+;base64,[A-Za-z0-9+/=]+)\]"
        for i, msg in enumerate(api_messages):
            if msg.role != "user" or not isinstance(msg.content, str):
                continue
            images = re.findall(image_pattern, msg.content)
            if not images:
                continue
            text = re.sub(image_pattern, "", msg.content).strip()
            parts: list[dict[str, Any]] = []
            for image_url in images:
                parts.append({"type": "image_url", "image_url": {"url": image_url}})
            if text:
                parts.append({"type": "text", "text": text})
            api_messages[i] = LLMMessage(role=msg.role, content=parts)  # type: ignore[arg-type]
        return api_messages

    strip_pattern = r"\[image_data:data:image/[^;]+;base64,[A-Za-z0-9+/=]+\]"
    for i, msg in enumerate(api_messages):
        if msg.role != "user" or not isinstance(msg.content, str) or "[image_data:" not in msg.content:
            continue
        image_count = len(re.findall(strip_pattern, msg.content))
        cleaned = re.sub(strip_pattern, "", msg.content).strip()
        if image_count > 0:
            cleaned += f"\n[用户发送了 {image_count} 张图片，但当前模型不支持视觉，无法查看图片内容]"
        api_messages[i] = LLMMessage(role=msg.role, content=cleaned)
    return api_messages


async def _build_system_prompt(
    request: AgentInvocationRequest,
    tenant_id: uuid.UUID | None,
    resolved_memory_context: str,
    current_user_name: str | None = None,
) -> str:
    if current_user_name is None:
        current_user_name = await _resolve_current_user_name(request.user_id)
    runtime_context = RuntimeContext(
        session=request.session_context or SessionContext(),
        tenant_id=tenant_id,
    )
    return await build_runtime_prompt(
        agent_id=request.agent_id,
        agent_name=request.agent_name,
        role_description=request.role_description,
        messages=request.messages,
        tenant_id=tenant_id,
        current_user_name=current_user_name,
        memory_context=resolved_memory_context,
        system_prompt_suffix=request.system_prompt_suffix,
        runtime_context=runtime_context,
        build_agent_context_fn=build_agent_context,
        fetch_relevant_knowledge_fn=fetch_relevant_knowledge,
    )


async def _resolve_memory_context(
    request: AgentInvocationRequest,
    tenant_id: uuid.UUID | None,
) -> str:
    parts: list[str] = []
    session_id = request.memory_session_id
    if not session_id and request.session_context:
        session_id = request.session_context.session_id

    if request.agent_id and tenant_id:
        runtime_memory_context = await build_memory_context(
            request.agent_id,
            tenant_id,
            session_id=session_id,
        )
        if runtime_memory_context:
            parts.append(runtime_memory_context)

    if request.memory_context:
        parts.append(request.memory_context)

    return "\n\n".join(parts)


def _build_skill_registry_for_workspace(workspace: Any) -> SkillRegistry:
    loader = WorkspaceSkillLoader()
    registry = SkillRegistry()
    registry.register_many(loader.load_from_workspace(workspace))
    return registry


def _serialize_pack(pack) -> dict[str, Any]:
    return {
        "name": pack.name,
        "summary": pack.summary,
        "source": pack.source,
        "activation_mode": pack.activation_mode,
        "tools": list(pack.tools),
    }


def _infer_active_packs(tool_names: list[str], *, skill_name: str | None = None) -> list[dict[str, Any]]:
    requested = set(tool_names)
    packs = [
        _serialize_pack(pack)
        for pack in TOOL_PACKS
        if requested.intersection(pack.tools)
    ]
    if packs or not requested:
        return packs
    synthetic_name = f"skill:{(skill_name or 'custom').strip().lower().replace(' ', '_')}"
    return [{
        "name": synthetic_name,
        "summary": f"Tools activated by skill {skill_name or 'custom skill'}",
        "source": "skill",
        "activation_mode": "通过 load_skill 激活",
        "tools": sorted(requested),
        "skill_name": skill_name,
    }]


async def _resolve_tool_expansion(
    request: AgentInvocationRequest,
    tool_name: str,
    args: dict[str, Any],
) -> ToolExpansionResult | list[dict] | None:
    if not request.agent_id:
        return None

    if tool_name in {"discover_resources", "import_mcp_server"}:
        tools = await get_agent_tools_for_llm(
            request.agent_id,
            core_only=False,
            requested_names=[
                "discover_resources",
                "import_mcp_server",
                "list_mcp_resources",
                "read_mcp_resource",
            ],
        )
        packs = _infer_active_packs(["discover_resources", "import_mcp_server", "list_mcp_resources", "read_mcp_resource"])
        return ToolExpansionResult(
            tools=tools,
            active_packs=packs,
            event_payload={
                "type": "pack_activation",
                "packs": packs,
                "message": "Activated MCP capability pack.",
                "status": "info",
                "trigger_tool": tool_name,
            },
        )

    try:
        workspace = await ensure_workspace(request.agent_id)
        registry = _build_skill_registry_for_workspace(workspace)
    except Exception:
        return await get_agent_tools_for_llm(request.agent_id, core_only=False)

    if tool_name == "load_skill":
        requested = str(args.get("name", "") or "").strip()
        if not requested:
            return None
        try:
            skill = registry.resolve(requested)
        except KeyError:
            return None
        if not skill.metadata.declared_tools:
            return None
        tools = await get_agent_tools_for_llm(
            request.agent_id,
            core_only=False,
            requested_names=list(skill.metadata.declared_tools),
        )
        packs = _infer_active_packs(list(skill.metadata.declared_tools), skill_name=skill.metadata.name)
        return ToolExpansionResult(
            tools=tools,
            active_packs=packs,
            event_payload={
                "type": "pack_activation",
                "packs": packs,
                "message": f"Activated capability packs after loading skill: {skill.metadata.name}",
                "status": "info",
                "skill_name": skill.metadata.name,
                "trigger_tool": tool_name,
            },
        )

    if tool_name == "read_file":
        skill_path_arg = str(args.get("path", "") or "").strip()
        if "SKILL.md" not in skill_path_arg:
            return None
        skill_path = (workspace / skill_path_arg).resolve()
        skills_root = (workspace / "skills").resolve()
        if not skill_path.is_file() or not str(skill_path).startswith(str(skills_root)):
            return None
        parsed = SkillParser().parse_file(
            skill_path,
            relative_path=skill_path.relative_to(workspace).as_posix(),
            default_name=skill_path.parent.name if skill_path.name.lower() == "skill.md" else skill_path.stem,
        )
        if not parsed.metadata.declared_tools:
            return None
        tools = await get_agent_tools_for_llm(
            request.agent_id,
            core_only=False,
            requested_names=list(parsed.metadata.declared_tools),
        )
        packs = _infer_active_packs(list(parsed.metadata.declared_tools), skill_name=parsed.metadata.name)
        return ToolExpansionResult(
            tools=tools,
            active_packs=packs,
            event_payload={
                "type": "pack_activation",
                "packs": packs,
                "message": f"Activated capability packs from skill file: {parsed.metadata.name}",
                "status": "info",
                "skill_name": parsed.metadata.name,
                "trigger_tool": tool_name,
            },
        )

    return None


async def _execute_tool_with_request(
    tool_name: str,
    args: dict,
    request: AgentInvocationRequest,
    emit_event: Callable[[dict], Any],
) -> str:
    if request.tool_executor:
        return await _maybe_await(request.tool_executor(tool_name, args))

    execute_kwargs: dict[str, Any] = {
        "agent_id": request.agent_id,
        "user_id": request.user_id or request.agent_id,
    }
    if "event_callback" in inspect.signature(execute_tool).parameters:
        execute_kwargs["event_callback"] = emit_event
    return await execute_tool(
        tool_name,
        args,
        **execute_kwargs,
    )


def get_agent_kernel() -> AgentKernel:
    async def _kernel_build_system_prompt(
        request: InvocationRequest,
        tenant_id: uuid.UUID | None,
        resolved_memory_context: str,
        current_user_name: str | None,
    ) -> str:
        return await _build_system_prompt(
            request,  # type: ignore[arg-type]
            tenant_id,
            resolved_memory_context,
            current_user_name=current_user_name,
        )

    async def _kernel_resolve_memory_context(
        request: InvocationRequest,
        tenant_id: uuid.UUID | None,
    ) -> str:
        return await _resolve_memory_context(request, tenant_id)  # type: ignore[arg-type]

    async def _kernel_get_tools(agent_id: uuid.UUID, core_only: bool) -> list[dict]:
        return await _maybe_await(get_agent_tools_for_llm(agent_id, core_only=core_only))

    def _kernel_create_client(model: Any):
        return create_llm_client(
            provider=model.provider,
            api_key=model.api_key,
            model=model.model,
            base_url=model.base_url,
            timeout=120.0,
        )

    async def _kernel_execute_tool(
        tool_name: str,
        args: dict,
        request: InvocationRequest,
        emit_event: Callable[[dict], Any],
    ) -> str:
        return await _execute_tool_with_request(tool_name, args, request, emit_event)  # type: ignore[arg-type]

    return AgentKernel(
        KernelDependencies(
            resolve_runtime_config=_resolve_runtime_config,
            resolve_current_user_name=_resolve_current_user_name,
            build_system_prompt=_kernel_build_system_prompt,
            resolve_memory_context=_kernel_resolve_memory_context,
            get_tools=_kernel_get_tools,
            resolve_tool_expansion=_resolve_tool_expansion,
            maybe_compress_messages=maybe_compress_messages,
            create_client=_kernel_create_client,
            execute_tool=_kernel_execute_tool,
            persist_memory=persist_runtime_memory,
            record_token_usage=record_token_usage,
            get_max_tokens=get_max_tokens,
            extract_usage_tokens=extract_usage_tokens,
            estimate_tokens_from_chars=estimate_tokens_from_chars,
            apply_vision_transform=_apply_vision_transform,
        )
    )


async def invoke_agent(request: AgentInvocationRequest) -> AgentInvocationResult:
    execution_identity = request.execution_identity
    if execution_identity is None:
        try:
            from app.core.execution_context import get_execution_identity

            current_identity = get_execution_identity()
            if current_identity:
                execution_identity = ExecutionIdentityRef(
                    identity_type=current_identity.identity_type,
                    identity_id=current_identity.identity_id,
                    label=current_identity.label,
                )
        except Exception:
            execution_identity = None

    kernel_request = InvocationRequest(
        model=request.model,
        messages=request.messages,
        agent_name=request.agent_name,
        role_description=request.role_description,
        agent_id=request.agent_id,
        user_id=request.user_id,
        execution_identity=execution_identity,
        on_chunk=request.on_chunk,
        on_tool_call=request.on_tool_call,
        on_thinking=request.on_thinking,
        on_event=request.on_event,
        supports_vision=request.supports_vision,
        memory_context=request.memory_context,
        memory_session_id=request.memory_session_id,
        memory_messages=request.memory_messages,
        session_context=request.session_context,
        system_prompt_suffix=request.system_prompt_suffix,
        tool_executor=request.tool_executor,
        initial_tools=request.initial_tools or (AGENT_TOOLS if request.agent_id is None else None),
        core_tools_only=request.core_tools_only,
        expand_tools=request.expand_tools,
        max_tool_rounds=request.max_tool_rounds,
    )

    result = await get_agent_kernel().handle(kernel_request)
    return AgentInvocationResult(
        content=result.content,
        tokens_used=result.tokens_used,
        final_tools=result.final_tools,
        parts=result.parts,
    )
