"""Unified Memory Service — conversation lifecycle management.

Covers three phases:
  1. on_conversation_start: inject previous session summary + agent memory
  2. maybe_compress_messages: LLM-powered compression near context window limit
  3. on_conversation_end: persist summary, extract memory facts, share to OpenViking
"""

from __future__ import annotations

import json
import inspect
import logging
import re
import uuid
from typing import Awaitable, Callable

from sqlalchemy import select
from pathlib import Path

from app.config import get_settings
from app.database import async_session
from app.memory import FileBackedMemoryStore, MemoryAssembler, MemoryRetriever, PersistentMemoryStore
from app.models.chat_session import ChatSession
from app.models.llm import LLMModel
from app.models.tenant_setting import TenantSetting
from app.runtime.context_budget import ContextBudget, compute_context_budget
from app.services.conversation_summarizer import estimate_tokens, _extract_summary

logger = logging.getLogger(__name__)

CompactionCallback = Callable[[dict], Awaitable[None] | None]


# ============================================================================
# Public API
# ============================================================================


async def on_conversation_start(
    agent_id: uuid.UUID,
    session_id: str,
    tenant_id: uuid.UUID,
) -> str:
    """Backward-compatible wrapper for loading runtime memory context."""
    return await build_memory_context(agent_id, tenant_id, session_id=session_id)


async def build_memory_snapshot(
    agent_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    session_id: str | None = None,
    context_window_tokens: int | None = None,
    budget_profile: ContextBudget | None = None,
) -> str:
    """Build a session-start memory snapshot for frozen prompt prefixes."""
    return await build_memory_context(
        agent_id,
        tenant_id,
        session_id=session_id,
        query="",
        context_window_tokens=context_window_tokens,
        budget_profile=budget_profile,
    )


async def build_memory_context(
    agent_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    session_id: str | None = None,
    query: str = "",
    context_window_tokens: int | None = None,
    budget_profile: ContextBudget | None = None,
) -> str:
    """Build a self-consistent memory context for any runtime entrypoint.

    Uses the four-layer retrieval pipeline (working, episodic, semantic, external)
    followed by the assembler. Falls back to FileBackedMemoryStore on failure.
    """
    retrieval_profile = budget_profile or compute_context_budget(
        context_window_tokens=context_window_tokens,
        query=query,
        active_pack_count=0,
    )
    try:
        retriever = MemoryRetriever(data_root=Path(get_settings().AGENT_DATA_DIR))
        rerank_model_config = None
        if query:
            rerank_model_config = await _maybe_await(_get_rerank_model_config(tenant_id))
        retrieve_kwargs = {
            "rerank_model_config": rerank_model_config,
            "limit": max(50, retrieval_profile.semantic_limit * 2),
        }
        if "retrieval_profile" in inspect.signature(retriever.retrieve).parameters:
            retrieve_kwargs["retrieval_profile"] = retrieval_profile
        items = await retriever.retrieve(
            agent_id,
            query,
            session_id,
            str(tenant_id) if tenant_id else None,
            **retrieve_kwargs,
        )
        assembler = MemoryAssembler()
        assemble_kwargs = {}
        if "budget_chars" in inspect.signature(assembler.assemble).parameters:
            assemble_kwargs["budget_chars"] = retrieval_profile.memory_budget_chars
        result = assembler.assemble(items, **assemble_kwargs)
        if result:
            return result
    except Exception as exc:
        logger.warning("Retrieval pipeline failed, falling back to FileBackedMemoryStore: %s", exc)

    # Fallback: original FileBackedMemoryStore
    store = FileBackedMemoryStore(
        data_root=Path(get_settings().AGENT_DATA_DIR),
        load_session_summary=_load_session_summary,
        load_previous_session_summary=_load_previous_session_summary,
        load_agent_memory=_load_agent_memory,
    )
    try:
        return await store.build_context(agent_id=agent_id, tenant_id=tenant_id, session_id=session_id)
    except Exception as exc:
        logger.warning("FileBackedMemoryStore fallback failed, returning empty memory context: %s", exc)
        return ""


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def compute_history_limit(
    provider: str,
    model_name: str,
    max_input_tokens_override: int | None = None,
    *,
    system_prompt_tokens: int = 0,
    tool_definitions_tokens: int = 0,
) -> int:
    """Compute how many history messages to load from DB based on model context window.

    Dynamic budget allocation: subtracts known token consumers (system prompt,
    tool definitions, generation headroom) before allocating to history.

    If system_prompt_tokens and tool_definitions_tokens are provided, uses real
    values; otherwise falls back to conservative estimates.
    """
    context_limit = _get_input_context_limit(provider, model_name, max_input_tokens_override)

    # Reserve tokens for known consumers
    # System prompt: use real value, or estimate based on context window
    # For 256K models, system prompt can be ~51K tokens; 3K was a severe underestimate.
    if system_prompt_tokens > 0:
        prompt_reserve = system_prompt_tokens
    else:
        # Estimate: 20% of context window (matches _SYSTEM_PROMPT_CONTEXT_RATIO)
        prompt_reserve = max(3000, int(context_limit * 0.20))

    # Tool definitions: use real value or estimate ~1500 tokens (15 tools × ~100 tokens each)
    tools_reserve = tool_definitions_tokens if tool_definitions_tokens > 0 else 1500
    # Generation headroom: ~8K tokens for model output
    generation_reserve = 8000

    # Memory context assembled by MemoryAssembler (20K+ chars ≈ 6K tokens for 256K models)
    memory_context_reserve = 6000
    total_reserved = prompt_reserve + tools_reserve + generation_reserve + memory_context_reserve
    history_token_budget = max(context_limit - total_reserved, context_limit // 4)

    avg_tokens_per_message = 300
    computed = history_token_budget // avg_tokens_per_message
    # Clamp: at least 20 (usable minimum), at most 800 (256K models can hold 800+ messages)
    return max(20, min(computed, 800))


async def compute_history_limit_for_agent(agent_id: uuid.UUID) -> int:
    """Resolve model info from DB and compute history limit for an agent.

    Convenience wrapper for channel handlers that don't have the model loaded.
    Falls back to 128k context (213 messages) if model lookup fails.
    """
    try:
        from app.models.agent import Agent
        from app.models.llm import LLMModel
        async with async_session() as db:
            agent_r = await db.execute(
                select(Agent).where(Agent.id == agent_id)
            )
            agent = agent_r.scalar_one_or_none()
            if agent and agent.primary_model_id:
                model_r = await db.execute(
                    select(LLMModel).where(LLMModel.id == agent.primary_model_id, LLMModel.tenant_id == agent.tenant_id)
                )
                model = model_r.scalar_one_or_none()
                if model:
                    return compute_history_limit(
                        model.provider, model.model,
                        getattr(model, "max_input_tokens", None),
                    )
    except Exception:
        logger.warning("Failed to resolve model for history limit (agent=%s), using default", agent_id)
    return compute_history_limit("openai", "")


async def maybe_compress_messages(
    messages: list[dict],
    model_provider: str,
    model_name: str,
    max_input_tokens_override: int | None,
    tenant_id: uuid.UUID | None,
    *,
    compress_threshold: float | None = None,
    keep_recent: int | None = None,
    on_compaction: CompactionCallback | None = None,
) -> list[dict]:
    """Compress old messages when approaching model context window.

    Returns potentially compressed message list with summary prepended.
    """
    # Resolve config from tenant settings
    config = await _get_memory_config(tenant_id) if tenant_id else {}
    # Default 82% — was 70%, too aggressive for 256K models (compressed with 77K tokens remaining)
    threshold = compress_threshold if compress_threshold is not None else config.get("compress_threshold", 82) / 100.0
    recent_count = keep_recent if keep_recent is not None else config.get("keep_recent", 10)

    # Resolve context window
    context_limit = _get_input_context_limit(model_provider, model_name, max_input_tokens_override)
    trigger_tokens = int(context_limit * threshold)

    current_tokens = estimate_tokens(messages, provider=model_provider)
    if current_tokens <= trigger_tokens:
        return messages

    if len(messages) <= recent_count:
        return messages

    old_messages = messages[:-recent_count]
    recent_messages = messages[-recent_count:]

    # Ensure we don't break tool_call/tool_result pairs at the split point
    old_messages, recent_messages = _safe_split(old_messages, recent_messages)

    logger.info(
        "Memory compress: %d tokens > %d threshold (context=%d), summarizing %d old messages",
        current_tokens, trigger_tokens, context_limit, len(old_messages),
    )

    # Try LLM-powered summarization
    summary_model = await _get_summary_model_config(tenant_id) if tenant_id else None
    if summary_model:
        try:
            from app.services.conversation_summarizer import _llm_summarize
            summary = await _llm_summarize(old_messages, summary_model)
            if summary:
                if on_compaction:
                    maybe_result = on_compaction({
                        "summary": summary,
                        "original_message_count": len(messages),
                        "kept_message_count": len(recent_messages) + 1,
                    })
                    if maybe_result is not None:
                        await maybe_result
                return [{"role": "system", "content": f"[Previous conversation summary]\n{summary}"}] + recent_messages
        except Exception as e:
            logger.warning("LLM summarization failed, falling back to extraction: %s", e)

    # Fallback: text extraction
    summary = _extract_summary(old_messages)
    if not summary:
        # CR-03: If extraction also produces empty summary, keep original messages
        logger.warning("[Memory] Both LLM and extraction summaries empty — skipping compression")
        return messages
    if on_compaction:
        maybe_result = on_compaction({
            "summary": summary,
            "original_message_count": len(messages),
            "kept_message_count": len(recent_messages) + 1,
        })
        if maybe_result is not None:
            await maybe_result
    return [{"role": "system", "content": f"[Previous conversation summary]\n{summary}"}] + recent_messages


async def on_conversation_end(
    agent_id: uuid.UUID,
    session_id: str,
    tenant_id: uuid.UUID,
    messages: list[dict],
) -> None:
    """Backward-compatible wrapper for persisting runtime memory state."""
    await persist_runtime_memory(
        agent_id=agent_id,
        session_id=session_id,
        tenant_id=tenant_id,
        messages=messages,
    )

    # P3.1: Auto-dream gate check — fire-and-forget if conditions met
    try:
        from app.services.auto_dream import record_session_end, should_dream, run_dream
        record_session_end(agent_id)
        if should_dream(agent_id):
            import asyncio
            asyncio.create_task(run_dream(agent_id, tenant_id))
            logger.info("[Memory] Auto-dream triggered for agent %s", agent_id)
    except Exception as _dream_err:
        logger.debug("[Memory] Auto-dream check failed: %s", _dream_err)


async def persist_runtime_memory(
    *,
    agent_id: uuid.UUID,
    session_id: str | None,
    tenant_id: uuid.UUID,
    messages: list[dict],
) -> None:
    """Persist summary and agent memory for any runtime entrypoint."""
    if not _has_meaningful_messages(messages):
        return

    _MAX_RETRIES = 2
    _RETRY_DELAYS = (1.0, 3.0)
    last_exc: Exception | None = None

    for attempt in range(_MAX_RETRIES + 1):
        try:
            summary = await _generate_session_summary(messages, tenant_id)
            if summary and session_id:
                await _save_session_summary(session_id, summary)

            await _update_agent_memory(agent_id, messages, tenant_id, session_id=session_id)

            config = await _get_memory_config(tenant_id)
            if config.get("extract_to_viking", False) and summary:
                from app.services import viking_client

                if viking_client.is_configured():
                    await viking_client.add_resource(
                        content=summary,
                        to=f"viking://conversations/{agent_id}/{session_id or 'runtime'}",
                        tenant_id=str(tenant_id),
                        agent_id=str(agent_id),
                        reason="conversation_summary",
                    )
                    logger.info("Summary written to OpenViking for session %s", session_id or "runtime")

            return  # success

        except Exception as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES:
                import asyncio
                delay = _RETRY_DELAYS[attempt]
                logger.warning(
                    "persist_runtime_memory attempt %d/%d failed, retrying in %.1fs: %s",
                    attempt + 1, _MAX_RETRIES + 1, delay, exc,
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    "persist_runtime_memory failed after %d attempts (non-fatal): %s",
                    _MAX_RETRIES + 1, last_exc, exc_info=True,
                )


# ============================================================================
# Internal Helpers
# ============================================================================


def _get_input_context_limit(provider: str, model_name: str, override: int | None) -> int:
    """Resolve model input context window. Priority: override > ProviderSpec > 128000."""
    if override and override > 0:
        return override

    from app.services.llm_client import get_provider_spec
    spec = get_provider_spec(provider)
    if spec:
        return spec.max_input_tokens

    return 128000


async def _get_memory_config(tenant_id: uuid.UUID) -> dict:
    """Load memory configuration from TenantSetting(key='memory_config')."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(TenantSetting.value).where(
                    TenantSetting.tenant_id == tenant_id,
                    TenantSetting.key == "memory_config",
                )
            )
            value = result.scalar_one_or_none()
            return value if isinstance(value, dict) else {}
    except Exception:
        return {}


async def _get_summary_model_config(tenant_id: uuid.UUID) -> dict | None:
    """Resolve the LLM model to use for summarization from tenant config."""
    config = await _get_memory_config(tenant_id)
    model_id = config.get("summary_model_id")
    if not model_id:
        return None

    try:
        async with async_session() as db:
            result = await db.execute(
                select(LLMModel).where(LLMModel.id == uuid.UUID(str(model_id)), LLMModel.tenant_id == tenant_id)
            )
            model = result.scalar_one_or_none()
            if not model or not model.enabled:
                return None

            return {
                "provider": model.provider,
                "model": model.model,
                "api_key": model.api_key,
                "base_url": model.base_url,
            }
    except Exception as e:
        logger.warning("Failed to load summary model: %s", e)
        return None


async def _get_rerank_model_config(tenant_id: uuid.UUID) -> dict | None:
    """Resolve the optional LLM model to use for semantic memory reranking."""
    config = await _get_memory_config(tenant_id)
    model_id = config.get("rerank_model_id")
    if not model_id:
        return None

    try:
        async with async_session() as db:
            result = await db.execute(
                select(LLMModel).where(LLMModel.id == uuid.UUID(str(model_id)), LLMModel.tenant_id == tenant_id)
            )
            model = result.scalar_one_or_none()
            if not model or not model.enabled:
                return None

            return {
                "provider": model.provider,
                "model": model.model,
                "api_key": model.api_key,
                "base_url": model.base_url,
            }
    except Exception as e:
        logger.warning("Failed to load rerank model: %s", e)
        return None


async def _generate_session_summary(messages: list[dict], tenant_id: uuid.UUID) -> str | None:
    """Generate a summary for the session using LLM or fallback extraction."""
    summary_model = await _get_summary_model_config(tenant_id)
    if summary_model:
        try:
            from app.services.conversation_summarizer import _llm_summarize
            return await _llm_summarize(messages, summary_model)
        except Exception as e:
            logger.warning("LLM session summary failed, using extraction: %s", e)

    return _extract_summary(messages)


# P2.1: Cursor-based incremental extraction — only process new messages since last cursor.
_extraction_cursors: dict[str, int] = {}  # agent_id_hex:session_id -> last_processed_message_index


def _extraction_cursor_key(agent_id: uuid.UUID, session_id: str | None = None) -> str:
    return f"{agent_id.hex}:{session_id or 'runtime'}"


def _extraction_cursor_state_path(agent_id: uuid.UUID) -> Path:
    return Path(get_settings().AGENT_DATA_DIR) / str(agent_id) / "memory" / "extraction_cursors.json"


def _load_extraction_cursor_state(agent_id: uuid.UUID) -> dict[str, int]:
    path = _extraction_cursor_state_path(agent_id)
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    state: dict[str, int] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, int):
            state[key] = value
    return state


def _persist_extraction_cursor_state(agent_id: uuid.UUID) -> None:
    path = _extraction_cursor_state_path(agent_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    prefix = f"{agent_id.hex}:"
    state = {
        key[len(prefix):]: value
        for key, value in _extraction_cursors.items()
        if key.startswith(prefix)
    }
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _get_extraction_cursor(agent_id: uuid.UUID, session_id: str | None = None) -> int:
    """Load last extraction cursor, restoring from disk when necessary."""
    key = _extraction_cursor_key(agent_id, session_id)
    if key in _extraction_cursors:
        return _extraction_cursors[key]

    persisted = _load_extraction_cursor_state(agent_id)
    if persisted:
        for persisted_session, value in persisted.items():
            _extraction_cursors[f"{agent_id.hex}:{persisted_session}"] = value
    return _extraction_cursors.get(key, 0)


def _set_extraction_cursor(agent_id: uuid.UUID, index: int, session_id: str | None = None) -> None:
    _extraction_cursors[_extraction_cursor_key(agent_id, session_id)] = index
    _persist_extraction_cursor_state(agent_id)


async def _update_agent_memory(
    agent_id: uuid.UUID,
    messages: list[dict],
    tenant_id: uuid.UUID,
    *,
    session_id: str | None = None,
) -> None:
    """Extract facts from conversation and update the persistent semantic store.

    Uses cursor-based incremental extraction: only processes messages added since
    the last extraction for this agent. Falls back to full extraction on first run.
    """
    settings = get_settings()
    semantic_store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))

    # Incremental: only extract from messages since last cursor
    cursor = _get_extraction_cursor(agent_id, session_id)
    if cursor > 0 and cursor < len(messages):
        delta_messages = messages[cursor:]
        logger.debug(
            "[Memory] Incremental extraction for %s: %d new messages (cursor=%d, total=%d)",
            agent_id, len(delta_messages), cursor, len(messages),
        )
    else:
        delta_messages = messages

    # Load existing memory from the canonical store
    existing_facts = semantic_store.load_semantic_facts(agent_id)

    # Try LLM-powered fact extraction on delta messages only
    summary_model = await _get_summary_model_config(tenant_id)
    new_facts: list[dict] = []
    if summary_model:
        try:
            new_facts = await _extract_facts_with_llm(delta_messages, summary_model)
        except Exception as e:
            logger.debug("LLM fact extraction failed: %s", e)

    if not new_facts:
        # Simple extraction: pull key user statements
        new_facts = _extract_facts_simple(delta_messages)

    if not new_facts:
        # BP-A fix: Do NOT advance cursor when extraction fails.
        # Messages will be retried on next session end / idle dream.
        logger.debug("[Memory] No facts extracted for %s (cursor stays at %d)", agent_id, cursor)
        return

    all_facts = _merge_memory_facts(existing_facts, new_facts)
    semantic_store.replace_semantic_facts(agent_id, all_facts)
    _set_extraction_cursor(agent_id, len(messages), session_id)
    logger.info("Updated semantic memory store for agent %s: %d facts (delta=%d msgs)", agent_id, len(all_facts), len(delta_messages))


def _load_agent_memory(agent_id: uuid.UUID) -> str:
    """Load agent's structured memory from the canonical semantic store."""
    settings = get_settings()
    try:
        store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))
        return store.render_semantic_lines(agent_id)
    except Exception:
        return ""


_MEMORY_EXTRACTION_SYSTEM_PROMPT = (
    "Extract long-term memory facts from the provided session text.\n"
    "Store durable reusable facts here, not transient session state.\n"
    "Do NOT extract transient session state, temporary TODOs, or raw task transcripts.\n"
    "Use this layer for preferences, durable project context, reusable references, successful strategies, and blocked patterns.\n"
)


def _build_memory_extraction_prompt(session_text: str) -> str:
    return (
        "Session text:\n"
        f"{session_text}\n\n"
        "Layer boundaries:\n"
        "- Session summaries hold short-lived working state.\n"
        "- Long-term memory stores durable reusable facts.\n"
        "- policy-level evolution belongs in heartbeat/evolution flows, not raw conversation memory.\n\n"
        "Return a JSON array of memory facts."
    )


async def _extract_facts_with_llm(messages: list[dict], model_config: dict) -> list[dict]:
    """Use LLM to extract memorable facts from conversation."""
    from app.services.llm_client import LLMMessage, create_llm_client

    # Build condensed conversation text — include tool results and file writes (P0.3)
    conversation_text = []
    _tool_names: dict[str, str] = {}  # tool_call_id → tool_name
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            # Track tool_calls for name resolution even if no text content
            for tc in msg.get("tool_calls", []):
                _fn = tc.get("function", {})
                _tool_names[tc.get("id", "")] = _fn.get("name", "")
            continue

        if role in ("user", "assistant") and "tool_calls" not in msg:
            conversation_text.append(role + ": " + content[:600])
        elif role == "tool":
            # P0.3: Include high-value tool results in extraction input
            _tc_id = msg.get("tool_call_id", "")
            _tool_name = _tool_names.get(_tc_id, "unknown_tool")
            # Skip low-value tools (list_files, get_current_time, etc.)
            if _tool_name not in (
                "list_files", "get_current_time", "list_triggers",
                "list_tasks", "check_async_task", "tool_search",
            ):
                _preview = content[:500] if len(content) > 500 else content
                conversation_text.append("tool(" + _tool_name + "): " + _preview)

        # Track tool_calls for name resolution
        for tc in msg.get("tool_calls", []):
            _fn = tc.get("function", {})
            _tool_names[tc.get("id", "")] = _fn.get("name", "")

    if not conversation_text:
        return []

    # Was -40, too narrow for long conversations — tool results in early rounds got skipped
    text = "\n".join(conversation_text[-120:])
    prompt_text = _build_memory_extraction_prompt(text)

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[
                LLMMessage(
                    role="system",
                    content=(
                        _MEMORY_EXTRACTION_SYSTEM_PROMPT
                        + "Return a JSON array of objects with 'content', optional 'subject', and 'category' fields. Extract 2-8 facts max.\n"
                        "CATEGORIES (assign one per fact):\n"
                        "- user: preferences, role, knowledge, working style\n"
                        "- feedback: corrections, confirmations, behavioral guidance\n"
                        "- project: goals, deadlines, decisions, stable status updates\n"
                        "- reference: pointers to external systems, URLs, tool names\n"
                        "- constraint: hard rules the agent must follow\n"
                        "- strategy: successful approaches worth reusing\n"
                        "- blocked_pattern: approaches that failed — do not retry\n"
                        "- general: anything else\n"
                        "PRIORITY extraction targets (do NOT miss these):\n"
                        "1. User feedback, corrections, or preferences → category: feedback\n"
                        "2. Explicit instructions for future behavior → category: feedback\n"
                        "3. Important decisions or durable project context → category: project\n"
                        "4. Personal information or working style → category: user\n"
                        "5. Tool execution conclusions or discovered facts → category: reference\n"
                        "6. File write artifacts or created resources → category: project\n"
                        "7. External content key findings → category: reference\n"
                        "Respond ONLY with the JSON array, no other text."
                    ),
                ),
                LLMMessage(role="user", content=prompt_text),
            ],
            max_tokens=1000,
            temperature=0.3,
        )

        # Parse JSON from response
        raw = (response.content or "").strip()
        # Handle markdown code blocks
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()

        facts = json.loads(raw)
        if isinstance(facts, list):
            return [f for f in facts if isinstance(f, dict) and f.get("content")]
    except (json.JSONDecodeError, Exception) as e:
        logger.debug("Failed to parse LLM fact extraction: %s", e)
    finally:
        await client.close()

    return []


def _extract_facts_simple(messages: list[dict]) -> list[dict]:
    """Pattern-based fact extraction without LLM.

    Instead of blindly copying raw messages, detects semantic patterns:
    - User corrections ("不要", "别", "don't", "stop", "no,", "instead")
    - User preferences ("我喜欢", "I prefer", "总是", "always", "请用")
    - Decisions ("决定", "we'll go with", "let's use", "确定", "chosen")
    - Explicit instructions ("记住", "remember", "注意", "important")
    - Project facts ("deadline", "截止", "发布", "version", "环境")
    """
    import re

    _CORRECTION_PATTERNS = re.compile(
        r"不要|不是|别这样|don'?t|stop\s|no[,\s]|instead|错了|wrong|应该是|should be",
        re.IGNORECASE,
    )
    _PREFERENCE_PATTERNS = re.compile(
        r"我喜欢|I prefer|I like|总是|always|请用|use\s+\w+\s+instead|偏好|preferred",
        re.IGNORECASE,
    )
    _DECISION_PATTERNS = re.compile(
        r"决定|we'?ll go with|let'?s use|确定|chosen|选择|agreed|最终方案",
        re.IGNORECASE,
    )
    _INSTRUCTION_PATTERNS = re.compile(
        r"记住|remember|注意|important|必须|must\s|never\s|一定要|千万",
        re.IGNORECASE,
    )
    _PROJECT_PATTERNS = re.compile(
        r"deadline|截止|发布|release|version|v\d|环境|production|staging|上线",
        re.IGNORECASE,
    )

    _PATTERN_CATEGORY = [
        (_CORRECTION_PATTERNS, "feedback"),
        (_INSTRUCTION_PATTERNS, "constraint"),
        (_PREFERENCE_PATTERNS, "user"),
        (_DECISION_PATTERNS, "project"),
        (_PROJECT_PATTERNS, "project"),
    ]

    facts: list[dict] = []
    seen_snippets: set[str] = set()

    for msg in messages:
        role = msg.get("role", "")
        if role != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str) or len(content) < 10 or len(content) > 1000:
            continue
        if content.startswith("["):
            continue

        for pattern, category in _PATTERN_CATEGORY:
            if pattern.search(content):
                snippet = content[:300].strip()
                dedup_key = snippet[:60].lower()
                if dedup_key not in seen_snippets:
                    seen_snippets.add(dedup_key)
                    facts.append({
                        "content": snippet,
                        "category": category,
                        "source": "pattern_extraction",
                    })
                break  # One category per message

    return facts[-8:]


def _parse_session_uuid(session_id: str | None) -> uuid.UUID | None:
    if not session_id:
        return None
    try:
        return uuid.UUID(str(session_id))
    except (ValueError, TypeError) as exc:
        logger.debug("Invalid session UUID %s: %s", session_id, exc)
        return None


async def _load_session_summary(agent_id: uuid.UUID, session_id: str | None) -> str | None:
    session_uuid = _parse_session_uuid(session_id)
    if not session_uuid:
        return None

    async with async_session() as db:
        result = await db.execute(
            select(ChatSession.summary).where(
                ChatSession.id == session_uuid,
                ChatSession.summary.isnot(None),
                (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
            )
        )
        return result.scalar_one_or_none()


async def _load_previous_session_summary(agent_id: uuid.UUID, session_id: str | None) -> str | None:
    session_uuid = _parse_session_uuid(session_id)

    async with async_session() as db:
        query = (
            select(ChatSession.summary)
            .where(
                (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
                ChatSession.summary.isnot(None),
            )
            .order_by(ChatSession.last_message_at.desc(), ChatSession.created_at.desc())
            .limit(1)
        )
        if session_uuid:
            query = query.where(ChatSession.id != session_uuid)
        result = await db.execute(query)
        return result.scalar_one_or_none()


async def _save_session_summary(session_id: str, summary: str) -> None:
    session_uuid = _parse_session_uuid(session_id)
    if not session_uuid:
        return

    async with async_session() as db:
        result = await db.execute(select(ChatSession).where(ChatSession.id == session_uuid))
        session = result.scalar_one_or_none()
        if session:
            session.summary = summary
            # Update last_message_at so episodic retriever ranks this session correctly
            from datetime import datetime, timezone
            session.last_message_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info("Session summary saved for %s", session_id)


def _has_meaningful_messages(messages: list[dict]) -> bool:
    for msg in messages:
        if msg.get("role") not in {"user", "assistant"}:
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return True
    return False


def _read_memory_facts(memory_file: Path) -> list[dict]:
    if not memory_file.exists():
        return []

    try:
        facts = json.loads(memory_file.read_text(encoding="utf-8"))
        return facts if isinstance(facts, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _normalize_fact_value(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip().lower()
    return normalized.strip(" \t\r\n.,;:!?，。；：！？")


def _sanitize_fact(fact: dict, default_timestamp: str) -> dict | None:
    if not isinstance(fact, dict):
        return None

    raw_content = fact.get("content", fact.get("fact", ""))
    if not isinstance(raw_content, str) or not raw_content.strip():
        return None

    sanitized = dict(fact)
    sanitized["content"] = raw_content.strip()[:500]
    sanitized.setdefault("timestamp", default_timestamp)
    return sanitized


def _fact_identity(fact: dict) -> str | None:
    for key in ("memory_key", "key", "subject", "entity", "topic"):
        value = fact.get(key)
        if isinstance(value, str) and value.strip():
            return f"{key}:{_normalize_fact_value(value)}"

    content = fact.get("content", "")
    if isinstance(content, str) and content.strip():
        # Use significant words (3+ chars) sorted to catch semantic overlap
        # e.g., "User prefers Python" and "User prefers Go" share "user prefers"
        words = sorted(w for w in _normalize_fact_value(content).split() if len(w) >= 3)
        # If >60% of words overlap with the identity key, use the shared prefix
        # to enable dedup of conflicting facts about the same subject
        if len(words) >= 3:
            return f"content_sig:{' '.join(words[:5])}"
        return f"content:{_normalize_fact_value(content)}"
    return None


def _merge_memory_facts(
    existing_facts: list[dict],
    new_facts: list[dict],
    *,
    max_facts: int = 150,  # L-04: increased from 50 for 256K models
    expiry_days: int = 180,
    expiry_score_threshold: float = 0.3,
) -> list[dict]:
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    timestamp = now.isoformat()
    cutoff = now - timedelta(days=expiry_days)
    merged: list[dict] = []
    identities: dict[str, int] = {}

    for raw_fact in [*existing_facts, *new_facts]:
        fact = _sanitize_fact(raw_fact, timestamp)
        if not fact:
            continue

        # Expire stale low-value facts: older than expiry_days AND low relevance score
        fact_ts = fact.get("timestamp")
        if fact_ts and isinstance(fact_ts, str):
            from app.memory.types import parse_utc_timestamp

            fact_dt = parse_utc_timestamp(fact_ts)
            if fact_dt is not None:
                fact_score = float(fact.get("score", 1.0))
                if fact_dt < cutoff and fact_score < expiry_score_threshold:
                    continue

        identity = _fact_identity(fact)
        if not identity:
            continue

        if identity in identities:
            old_index = identities[identity]
            old_fact = merged[old_index]
            # Keep the higher-confidence fact; equal score = new wins (more recent) (CR-02)
            old_score = float(old_fact.get("score", 0.0))
            new_score = float(fact.get("score", 0.0))
            if new_score < old_score:
                continue  # Keep existing higher-score fact
            # New fact is better — replace old
            identities.pop(identity)
            merged.pop(old_index)
            for known_identity, known_index in list(identities.items()):
                if known_index > old_index:
                    identities[known_identity] = known_index - 1

        identities[identity] = len(merged)
        merged.append(fact)

    return merged[-max_facts:]


def _safe_split(old: list[dict], recent: list[dict]) -> tuple[list[dict], list[dict]]:
    """Ensure tool_call/tool_result pairs aren't split between old and recent.

    Handles three boundary cases:
    1. recent starts with tool results → move them to old (keep with their call)
    2. old ends with tool_calls but results are in recent → move call to recent
    3. old ends with tool_calls and no results anywhere → move call to recent

    Returns (old, recent) — same order as parameters.
    """
    if not recent or not old:
        return old, recent

    # Case 1: recent starts with tool results → pull them into old
    while recent and recent[0].get("role") == "tool":
        old.append(recent.pop(0))

    # Case 2+3: old ends with assistant+tool_calls but tool results are now
    # in recent or missing entirely → move the whole call into recent
    if old and old[-1].get("tool_calls"):
        # Count how many tool results should follow this call
        expected = len(old[-1].get("tool_calls", []))
        # Count trailing tool results already in old after the call
        trailing_tools = 0
        for i in range(len(old) - 1, -1, -1):
            if old[i].get("role") == "tool":
                trailing_tools += 1
            else:
                break
        if trailing_tools < expected:
            # Not all results present → move call (and any trailing results) to recent
            orphan = old.pop()  # assistant with tool_calls
            # Also move any trailing tool results that belong to this call
            moved_tools = []
            while old and old[-1].get("role") == "tool":
                moved_tools.insert(0, old.pop())
            recent = [orphan] + moved_tools + recent

    return old, recent
