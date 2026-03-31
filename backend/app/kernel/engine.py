"""Unified agent kernel implementation."""

from __future__ import annotations

import asyncio
import hashlib
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
from app.tools.registry import is_parallel_safe_tool

# Mid-loop compaction: check every N rounds and compress when approaching context limit.
_MIDLOOP_COMPACT_CHECK_INTERVAL = 3
_MIDLOOP_COMPACT_THRESHOLD = 0.85  # 85% of context window

# Large tool result eviction: save to workspace file and keep truncated preview.
_TOOL_RESULT_EVICTION_THRESHOLD = 8000  # chars
_TOOL_RESULT_PREVIEW_LENGTH = 2000  # chars to keep inline
# Tools whose output should never be evicted (small, structural results).
_EVICTION_EXEMPT_TOOLS = frozenset({
    "list_files", "read_file", "load_skill", "tool_search",
    "discover_resources", "list_triggers", "list_tasks", "get_task",
    "get_current_time", "check_async_task", "list_async_tasks",
    # Content-critical tools — already have their own internal truncation.
    "web_search", "jina_read", "read_document",
})

logger = logging.getLogger(__name__)


ResolveRuntimeConfig = Callable[[Any], Awaitable[RuntimeConfig] | RuntimeConfig]
ResolveCurrentUserName = Callable[[Any], Awaitable[str | None] | str | None]
BuildSystemPrompt = Callable[[InvocationRequest, Any, str, str | None], Awaitable[str] | str]
ResolveMemoryContext = Callable[[InvocationRequest, Any], Awaitable[str] | str]
ResolveRetrievalContext = Callable[[InvocationRequest, Any], Awaitable[str] | str]
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
ApplyCacheHints = Callable[[list[LLMMessage], str], list[LLMMessage]]


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
    resolve_retrieval_context: ResolveRetrievalContext | None = None
    apply_vision_transform: ApplyVisionTransform | None = None
    apply_cache_hints: ApplyCacheHints | None = None


@dataclass(slots=True)
class ToolExpansionResult:
    tools: list[dict]
    active_packs: list[dict[str, Any]]
    event_payload: dict[str, Any] | None = None


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _build_persisted_memory_messages(
    request: InvocationRequest,
    final_content: str,
    api_messages: list[LLMMessage] | None = None,
) -> list[dict]:
    # Prefer kernel's api_messages (includes tool calls/results) over request.memory_messages
    if api_messages and len(api_messages) > 1:
        base_messages = _llm_messages_to_dicts(api_messages[1:])  # Skip system prompt
    else:
        base_messages = list(request.memory_messages or request.messages)
    if final_content and not final_content.startswith("[LLM") and not final_content.startswith("[Error]"):
        base_messages.append({"role": "assistant", "content": final_content})
    return base_messages


def _build_error_result(
    message: str, *, tokens_used: int = 0, final_tools: list[dict] | None = None
) -> InvocationResult:
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


_PARALLEL_SEMAPHORE_LIMIT = 4


class _KernelCancelledError(Exception):
    """Internal sentinel used when a runtime cancel event stops generation."""


def _can_parallelize_batch(tool_calls: list[dict]) -> bool:
    """Check if all tool calls in a batch can run in parallel."""
    for tc in tool_calls:
        name = tc["function"]["name"]
        if not is_parallel_safe_tool(name):
            return False
    return True


def _fingerprint_prompt(prompt_prefix: str) -> str:
    return hashlib.sha256(prompt_prefix.encode("utf-8")).hexdigest()


def _clone_api_messages(messages: list[LLMMessage]) -> list[LLMMessage]:
    return [
        LLMMessage(
            role=message.role,
            content=message.content,
            tool_calls=list(message.tool_calls) if message.tool_calls else None,
            tool_call_id=message.tool_call_id,
            reasoning_content=message.reasoning_content,
            reasoning_signature=message.reasoning_signature,
        )
        for message in messages
    ]


def _llm_messages_to_dicts(messages: list[LLMMessage]) -> list[dict]:
    """Convert LLMMessage list to plain dicts for compression."""
    result: list[dict] = []
    for m in messages:
        d: dict[str, Any] = {"role": m.role}
        if m.content is not None:
            d["content"] = m.content
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        if m.tool_call_id:
            d["tool_call_id"] = m.tool_call_id
        if m.reasoning_content:
            d["reasoning_content"] = m.reasoning_content
        result.append(d)
    return result


def _dicts_to_llm_messages(dicts: list[dict]) -> list[LLMMessage]:
    """Convert plain dicts back to LLMMessage objects."""
    return [
        LLMMessage(
            role=d.get("role", "user"),
            content=d.get("content"),
            tool_calls=d.get("tool_calls"),
            tool_call_id=d.get("tool_call_id"),
            reasoning_content=d.get("reasoning_content"),
        )
        for d in dicts
    ]


def _maybe_evict_tool_result(
    tool_name: str,
    tool_call_id: str,
    result: str,
    eviction_dir: "Path | None" = None,
) -> str:
    """If tool result exceeds threshold, save full output to file and truncate inline."""
    from pathlib import Path as _Path  # deferred to avoid top-level import in kernel

    result_len = len(result)

    if tool_name in _EVICTION_EXEMPT_TOOLS:
        if result_len > _TOOL_RESULT_EVICTION_THRESHOLD:
            logger.info(
                "[Kernel] Tool result kept (exempt): tool=%s, chars=%d, tool_call_id=%s",
                tool_name, result_len, tool_call_id,
            )
        return result
    if result_len <= _TOOL_RESULT_EVICTION_THRESHOLD:
        return result

    logger.info(
        "[Kernel] Tool result evicted: tool=%s, chars=%d, threshold=%d, tool_call_id=%s",
        tool_name, result_len, _TOOL_RESULT_EVICTION_THRESHOLD, tool_call_id,
    )

    # Write full result to workspace file if eviction_dir provided
    eviction_path = ""
    if eviction_dir is not None:
        try:
            _Path(eviction_dir).mkdir(parents=True, exist_ok=True)
            file_name = f"{tool_call_id}.txt"
            full_path = _Path(eviction_dir) / file_name
            full_path.write_text(result, encoding="utf-8")
            eviction_path = f"workspace/tool_results/{file_name}"
        except Exception as exc:
            logger.warning("[Kernel] Failed to write eviction file: %s", exc)

    preview = result[:_TOOL_RESULT_PREVIEW_LENGTH]
    if eviction_path:
        return (
            f"{preview}\n\n"
            f"[Full output saved to {eviction_path} — {len(result)} chars. "
            f"Use read_file(\"{eviction_path}\") to retrieve.]"
        )
    return (
        f"{preview}\n\n"
        f"[... truncated — full output {len(result)} chars, tool_call_id={tool_call_id}. "
        f"Use read_file or grep_search to retrieve specific parts if needed.]"
    )


def _build_cancelled_result(
    partial_chunks: list[str],
    partial_thinking: list[str],
    *,
    tokens_used: int = 0,
    final_tools: list[dict] | None = None,
    collected_parts: list[dict[str, Any]] | None = None,
) -> InvocationResult:
    partial_text = "".join(partial_chunks).strip()
    if partial_text:
        content = partial_text + "\n\n*[Generation stopped]*"
    else:
        content = "*[Generation stopped]*"
    done_parts = build_done_event(
        content,
        thinking="".join(partial_thinking) if partial_thinking else None,
    )["parts"]
    return InvocationResult(
        content=content,
        tokens_used=tokens_used,
        final_tools=final_tools,
        parts=(collected_parts or []) + done_parts,
    )


async def _stream_with_cancel(
    client: Any,
    *,
    cancel_event: asyncio.Event | None,
    **kwargs: Any,
) -> Any:
    if cancel_event is None:
        return await client.stream(**kwargs)

    if cancel_event.is_set():
        raise _KernelCancelledError

    stream_task = asyncio.create_task(client.stream(**kwargs))
    cancel_task = asyncio.create_task(cancel_event.wait())
    try:
        done, pending = await asyncio.wait(
            {stream_task, cancel_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()

        if cancel_task in done and cancel_event.is_set():
            stream_task.cancel()
            try:
                await stream_task
            except (asyncio.CancelledError, Exception) as _cancel_exc:
                logger.debug("Stream task cancelled during shutdown: %s", _cancel_exc)
            raise _KernelCancelledError

        return await stream_task
    finally:
        cancel_task.cancel()


class AgentKernel:
    """Single runtime kernel for all agent invocations."""

    def __init__(self, dependencies: KernelDependencies) -> None:
        self._deps = dependencies

    async def _persist_before_exit(
        self,
        request: InvocationRequest,
        runtime_config: RuntimeConfig,
        final_content: str,
        api_messages: list[LLMMessage] | None = None,
    ) -> None:
        """Best-effort memory persistence on abnormal exit paths."""
        if not request.agent_id or not runtime_config.tenant_id:
            return
        try:
            await _maybe_await(
                self._deps.persist_memory(
                    agent_id=request.agent_id,
                    session_id=request.memory_session_id,
                    tenant_id=runtime_config.tenant_id,
                    messages=_build_persisted_memory_messages(request, final_content, api_messages),
                )
            )
        except Exception as exc:
            logger.warning("[Kernel] Best-effort persist_memory failed on exit: %s", exc)

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
            resolved_retrieval_context = ""
            if self._deps.resolve_retrieval_context:
                resolved_retrieval_context = await _maybe_await(
                    self._deps.resolve_retrieval_context(request, runtime_config.tenant_id)
                )
            current_user_name = await _maybe_await(self._deps.resolve_current_user_name(request.user_id))

            # Prompt cache: reuse frozen prefix from session if available
            from app.runtime.prompt_builder import assemble_runtime_prompt, build_dynamic_prompt_suffix

            session_ctx = request.session_context
            # Prompt cache: reuse frozen prefix if available AND still valid.
            # Rebuild if memory context changed (hash-based invalidation).
            _cache_valid = False
            if session_ctx and session_ctx.prompt_prefix:
                _mem_hash = hashlib.sha256(resolved_memory_context.encode("utf-8")).hexdigest()[:16]
                _cached_mem_hash = getattr(session_ctx, "_memory_hash", None)
                _cache_valid = _cached_mem_hash == _mem_hash
                if not _cache_valid:
                    logger.info("[Kernel] Prompt cache invalidated — memory context changed")

            if _cache_valid and session_ctx and session_ctx.prompt_prefix:
                # Session has a valid frozen prefix — only rebuild dynamic suffix
                dynamic_suffix = build_dynamic_prompt_suffix(
                    active_packs=session_ctx.active_packs if session_ctx else [],
                    retrieval_context=resolved_retrieval_context,
                    system_prompt_suffix=request.system_prompt_suffix,
                )
                system_prompt = assemble_runtime_prompt(session_ctx.prompt_prefix, dynamic_suffix)
            else:
                # First call in session: build and cache the frozen prefix only.
                prompt_prefix = await _maybe_await(
                    self._deps.build_system_prompt(
                        request,
                        runtime_config.tenant_id,
                        resolved_memory_context,
                        current_user_name,
                    )
                )
                if session_ctx is not None:
                    session_ctx.prompt_prefix = prompt_prefix
                    session_ctx.prompt_fingerprint = _fingerprint_prompt(prompt_prefix)
                    session_ctx._memory_hash = hashlib.sha256(resolved_memory_context.encode("utf-8")).hexdigest()[:16]
                dynamic_suffix = build_dynamic_prompt_suffix(
                    active_packs=session_ctx.active_packs if session_ctx else [],
                    retrieval_context=resolved_retrieval_context,
                    system_prompt_suffix=request.system_prompt_suffix,
                )
                system_prompt = assemble_runtime_prompt(prompt_prefix, dynamic_suffix)

            tools_for_llm = request.initial_tools
            if tools_for_llm is None:
                if request.agent_id:
                    tools_for_llm = await _maybe_await(self._deps.get_tools(request.agent_id, request.core_tools_only))
                else:
                    tools_for_llm = []

            collected_parts: list[dict[str, Any]] = []
            streamed_chunks: list[str] = []
            streamed_thinking: list[str] = []

            async def _emit_event(event: dict[str, Any]) -> None:
                if request.on_event:
                    try:
                        await _maybe_await(request.on_event(event))
                    except Exception as _cb_exc:
                        logger.warning("[Kernel] on_event callback failed: %s", _cb_exc)
                part = _event_to_part(event)
                if part:
                    collected_parts.append(part)

            async def _emit_compaction_event(data: dict[str, Any]) -> None:
                await _emit_event({"type": "session_compact", **data})
                # System-level WAL: save compaction summary WITHOUT overwriting focus.md.
                # Write to a separate file so the agent's curated focus is preserved.
                if request.agent_id and data.get("summary"):
                    try:
                        from app.config import get_settings as _gs
                        from pathlib import Path as _P
                        _header = "# Session Compaction Summary (auto-saved)\n\n"
                        _content = _header + data["summary"] + "\n"
                        # Write to both workspace roots so heartbeat can find it
                        for _root in [
                            _P(_gs().AGENT_DATA_DIR) / str(request.agent_id),
                            _P("/tmp/hive_workspaces") / str(request.agent_id),
                        ]:
                            if _root.exists():
                                _cfile = _root / "workspace" / "compaction_summary.md"
                                _cfile.parent.mkdir(parents=True, exist_ok=True)
                                _cfile.write_text(_content, encoding="utf-8")
                    except Exception as _exc:
                        logger.warning("[Kernel] Auto-save compaction summary failed: %s", _exc)

            async def _emit_chunk(text: str) -> None:
                streamed_chunks.append(text)
                if request.on_chunk:
                    try:
                        await _maybe_await(request.on_chunk(text))
                    except Exception as _cb_exc:
                        logger.warning("[Kernel] on_chunk callback failed: %s", _cb_exc)

            async def _emit_thinking(text: str) -> None:
                streamed_thinking.append(text)
                if request.on_thinking:
                    try:
                        await _maybe_await(request.on_thinking(text))
                    except Exception as _cb_exc:
                        logger.warning("[Kernel] on_thinking callback failed: %s", _cb_exc)

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

            active_model = request.model
            fallback_model = request.fallback_model
            active_supports_vision = request.supports_vision
            try:
                client = self._deps.create_client(active_model)
            except Exception as exc:
                return _build_error_result(f"[Error] Failed to create LLM client: {exc}")

            max_rounds = request.max_tool_rounds or runtime_config.max_tool_rounds
            max_tokens = self._deps.get_max_tokens(
                active_model.provider,
                active_model.model,
                getattr(active_model, "max_output_tokens", None),
            )
            accumulated_tokens = 0
            full_toolset = None

            try:
                for round_i in range(max_rounds):
                    if request.cancel_event and request.cancel_event.is_set():
                        if request.agent_id and accumulated_tokens > 0:
                            await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                        await self._persist_before_exit(request, runtime_config, "*[Generation stopped]*", api_messages)
                        return _build_cancelled_result(
                            streamed_chunks,
                            streamed_thinking,
                            tokens_used=accumulated_tokens,
                            final_tools=tools_for_llm,
                            collected_parts=collected_parts,
                        )
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

                    # Apply provider-specific cache hints (e.g., Anthropic prefix caching)
                    while True:
                        stream_messages = _clone_api_messages(api_messages)
                        if self._deps.apply_vision_transform:
                            stream_messages = self._deps.apply_vision_transform(
                                stream_messages,
                                active_supports_vision,
                            )
                        if self._deps.apply_cache_hints:
                            stream_messages = self._deps.apply_cache_hints(
                                stream_messages, getattr(active_model, "provider", "")
                            )

                        try:
                            response = await _stream_with_cancel(
                                client,
                                cancel_event=request.cancel_event,
                                messages=stream_messages,
                                tools=tools_for_llm if tools_for_llm else None,
                                temperature=0.7,
                                max_tokens=max_tokens,
                                on_chunk=_emit_chunk,
                                on_thinking=_emit_thinking,
                            )
                            break
                        except _KernelCancelledError:
                            if request.agent_id and accumulated_tokens > 0:
                                await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                            await self._persist_before_exit(request, runtime_config, "*[Generation stopped]*", api_messages)
                            return _build_cancelled_result(
                                streamed_chunks,
                                streamed_thinking,
                                tokens_used=accumulated_tokens,
                                final_tools=tools_for_llm,
                                collected_parts=collected_parts,
                            )
                        except LLMError as exc:
                            logger.error(
                                "[Kernel] LLMError provider=%s model=%s round=%s: %s",
                                getattr(active_model, "provider", "?"),
                                getattr(active_model, "model", "?"),
                                round_i + 1,
                                exc,
                            )
                            if fallback_model is not None and active_model is request.model:
                                await client.close()
                                client = self._deps.create_client(fallback_model)
                                active_model = fallback_model
                                active_supports_vision = bool(
                                    getattr(fallback_model, "supports_vision", active_supports_vision)
                                )
                                max_tokens = self._deps.get_max_tokens(
                                    active_model.provider,
                                    active_model.model,
                                    getattr(active_model, "max_output_tokens", None),
                                )
                                fallback_model = None
                                continue
                            if request.agent_id and accumulated_tokens > 0:
                                await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                            await self._persist_before_exit(request, runtime_config, f"[LLM Error] {exc}", api_messages)
                            return _build_error_result(f"[LLM Error] {exc}", tokens_used=accumulated_tokens)
                        except Exception as exc:
                            logger.error(
                                "[Kernel] Unexpected error provider=%s model=%s round=%s: %s: %s",
                                getattr(active_model, "provider", "?"),
                                getattr(active_model, "model", "?"),
                                round_i + 1,
                                type(exc).__name__,
                                str(exc)[:300],
                            )
                            if fallback_model is not None and active_model is request.model:
                                await client.close()
                                client = self._deps.create_client(fallback_model)
                                active_model = fallback_model
                                active_supports_vision = bool(
                                    getattr(fallback_model, "supports_vision", active_supports_vision)
                                )
                                max_tokens = self._deps.get_max_tokens(
                                    active_model.provider,
                                    active_model.model,
                                    getattr(active_model, "max_output_tokens", None),
                                )
                                fallback_model = None
                                continue
                            if request.agent_id and accumulated_tokens > 0:
                                await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                            err_msg = f"[LLM call error] {type(exc).__name__}: {str(exc)[:200]}"
                            await self._persist_before_exit(request, runtime_config, err_msg, api_messages)
                            return _build_error_result(
                                err_msg,
                                tokens_used=accumulated_tokens,
                            )

                    real_tokens = self._deps.extract_usage_tokens(response.usage)
                    if real_tokens:
                        accumulated_tokens += real_tokens
                    else:
                        round_chars = sum(
                            len(m.content or "") if isinstance(m.content, str) else 0 for m in api_messages
                        ) + len(response.content or "")
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
                                        messages=_build_persisted_memory_messages(request, final_content, api_messages),
                                    )
                                )
                            except Exception as exc:
                                logger.warning(
                                    "[Kernel] Failed to persist memory for agent %s: %s", request.agent_id, exc
                                )
                        if request.agent_id and accumulated_tokens > 0:
                            await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                        return InvocationResult(
                            content=final_content,
                            tokens_used=accumulated_tokens,
                            final_tools=tools_for_llm,
                            parts=collected_parts
                            + build_done_event(
                                final_content,
                                thinking=response.reasoning_content,
                            )["parts"],
                        )

                    api_messages.append(
                        LLMMessage(
                            role="assistant",
                            content=response.content or None,
                            tool_calls=[
                                {
                                    "id": tc["id"],
                                    "type": "function",
                                    "function": tc["function"],
                                }
                                for tc in response.tool_calls
                            ],
                            reasoning_content=response.reasoning_content,
                        )
                    )

                    full_reasoning_content = response.reasoning_content or ""

                    # Parse all tool calls upfront
                    parsed_tool_calls: list[tuple[dict, str, dict]] = []
                    for tc in response.tool_calls:
                        fn = tc["function"]
                        tool_name = fn["name"]
                        raw_args = fn.get("arguments", "{}")
                        try:
                            args = json.loads(raw_args) if raw_args else {}
                        except json.JSONDecodeError:
                            logger.warning(
                                "[Kernel] Malformed tool arguments: tool=%s, raw=%s",
                                tool_name, (raw_args or "")[:200],
                            )
                            args = {}
                        parsed_tool_calls.append((tc, tool_name, args))

                    if len(parsed_tool_calls) > 1 and _can_parallelize_batch(response.tool_calls):
                        # --- Parallel execution for read-only tools ---
                        if request.cancel_event and request.cancel_event.is_set():
                            if request.agent_id and accumulated_tokens > 0:
                                await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                            await self._persist_before_exit(request, runtime_config, "*[Generation stopped]*", api_messages)
                            return _build_cancelled_result(
                                streamed_chunks,
                                streamed_thinking,
                                tokens_used=accumulated_tokens,
                                final_tools=tools_for_llm,
                                collected_parts=collected_parts,
                            )

                        # 1. Emit all "running" events
                        for _tc, tool_name, args in parsed_tool_calls:
                            running_payload = {
                                "name": tool_name,
                                "args": args,
                                "status": "running",
                                "reasoning_content": full_reasoning_content,
                            }
                            if request.on_tool_call:
                                try:
                                    await _maybe_await(request.on_tool_call(running_payload))
                                except Exception as _cb_exc:
                                    logger.warning("[Kernel] on_tool_call(running) callback failed: %s", _cb_exc)

                        # 2. Execute all tools concurrently via asyncio.gather
                        sem = asyncio.Semaphore(_PARALLEL_SEMAPHORE_LIMIT)

                        async def _run_tool(t_name: str, t_args: dict) -> str:
                            async with sem:
                                return await _maybe_await(
                                    self._deps.execute_tool(t_name, t_args, request, _emit_event)
                                )

                        results = await asyncio.gather(
                            *[_run_tool(t_name, t_args) for _, t_name, t_args in parsed_tool_calls],
                            return_exceptions=True,
                        )
                        # Convert exceptions to error strings
                        for _i, _r in enumerate(results):
                            if isinstance(_r, BaseException):
                                _tn = parsed_tool_calls[_i][1]
                                logger.warning("[Kernel] Parallel tool %s failed: %s", _tn, _r)
                                results[_i] = f"[Tool execution error] {type(_r).__name__}: {str(_r)[:200]}"

                        # 3. Emit "done" events and append tool results in original order
                        for (tc, tool_name, args), result in zip(parsed_tool_calls, results):
                            done_payload = {
                                "name": tool_name,
                                "args": args,
                                "status": "done",
                                "result": result,
                                "reasoning_content": full_reasoning_content,
                            }
                            if request.on_tool_call:
                                try:
                                    await _maybe_await(request.on_tool_call(done_payload))
                                except Exception as _cb_exc:
                                    logger.warning("[Kernel] on_tool_call(done) callback failed: %s", _cb_exc)
                            collected_parts.append(build_tool_call_event(done_payload)["part"])
                            api_messages.append(
                                LLMMessage(
                                    role="tool",
                                    tool_call_id=tc["id"],
                                    content=_maybe_evict_tool_result(tool_name, tc["id"], str(result), request.eviction_dir),
                                )
                            )
                    else:
                        # --- Sequential execution (original logic) ---
                        for tc, tool_name, args in parsed_tool_calls:
                            if request.cancel_event and request.cancel_event.is_set():
                                if request.agent_id and accumulated_tokens > 0:
                                    await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                                await self._persist_before_exit(request, runtime_config, "*[Generation stopped]*", api_messages)
                                return _build_cancelled_result(
                                    streamed_chunks,
                                    streamed_thinking,
                                    tokens_used=accumulated_tokens,
                                    final_tools=tools_for_llm,
                                    collected_parts=collected_parts,
                                )
                            running_payload = {
                                "name": tool_name,
                                "args": args,
                                "status": "running",
                                "reasoning_content": full_reasoning_content,
                            }
                            if request.on_tool_call:
                                try:
                                    await _maybe_await(request.on_tool_call(running_payload))
                                except Exception as _cb_exc:
                                    logger.warning("[Kernel] on_tool_call(running) callback failed: %s", _cb_exc)

                            result = await _maybe_await(
                                self._deps.execute_tool(tool_name, args, request, _emit_event)
                            )

                            if request.expand_tools and request.agent_id:
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
                                        new_packs = _merge_active_packs(
                                            session_context, expansion_payload.active_packs
                                        )
                                        if new_packs:
                                            event_payload = expansion_payload.event_payload or {
                                                "type": "pack_activation",
                                                "packs": new_packs,
                                                "message": "Activated capability packs for this task.",
                                                "status": "info",
                                            }
                                            await _emit_event(event_payload)
                                            prompt_prefix = session_context.prompt_prefix or await _maybe_await(
                                                self._deps.build_system_prompt(
                                                    request,
                                                    runtime_config.tenant_id,
                                                    resolved_memory_context,
                                                    current_user_name,
                                                )
                                            )
                                            session_context.prompt_prefix = prompt_prefix
                                            session_context.prompt_fingerprint = _fingerprint_prompt(prompt_prefix)
                                            system_prompt = assemble_runtime_prompt(
                                                prompt_prefix,
                                                build_dynamic_prompt_suffix(
                                                    active_packs=session_context.active_packs,
                                                    retrieval_context=resolved_retrieval_context,
                                                    system_prompt_suffix=request.system_prompt_suffix,
                                                ),
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
                                try:
                                    await _maybe_await(request.on_tool_call(done_payload))
                                except Exception as _cb_exc:
                                    logger.warning("[Kernel] on_tool_call(done) callback failed: %s", _cb_exc)
                            collected_parts.append(build_tool_call_event(done_payload)["part"])

                            api_messages.append(
                                LLMMessage(
                                    role="tool",
                                    tool_call_id=tc["id"],
                                    content=_maybe_evict_tool_result(tool_name, tc["id"], str(result), request.eviction_dir),
                                )
                            )

                    # ── Mid-loop context compaction ──────────────────────────
                    if (round_i + 1) % _MIDLOOP_COMPACT_CHECK_INTERVAL == 0 and len(api_messages) > 6:
                        conv_dicts = _llm_messages_to_dicts(api_messages[1:])
                        compressed = await _maybe_await(
                            self._deps.maybe_compress_messages(
                                conv_dicts,
                                model_provider=active_model.provider,
                                model_name=active_model.model,
                                max_input_tokens_override=getattr(
                                    active_model, "max_input_tokens", None
                                ),
                                tenant_id=runtime_config.tenant_id,
                                compress_threshold=_MIDLOOP_COMPACT_THRESHOLD,
                                on_compaction=_emit_compaction_event,
                            )
                        )
                        if len(compressed) < len(conv_dicts):
                            api_messages = [api_messages[0]] + _dicts_to_llm_messages(compressed)
                            # Reset collected_parts to avoid duplicates after compaction
                            collected_parts.clear()
                            logger.info(
                                "[Kernel] Mid-loop compaction: %d → %d messages (round %d)",
                                len(conv_dicts) + 1,
                                len(api_messages),
                                round_i + 1,
                            )

                if request.agent_id and accumulated_tokens > 0:
                    await _maybe_await(self._deps.record_token_usage(request.agent_id, accumulated_tokens))
                await self._persist_before_exit(request, runtime_config, "[Error] Too many tool call rounds", api_messages)
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
