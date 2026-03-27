"""Unified Memory Service — conversation lifecycle management.

Covers three phases:
  1. on_conversation_start: inject previous session summary + agent memory
  2. maybe_compress_messages: LLM-powered compression near context window limit
  3. on_conversation_end: persist summary, extract memory facts, share to OpenViking
"""

from __future__ import annotations

import json
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
) -> str:
    """Build a session-start memory snapshot for frozen prompt prefixes."""
    return await build_memory_context(
        agent_id,
        tenant_id,
        session_id=session_id,
        query="",
    )


async def build_memory_context(
    agent_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    session_id: str | None = None,
    query: str = "",
) -> str:
    """Build a self-consistent memory context for any runtime entrypoint.

    Uses the four-layer retrieval pipeline (working, episodic, semantic, external)
    followed by the assembler. Falls back to FileBackedMemoryStore on failure.
    """
    try:
        retriever = MemoryRetriever(data_root=Path(get_settings().AGENT_DATA_DIR))
        items = await retriever.retrieve(
            agent_id,
            query,
            session_id,
            str(tenant_id) if tenant_id else None,
        )
        assembler = MemoryAssembler()
        result = assembler.assemble(items)
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


def compute_history_limit(
    provider: str,
    model_name: str,
    max_input_tokens_override: int | None = None,
) -> int:
    """Compute how many history messages to load from DB based on model context window.

    The goal is to load enough history to utilize the model's capacity while keeping
    DB queries efficient. The compression layer (maybe_compress_messages) will handle
    the actual token budget — this function just sets a reasonable upper bound.

    Allocation: ~50% of context window for history, rest for system prompt + tools + generation.
    Average message estimated at ~300 tokens (mix of short user msgs and longer assistant/tool msgs).
    """
    context_limit = _get_input_context_limit(provider, model_name, max_input_tokens_override)
    history_token_budget = int(context_limit * 0.50)
    avg_tokens_per_message = 300
    computed = history_token_budget // avg_tokens_per_message
    # Clamp: at least 20 (usable minimum), at most 500 (DB performance guard)
    return max(20, min(computed, 500))


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
                    select(LLMModel).where(LLMModel.id == agent.primary_model_id)
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
    threshold = compress_threshold if compress_threshold is not None else config.get("compress_threshold", 70) / 100.0
    recent_count = keep_recent if keep_recent is not None else config.get("keep_recent", 10)

    # Resolve context window
    context_limit = _get_input_context_limit(model_provider, model_name, max_input_tokens_override)
    trigger_tokens = int(context_limit * threshold)

    current_tokens = estimate_tokens(messages)
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

    try:
        summary = await _generate_session_summary(messages, tenant_id)
        if summary and session_id:
            await _save_session_summary(session_id, summary)

        await _update_agent_memory(agent_id, messages, tenant_id)

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

    except Exception as exc:
        logger.error("persist_runtime_memory failed (non-fatal): %s", exc, exc_info=True)


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
                select(LLMModel).where(LLMModel.id == uuid.UUID(str(model_id)))
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


async def _update_agent_memory(agent_id: uuid.UUID, messages: list[dict], tenant_id: uuid.UUID) -> None:
    """Extract facts from conversation and update the persistent semantic store."""
    settings = get_settings()
    semantic_store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))

    # Load existing memory from the canonical store
    existing_facts = semantic_store.load_semantic_facts(agent_id)

    # Try LLM-powered fact extraction
    summary_model = await _get_summary_model_config(tenant_id)
    new_facts: list[dict] = []
    if summary_model:
        try:
            new_facts = await _extract_facts_with_llm(messages, summary_model)
        except Exception as e:
            logger.debug("LLM fact extraction failed: %s", e)

    if not new_facts:
        # Simple extraction: pull key user statements
        new_facts = _extract_facts_simple(messages)

    if not new_facts:
        return

    all_facts = _merge_memory_facts(existing_facts, new_facts)
    semantic_store.replace_semantic_facts(agent_id, all_facts)
    logger.info("Updated semantic memory store for agent %s: %d facts", agent_id, len(all_facts))


def _load_agent_memory(agent_id: uuid.UUID) -> str:
    """Load agent's structured memory from the canonical semantic store."""
    settings = get_settings()
    try:
        store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))
        return store.render_semantic_lines(agent_id)
    except Exception:
        return ""


async def _extract_facts_with_llm(messages: list[dict], model_config: dict) -> list[dict]:
    """Use LLM to extract memorable facts from conversation."""
    from app.services.llm_client import LLMMessage, create_llm_client

    # Build condensed conversation text
    conversation_text = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        if role in ("user", "assistant") and "tool_calls" not in msg:
            conversation_text.append(f"{role}: {content[:300]}")

    if not conversation_text:
        return []

    text = "\n".join(conversation_text[-15:])

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[
                LLMMessage(
                    role="system",
                    content=(
                        "Extract key facts from this conversation that would be useful to remember for future interactions. "
                        "Return a JSON array of objects with 'content' and optional 'subject' fields. Extract 2-5 facts max. "
                        "Focus on: user preferences, important decisions, project details, personal information shared. "
                        "Respond ONLY with the JSON array, no other text."
                    ),
                ),
                LLMMessage(role="user", content=text),
            ],
            max_tokens=500,
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
    """Simple fact extraction without LLM — pull key user statements."""
    facts = []
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        # Keep substantive user messages (not short greetings)
        if len(content) > 30 and len(content) < 500:
            facts.append({"content": content[:200], "source": "user_message"})

    return facts[-3:]  # Keep at most 3


def _parse_session_uuid(session_id: str | None) -> uuid.UUID | None:
    if not session_id:
        return None
    try:
        return uuid.UUID(str(session_id))
    except (ValueError, TypeError):
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
        return f"content:{_normalize_fact_value(content)}"
    return None


def _merge_memory_facts(
    existing_facts: list[dict],
    new_facts: list[dict],
    *,
    max_facts: int = 50,
) -> list[dict]:
    from datetime import datetime, timezone

    timestamp = datetime.now(timezone.utc).isoformat()
    merged: list[dict] = []
    identities: dict[str, int] = {}

    for raw_fact in [*existing_facts, *new_facts]:
        fact = _sanitize_fact(raw_fact, timestamp)
        if not fact:
            continue

        identity = _fact_identity(fact)
        if not identity:
            continue

        if identity in identities:
            old_index = identities.pop(identity)
            merged.pop(old_index)
            for known_identity, known_index in list(identities.items()):
                if known_index > old_index:
                    identities[known_identity] = known_index - 1

        identities[identity] = len(merged)
        merged.append(fact)

    return merged[-max_facts:]


def _safe_split(old: list[dict], recent: list[dict]) -> tuple[list[dict], list[dict]]:
    """Ensure tool_call/tool_result pairs aren't split between old and recent.

    If the first message in 'recent' is a tool result, move it back into 'old'.
    Returns (old, recent) — same order as parameters.
    """
    if not recent or not old:
        return old, recent

    # If recent starts with a tool result, pull it into old
    while recent and recent[0].get("role") == "tool":
        old.append(recent.pop(0))

    # If old ends with an assistant message with tool_calls but no tool result follows,
    # move it to recent so the pair stays together
    if old and old[-1].get("tool_calls") and recent and recent[0].get("role") != "tool":
        recent.insert(0, old.pop())

    return old, recent
