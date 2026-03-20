"""Unified agent runtime invoker.

This module centralizes the LLM/tool loop so websocket chat, task execution,
heartbeat, scheduler, and agent-to-agent flows can share the same runtime.
"""

from __future__ import annotations

import inspect
import json
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import select

from app.database import async_session
from app.models.agent import Agent
from app.models.user import User
from app.services.agent_context import build_agent_context
from app.services.agent_tools import AGENT_TOOLS, execute_tool, get_agent_tools_for_llm
from app.services.knowledge_inject import fetch_relevant_knowledge
from app.services.llm_utils import LLMError, LLMMessage, create_llm_client, get_max_tokens
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
    on_chunk: ChunkCallback | None = None
    on_tool_call: ToolCallback | None = None
    on_thinking: ThinkingCallback | None = None
    on_event: EventCallback | None = None
    supports_vision: bool = False
    memory_context: str = ""
    memory_session_id: str | None = None
    memory_messages: list[dict] | None = None
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


@dataclass(slots=True)
class _RuntimeConfig:
    tenant_id: uuid.UUID | None
    max_tool_rounds: int
    quota_message: str | None = None


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _resolve_runtime_config(agent_id: uuid.UUID | None) -> _RuntimeConfig:
    if not agent_id:
        return _RuntimeConfig(tenant_id=None, max_tool_rounds=50)

    try:
        async with async_session() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent:
                return _RuntimeConfig(tenant_id=None, max_tool_rounds=50)

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

            return _RuntimeConfig(
                tenant_id=agent.tenant_id,
                max_tool_rounds=agent.max_tool_rounds or 50,
                quota_message=quota_message,
            )
    except Exception as exc:
        logger.warning("Failed to resolve runtime config for agent %s: %s", agent_id, exc)
        return _RuntimeConfig(tenant_id=None, max_tool_rounds=50)


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
) -> str:
    current_user_name = await _resolve_current_user_name(request.user_id)
    system_prompt = await build_agent_context(
        request.agent_id,
        request.agent_name,
        request.role_description,
        current_user_name=current_user_name,
    )

    last_user_msg = next(
        (m["content"] for m in reversed(request.messages) if m.get("role") == "user" and isinstance(m.get("content"), str)),
        None,
    )
    if request.agent_id and last_user_msg:
        knowledge = await _maybe_await(fetch_relevant_knowledge(last_user_msg, tenant_id=tenant_id))
        if knowledge:
            system_prompt += "\n\n" + knowledge

    if resolved_memory_context:
        system_prompt += "\n\n" + resolved_memory_context

    if request.system_prompt_suffix:
        system_prompt += "\n\n" + request.system_prompt_suffix

    return system_prompt


async def _resolve_memory_context(
    request: AgentInvocationRequest,
    tenant_id: uuid.UUID | None,
) -> str:
    parts: list[str] = []

    if request.agent_id and tenant_id:
        runtime_memory_context = await build_memory_context(
            request.agent_id,
            tenant_id,
            session_id=request.memory_session_id,
        )
        if runtime_memory_context:
            parts.append(runtime_memory_context)

    if request.memory_context:
        parts.append(request.memory_context)

    return "\n\n".join(parts)


def _build_persisted_memory_messages(
    request: AgentInvocationRequest,
    final_content: str,
) -> list[dict]:
    base_messages = list(request.memory_messages or request.messages)
    if final_content and not final_content.startswith("[LLM") and not final_content.startswith("[Error]"):
        base_messages.append({"role": "assistant", "content": final_content})
    return base_messages


async def _default_tool_executor_factory(request: AgentInvocationRequest) -> ToolExecutor:
    async def _emit_event(data: dict[str, Any]) -> None:
        if request.on_event:
            await _maybe_await(request.on_event(data))

    async def _executor(tool_name: str, args: dict) -> str:
        execute_kwargs: dict[str, Any] = {
            "agent_id": request.agent_id,
            "user_id": request.user_id or request.agent_id,
        }
        if "event_callback" in inspect.signature(execute_tool).parameters:
            execute_kwargs["event_callback"] = _emit_event
        return await execute_tool(
            tool_name,
            args,
            **execute_kwargs,
        )

    return _executor


async def invoke_agent(request: AgentInvocationRequest) -> AgentInvocationResult:
    runtime_config = await _resolve_runtime_config(request.agent_id)
    if runtime_config.quota_message:
        return AgentInvocationResult(content=runtime_config.quota_message)

    resolved_memory_context = await _resolve_memory_context(request, runtime_config.tenant_id)
    system_prompt = await _build_system_prompt(request, runtime_config.tenant_id, resolved_memory_context)

    tools_for_llm = request.initial_tools
    if tools_for_llm is None:
        if request.agent_id:
            tools_for_llm = await _maybe_await(
                get_agent_tools_for_llm(request.agent_id, core_only=request.core_tools_only)
            )
        else:
            tools_for_llm = AGENT_TOOLS

    async def _emit_compaction_event(data: dict[str, Any]) -> None:
        if request.on_event:
            await _maybe_await(request.on_event({
                "type": "session_compact",
                **data,
            }))

    messages = await maybe_compress_messages(
        request.messages,
        model_provider=request.model.provider,
        model_name=request.model.model,
        max_input_tokens_override=getattr(request.model, "max_input_tokens", None),
        tenant_id=runtime_config.tenant_id,
        on_compaction=_emit_compaction_event if request.on_event else None,
    )

    api_messages = [LLMMessage(role="system", content=system_prompt)]
    for msg in messages:
        api_messages.append(
            LLMMessage(
                role=msg.get("role", "user"),
                content=msg.get("content"),
                tool_calls=msg.get("tool_calls"),
                tool_call_id=msg.get("tool_call_id"),
                reasoning_content=msg.get("reasoning_content"),
            )
        )
    api_messages = _apply_vision_transform(api_messages, request.supports_vision)

    try:
        client = create_llm_client(
            provider=request.model.provider,
            api_key=request.model.api_key,
            model=request.model.model,
            base_url=request.model.base_url,
            timeout=120.0,
        )
    except Exception as exc:
        return AgentInvocationResult(content=f"[Error] Failed to create LLM client: {exc}")

    max_rounds = request.max_tool_rounds or runtime_config.max_tool_rounds
    max_tokens = get_max_tokens(
        request.model.provider,
        request.model.model,
        getattr(request.model, "max_output_tokens", None),
    )
    accumulated_tokens = 0
    full_toolset = None
    tool_executor = request.tool_executor or await _default_tool_executor_factory(request)

    try:
        for round_i in range(max_rounds):
            warn_threshold_80 = int(max_rounds * 0.8)
            warn_threshold_96 = max_rounds - 2
            if round_i == warn_threshold_80:
                api_messages.append(
                    LLMMessage(
                        role="system",
                        content=(
                            f"⚠️ 你已使用 {round_i}/{max_rounds} 轮工具调用。"
                            "如果当前任务尚未完成，请尽快保存进度到 focus.md，"
                            "并使用 set_trigger 设置续接触发器，在剩余轮次中做好收尾。"
                        ),
                    )
                )
            elif round_i == warn_threshold_96:
                api_messages.append(
                    LLMMessage(
                        role="system",
                        content="🚨 仅剩 2 轮工具调用。请立即保存进度到 focus.md 并设置续接触发器。",
                    )
                )

            try:
                response = await client.stream(
                    messages=api_messages,
                    tools=tools_for_llm if tools_for_llm else None,
                    temperature=0.7,
                    max_tokens=max_tokens,
                    on_chunk=request.on_chunk,
                    on_thinking=request.on_thinking,
                )
            except LLMError as exc:
                logger.error(
                    "[Runtime] LLMError provider=%s model=%s round=%s: %s",
                    getattr(request.model, "provider", "?"),
                    getattr(request.model, "model", "?"),
                    round_i + 1,
                    exc,
                )
                if request.agent_id and accumulated_tokens > 0:
                    await _maybe_await(record_token_usage(request.agent_id, accumulated_tokens))
                return AgentInvocationResult(content=f"[LLM Error] {exc}", tokens_used=accumulated_tokens)
            except Exception as exc:
                logger.error(
                    "[Runtime] Unexpected error provider=%s model=%s round=%s: %s: %s",
                    getattr(request.model, "provider", "?"),
                    getattr(request.model, "model", "?"),
                    round_i + 1,
                    type(exc).__name__,
                    str(exc)[:300],
                )
                if request.agent_id and accumulated_tokens > 0:
                    await _maybe_await(record_token_usage(request.agent_id, accumulated_tokens))
                return AgentInvocationResult(
                    content=f"[LLM call error] {type(exc).__name__}: {str(exc)[:200]}",
                    tokens_used=accumulated_tokens,
                )

            real_tokens = extract_usage_tokens(response.usage)
            if real_tokens:
                accumulated_tokens += real_tokens
            else:
                round_chars = (
                    sum(len(m.content or "") if isinstance(m.content, str) else 0 for m in api_messages)
                    + len(response.content or "")
                )
                accumulated_tokens += estimate_tokens_from_chars(round_chars)

            if not response.tool_calls:
                final_content = response.content or "[LLM returned empty content]"
                if request.agent_id and runtime_config.tenant_id:
                    try:
                        await persist_runtime_memory(
                            agent_id=request.agent_id,
                            session_id=request.memory_session_id,
                            tenant_id=runtime_config.tenant_id,
                            messages=_build_persisted_memory_messages(request, final_content),
                        )
                    except Exception as exc:
                        logger.warning(
                            "[Runtime] Failed to persist memory for agent %s: %s",
                            request.agent_id,
                            exc,
                        )
                if request.agent_id and accumulated_tokens > 0:
                    await _maybe_await(record_token_usage(request.agent_id, accumulated_tokens))
                return AgentInvocationResult(
                    content=final_content,
                    tokens_used=accumulated_tokens,
                    final_tools=tools_for_llm,
                )

            api_messages.append(
                LLMMessage(
                    role="assistant",
                    content=response.content or None,
                    tool_calls=[{
                        "id": tc["id"],
                        "type": "function",
                        "function": tc["function"],
                    } for tc in response.tool_calls],
                    reasoning_content=response.reasoning_content,
                )
            )

            full_reasoning_content = response.reasoning_content or ""

            for tc in response.tool_calls:
                fn = tc["function"]
                tool_name = fn["name"]
                raw_args = fn.get("arguments", "{}")
                try:
                    args = json.loads(raw_args) if raw_args else {}
                except json.JSONDecodeError:
                    args = {}

                if request.on_tool_call:
                    await _maybe_await(
                        request.on_tool_call(
                            {
                                "name": tool_name,
                                "args": args,
                                "status": "running",
                                "reasoning_content": full_reasoning_content,
                            }
                        )
                    )

                result = await _maybe_await(tool_executor(tool_name, args))

                if request.expand_tools and request.agent_id and full_toolset is None:
                    should_expand = (
                        tool_name == "read_file" and "SKILL.md" in str(args.get("path", ""))
                    ) or round_i >= 2
                    if should_expand:
                        full_toolset = await _maybe_await(
                            get_agent_tools_for_llm(request.agent_id, core_only=False)
                        )
                        tools_for_llm = full_toolset

                if request.on_tool_call:
                    await _maybe_await(
                        request.on_tool_call(
                            {
                                "name": tool_name,
                                "args": args,
                                "status": "done",
                                "result": result,
                                "reasoning_content": full_reasoning_content,
                            }
                        )
                    )

                api_messages.append(
                    LLMMessage(
                        role="tool",
                        tool_call_id=tc["id"],
                        content=str(result),
                    )
                )

        if request.agent_id and accumulated_tokens > 0:
            await _maybe_await(record_token_usage(request.agent_id, accumulated_tokens))
        return AgentInvocationResult(
            content="[Error] Too many tool call rounds",
            tokens_used=accumulated_tokens,
            final_tools=tools_for_llm,
        )
    finally:
        await client.close()
