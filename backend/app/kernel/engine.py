"""Unified agent kernel implementation."""

from __future__ import annotations

import inspect
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.core.execution_context import (
    ExecutionIdentity,
    clear_execution_identity,
    get_execution_identity,
    set_execution_identity,
)
from app.kernel.contracts import InvocationRequest, InvocationResult, RuntimeConfig
from app.runtime.session import SessionContext
from app.services.chat_message_parts import (
    build_active_packs_event,
    build_compaction_event,
    build_done_event,
    build_permission_event,
    build_tool_call_event,
)
from app.services.llm_utils import LLMError, LLMMessage

logger = logging.getLogger(__name__)


ResolveRuntimeConfig = Callable[[Any], Awaitable[RuntimeConfig] | RuntimeConfig]
ResolveCurrentUserName = Callable[[Any], Awaitable[str | None] | str | None]
BuildSystemPrompt = Callable[[InvocationRequest, Any, str, str | None], Awaitable[str] | str]
ResolveMemoryContext = Callable[[InvocationRequest, Any], Awaitable[str] | str]
GetTools = Callable[[Any, bool], Awaitable[list[dict]] | list[dict]]
ResolveToolExpansion = Callable[
    [InvocationRequest, str, dict[str, Any]],
    Awaitable["ToolExpansionResult | list[dict] | None"] | "ToolExpansionResult | list[dict] | None",
]
MaybeCompressMessages = Callable[..., Awaitable[list[dict]] | list[dict]]
CreateClient = Callable[[Any], Any]
ExecuteTool = Callable[[str, dict, InvocationRequest, Callable[[dict], Awaitable[None]]], Awaitable[str] | str]
PersistMemory = Callable[..., Awaitable[None] | None]
RecordTokenUsage = Callable[[Any, int], Awaitable[None] | None]
GetMaxTokens = Callable[[str, str, int | None], int]
ExtractUsageTokens = Callable[[dict | None], int | None]
EstimateTokensFromChars = Callable[[int], int]
ApplyVisionTransform = Callable[[list[LLMMessage], bool], list[LLMMessage]]


@dataclass(slots=True)
class KernelDependencies:
    resolve_runtime_config: ResolveRuntimeConfig
    resolve_current_user_name: ResolveCurrentUserName
    build_system_prompt: BuildSystemPrompt
    resolve_memory_context: ResolveMemoryContext
    get_tools: GetTools
    maybe_compress_messages: MaybeCompressMessages
    create_client: CreateClient
    execute_tool: ExecuteTool
    persist_memory: PersistMemory
    record_token_usage: RecordTokenUsage
    get_max_tokens: GetMaxTokens
    extract_usage_tokens: ExtractUsageTokens
    estimate_tokens_from_chars: EstimateTokensFromChars
    resolve_tool_expansion: ResolveToolExpansion | None = None
    apply_vision_transform: ApplyVisionTransform | None = None


@dataclass(slots=True)
class ToolExpansionResult:
    tools: list[dict]
    active_packs: list[dict[str, Any]]
    event_payload: dict[str, Any] | None = None


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _build_persisted_memory_messages(request: InvocationRequest, final_content: str) -> list[dict]:
    base_messages = list(request.memory_messages or request.messages)
    if final_content and not final_content.startswith("[LLM") and not final_content.startswith("[Error]"):
        base_messages.append({"role": "assistant", "content": final_content})
    return base_messages


def _build_error_result(message: str, *, tokens_used: int = 0, final_tools: list[dict] | None = None) -> InvocationResult:
    return InvocationResult(
        content=message,
        tokens_used=tokens_used,
        final_tools=final_tools,
        parts=[{"type": "text", "text": message}],
    )


def _event_to_part(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = event.get("type")
    if event_type == "permission":
        return build_permission_event(event)["part"]
    if event_type == "session_compact":
        payload = dict(event)
        payload.pop("type", None)
        return build_compaction_event(payload)["part"]
    if event_type == "pack_activation":
        payload = dict(event)
        payload.pop("type", None)
        return build_active_packs_event(payload)["part"]
    if isinstance(event.get("part"), dict):
        return event["part"]
    return None


def _should_expand_tools(tool_name: str, args: dict[str, Any]) -> bool:
    if tool_name in {"load_skill", "discover_resources", "import_mcp_server"}:
        return True
    if tool_name == "read_file" and "SKILL.md" in str(args.get("path", "")):
        return True
    return False


def _merge_active_packs(
    session_context,
    packs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    existing = list(getattr(session_context, "active_packs", []) or [])
    existing_names = {pack.get("name") for pack in existing}
    new_packs: list[dict[str, Any]] = []
    for pack in packs:
        name = pack.get("name")
        if not name or name in existing_names:
            continue
        existing.append(pack)
        new_packs.append(pack)
        existing_names.add(name)
    session_context.active_packs = existing
    return new_packs


class AgentKernel:
    """Single runtime kernel for all agent invocations."""

    def __init__(self, dependencies: KernelDependencies) -> None:
        self._deps = dependencies

    async def handle(self, request: InvocationRequest) -> InvocationResult:
        previous_identity = get_execution_identity()
        if request.execution_identity:
            set_execution_identity(
                ExecutionIdentity(
                    identity_type=request.execution_identity.identity_type,
                    identity_id=request.execution_identity.identity_id,
                    label=request.execution_identity.label or request.execution_identity.identity_type,
                )
            )
        try:
            runtime_config = await _maybe_await(self._deps.resolve_runtime_config(request.agent_id))
            if runtime_config.quota_message:
                return _build_error_result(runtime_config.quota_message)

            resolved_memory_context = await _maybe_await(
                self._deps.resolve_memory_context(request, runtime_config.tenant_id)
            )
            current_user_name = await _maybe_await(self._deps.resolve_current_user_name(request.user_id))
            system_prompt = await _maybe_await(
                self._deps.build_system_prompt(
                    request,
                    runtime_config.tenant_id,
                    resolved_memory_context,
                    current_user_name,
                )
            )

            tools_for_llm = request.initial_tools
            if tools_for_llm is None:
                if request.agent_id:
                    tools_for_llm = await _maybe_await(
                        self._deps.get_tools(request.agent_id, request.core_tools_only)
                    )
                else:
                    tools_for_llm = []

            collected_parts: list[dict[str, Any]] = []

            async def _emit_event(event: dict[str, Any]) -> None:
                if request.on_event:
                    await _maybe_await(request.on_event(event))
                part = _event_to_part(event)
                if part:
                    collected_parts.append(part)

            async def _emit_compaction_event(data: dict[str, Any]) -> None:
                await _emit_event({"type": "session_compact", **data})

            messages = await _maybe_await(
                self._deps.maybe_compress_messages(
                    request.messages,
                    model_provider=request.model.provider,
                    model_name=request.model.model,
                    max_input_tokens_override=getattr(request.model, "max_input_tokens", None),
                    tenant_id=runtime_config.tenant_id,
                    on_compaction=_emit_compaction_event,
                )
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

            if self._deps.apply_vision_transform:
                api_messages = self._deps.apply_vision_transform(api_messages, request.supports_vision)

            try:
                client = self._deps.create_client(request.model)
            except Exception as exc:
                return _build_error_result(f"[Error] Failed to create LLM client: {exc}")

            max_rounds = request.max_tool_rounds or runtime_config.max_tool_rounds
            max_tokens = self._deps.get_max_tokens(
                request.model.provider,
                request.model.model,
                getattr(request.model, "max_output_tokens", None),
            )
            accumulated_tokens = 0
            full_toolset = None

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
                        if request.agent_id and accumulated_tokens > 0:
                            await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                        logger.error(
                            "[Kernel] LLMError provider=%s model=%s round=%s: %s",
                            getattr(request.model, "provider", "?"),
                            getattr(request.model, "model", "?"),
                            round_i + 1,
                            exc,
                        )
                        return _build_error_result(f"[LLM Error] {exc}", tokens_used=accumulated_tokens)
                    except Exception as exc:
                        if request.agent_id and accumulated_tokens > 0:
                            await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                        logger.error(
                            "[Kernel] Unexpected error provider=%s model=%s round=%s: %s: %s",
                            getattr(request.model, "provider", "?"),
                            getattr(request.model, "model", "?"),
                            round_i + 1,
                            type(exc).__name__,
                            str(exc)[:300],
                        )
                        return _build_error_result(
                            f"[LLM call error] {type(exc).__name__}: {str(exc)[:200]}",
                            tokens_used=accumulated_tokens,
                        )

                    real_tokens = self._deps.extract_usage_tokens(response.usage)
                    if real_tokens:
                        accumulated_tokens += real_tokens
                    else:
                        round_chars = (
                            sum(len(m.content or "") if isinstance(m.content, str) else 0 for m in api_messages)
                            + len(response.content or "")
                        )
                        accumulated_tokens += self._deps.estimate_tokens_from_chars(round_chars)

                    if not response.tool_calls:
                        final_content = response.content or "[LLM returned empty content]"
                        if request.agent_id and runtime_config.tenant_id:
                            try:
                                await _maybe_await(
                                    self._deps.persist_memory(
                                        agent_id=request.agent_id,
                                        session_id=request.memory_session_id,
                                        tenant_id=runtime_config.tenant_id,
                                        messages=_build_persisted_memory_messages(request, final_content),
                                    )
                                )
                            except Exception as exc:
                                logger.warning("[Kernel] Failed to persist memory for agent %s: %s", request.agent_id, exc)
                        if request.agent_id and accumulated_tokens > 0:
                            await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                        return InvocationResult(
                            content=final_content,
                            tokens_used=accumulated_tokens,
                            final_tools=tools_for_llm,
                            parts=collected_parts + build_done_event(
                                final_content,
                                thinking=response.reasoning_content,
                            )["parts"],
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

                        running_payload = {
                            "name": tool_name,
                            "args": args,
                            "status": "running",
                            "reasoning_content": full_reasoning_content,
                        }
                        if request.on_tool_call:
                            await _maybe_await(request.on_tool_call(running_payload))

                        result = await _maybe_await(
                            self._deps.execute_tool(tool_name, args, request, _emit_event)
                        )

                        if request.expand_tools and request.agent_id and full_toolset is None:
                            if _should_expand_tools(tool_name, args):
                                expansion_payload: ToolExpansionResult | list[dict] | None = None
                                if self._deps.resolve_tool_expansion:
                                    expansion_payload = await _maybe_await(
                                        self._deps.resolve_tool_expansion(request, tool_name, args)
                                    )
                                if isinstance(expansion_payload, ToolExpansionResult):
                                    full_toolset = expansion_payload.tools
                                    session_context = request.session_context
                                    if session_context is None:
                                        session_context = request.session_context = SessionContext()
                                    new_packs = _merge_active_packs(session_context, expansion_payload.active_packs)
                                    if new_packs:
                                        event_payload = expansion_payload.event_payload or {
                                            "type": "pack_activation",
                                            "packs": new_packs,
                                            "message": "Activated capability packs for this task.",
                                            "status": "info",
                                        }
                                        await _emit_event(event_payload)
                                        system_prompt = await _maybe_await(
                                            self._deps.build_system_prompt(
                                                request,
                                                runtime_config.tenant_id,
                                                resolved_memory_context,
                                                current_user_name,
                                            )
                                        )
                                        api_messages[0] = LLMMessage(role="system", content=system_prompt)
                                elif isinstance(expansion_payload, list):
                                    full_toolset = expansion_payload
                                if full_toolset is None:
                                    full_toolset = await _maybe_await(
                                        self._deps.get_tools(request.agent_id, False)
                                    )
                                tools_for_llm = full_toolset

                        done_payload = {
                            "name": tool_name,
                            "args": args,
                            "status": "done",
                            "result": result,
                            "reasoning_content": full_reasoning_content,
                        }
                        if request.on_tool_call:
                            await _maybe_await(request.on_tool_call(done_payload))
                        collected_parts.append(build_tool_call_event(done_payload)["part"])

                        api_messages.append(
                            LLMMessage(
                                role="tool",
                                tool_call_id=tc["id"],
                                content=str(result),
                            )
                        )

                if request.agent_id and accumulated_tokens > 0:
                    await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                return _build_error_result(
                    "[Error] Too many tool call rounds",
                    tokens_used=accumulated_tokens,
                    final_tools=tools_for_llm,
                )
            finally:
                await client.close()
        finally:
            if request.execution_identity:
                if previous_identity:
                    set_execution_identity(previous_identity)
                else:
                    clear_execution_identity()
