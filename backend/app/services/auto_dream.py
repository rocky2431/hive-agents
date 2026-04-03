"""Auto-Dream — background memory consolidation service.

Periodically reviews recent session summaries and consolidates fragmented
semantic memories into structured knowledge. Inspired by Claude Code's DreamTask.

Trigger conditions (both must be met):
  - At least MIN_HOURS_BETWEEN_DREAMS hours since last consolidation
  - At least MIN_SESSIONS_SINCE_DREAM sessions since last consolidation

The consolidation process:
  1. Load recent session summaries
  2. Load existing semantic facts
  3. Use LLM to merge, deduplicate, and restructure
  4. Write consolidated facts back to the semantic store
"""

from __future__ import annotations

import logging
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

# Consolidation gates (aligned with Claude Code's auto-dream: 24h + 5 sessions)
MIN_HOURS_BETWEEN_DREAMS = 24
MIN_SESSIONS_SINCE_DREAM = 5

# Per-agent tracking (in-memory, resets on process restart)
_last_dream_time: dict[str, datetime] = {}
_sessions_since_dream: dict[str, int] = {}

_AUTO_DREAM_SYSTEM_PROMPT = (
    "You consolidate an agent's long-term memory into a clean, deduplicated fact list.\n"
    "Do NOT preserve transient task state, temporary TODOs, or raw session transcripts.\n"
    "Keep durable reusable facts, durable strategy lessons, and blocked patterns.\n"
    "Return only a JSON array — no prose, no explanation."
)


def _build_dream_consolidation_prompt(*, facts: list[dict], summaries: list[str]) -> str:
    facts_text = "\n".join(
        str(i) + ". [" + f.get("category", "general") + "] " + f.get("content", "")[:200]
        for i, f in enumerate(facts)
    )
    summaries_text = "\n---\n".join(s[:500] for s in summaries[:5])
    return (
        "You are consolidating an agent's long-term memory.\n\n"
        "## Current Facts\n" + facts_text + "\n\n"
        "## Recent Session Summaries\n" + summaries_text + "\n\n"
        "## Instructions\n"
        "1. Remove duplicate or contradictory facts (keep the newer/more specific one)\n"
        "2. Merge related facts into single comprehensive statements\n"
        "3. Add new facts from sessions that aren't already captured\n"
        "4. Assign each fact a category: user, feedback, project, reference, constraint, strategy, blocked_pattern, or general\n"
        "5. When facts contradict each other, keep the one from a more recent session summary\n"
        "6. Each fact should be concise (under 200 characters) — merge verbose entries into crisp statements\n"
        "7. Promote durable successful approaches to strategy\n"
        "8. Promote repeated failed approaches to blocked_pattern\n"
        "9. evolution files remain the home for active policy iteration; keep only the durable outcome here\n\n"
        "## What NOT to consolidate\n"
        "- Ephemeral task details (in-progress work, temporary state) — these belong in focus.md, not memory\n"
        "- Code patterns or file paths that can be derived by reading the workspace\n"
        "- Debugging solutions — the fix should be in the code, not in memory\n"
        "- Exact tool call sequences — only outcomes and learnings matter\n\n"
        "Return ONLY the JSON array, no other text."
    )


def _dream_state_path(agent_id: uuid.UUID) -> Path:
    return Path(get_settings().AGENT_DATA_DIR) / str(agent_id) / "memory" / "auto_dream_state.json"


def _load_dream_state(agent_id: uuid.UUID) -> tuple[datetime | None, int]:
    key = agent_id.hex
    if key in _sessions_since_dream or key in _last_dream_time:
        return _last_dream_time.get(key), _sessions_since_dream.get(key, 0)

    path = _dream_state_path(agent_id)
    if not path.exists():
        return None, 0
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug("[AutoDream] Failed to load dream state: %s", exc)
        return None, 0

    last_raw = payload.get("last_dream_time")
    sessions = payload.get("sessions_since_dream", 0)
    last = None
    if isinstance(last_raw, str):
        try:
            last = datetime.fromisoformat(last_raw)
        except ValueError:
            last = None
    if last is not None:
        _last_dream_time[key] = last
    _sessions_since_dream[key] = sessions if isinstance(sessions, int) else 0
    return _last_dream_time.get(key), _sessions_since_dream.get(key, 0)


def _persist_dream_state(agent_id: uuid.UUID) -> None:
    key = agent_id.hex
    path = _dream_state_path(agent_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_dream_time": _last_dream_time.get(key).isoformat() if _last_dream_time.get(key) else None,
        "sessions_since_dream": _sessions_since_dream.get(key, 0),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def record_session_end(agent_id: uuid.UUID) -> None:
    """Increment session counter for dream gate evaluation."""
    key = agent_id.hex
    _, sessions = _load_dream_state(agent_id)
    _sessions_since_dream[key] = sessions + 1
    _persist_dream_state(agent_id)


def should_dream(agent_id: uuid.UUID) -> bool:
    """Check if both time and session gates are met for consolidation."""
    last, sessions = _load_dream_state(agent_id)
    if last is not None:
        hours_since = (datetime.now(timezone.utc) - last).total_seconds() / 3600
        if hours_since < MIN_HOURS_BETWEEN_DREAMS:
            return False

    return sessions >= MIN_SESSIONS_SINCE_DREAM


async def run_dream(agent_id: uuid.UUID, tenant_id: uuid.UUID) -> dict:
    """Execute memory consolidation for an agent.

    Returns a summary dict with keys: consolidated, removed, added.
    """
    from app.memory.store import PersistentMemoryStore

    key = agent_id.hex
    settings = get_settings()
    store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))

    # Load existing facts
    existing_facts = store.load_semantic_facts(agent_id)
    if not existing_facts:
        _mark_dreamed(key)
        return {"consolidated": 0, "removed": 0, "added": 0}

    # Load recent session summaries
    summaries = await _load_recent_summaries(agent_id, limit=10)
    if not summaries:
        _mark_dreamed(key)
        return {"consolidated": 0, "removed": 0, "added": 0}

    # Backup existing facts before consolidation (BP-3 fix)
    _backup_facts(agent_id, existing_facts)

    # Try LLM consolidation
    consolidated = await _consolidate_with_llm(existing_facts, summaries, tenant_id)
    if consolidated is None:
        # LLM failed — fall back to simple dedup
        consolidated = _simple_dedup(existing_facts)

    before_count = len(existing_facts)
    after_count = len(consolidated)

    # Safety gate: reject consolidation if it loses >70% of facts
    if after_count < before_count * 0.3 and before_count >= 5:
        logger.warning(
            "[AutoDream] Rejected consolidation for %s: %d → %d facts (>70%% loss). Backup preserved.",
            agent_id, before_count, after_count,
        )
        _mark_dreamed(key)
        return {"consolidated": before_count, "removed": 0, "added": 0}

    store.replace_semantic_facts(agent_id, consolidated)
    _mark_dreamed(key)

    result = {
        "consolidated": after_count,
        "removed": max(0, before_count - after_count),
        "added": max(0, after_count - before_count),
    }
    logger.info(
        "[AutoDream] Consolidated memory for %s: %d → %d facts (%d removed, %d added)",
        agent_id, before_count, after_count, result["removed"], result["added"],
    )
    return result


_DREAM_BACKUP_MAX = 3


def _backup_facts(agent_id: uuid.UUID, facts: list[dict]) -> None:
    """Write a timestamped backup of facts before consolidation. Keep last 3."""
    backup_dir = Path(get_settings().AGENT_DATA_DIR) / str(agent_id) / "memory" / "dream_backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"dream_backup_{stamp}.json"
    try:
        backup_path.write_text(json.dumps(facts, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.debug("[AutoDream] Failed to write backup: %s", exc)
        return

    # Rotate: keep only the most recent backups
    backups = sorted(backup_dir.glob("dream_backup_*.json"), key=lambda p: p.name)
    for old in backups[:-_DREAM_BACKUP_MAX]:
        try:
            old.unlink()
        except OSError as rm_err:
            logger.debug("[AutoDream] Failed to remove old backup %s: %s", old.name, rm_err)


def _mark_dreamed(key: str) -> None:
    _last_dream_time[key] = datetime.now(timezone.utc)
    _sessions_since_dream[key] = 0
    try:
        _persist_dream_state(uuid.UUID(hex=key))
    except Exception:
        logger.debug("[AutoDream] Failed to persist dream state for %s", key)


async def _load_recent_summaries(agent_id: uuid.UUID, *, limit: int = 10) -> list[str]:
    """Load recent session summaries from DB.

    Prioritizes user-facing sessions (web, feishu, slack, etc.) over internal
    operations (heartbeat, trigger) to prevent operational noise from polluting
    the consolidation input. Internal summaries are prefixed with [internal]
    so the LLM can de-prioritize them.
    """
    _INTERNAL_CHANNELS = frozenset({"heartbeat", "trigger"})

    try:
        from app.database import async_session
        from app.models.chat_session import ChatSession
        from sqlalchemy import select

        async with async_session() as db:
            # Load user-facing sessions first (up to limit-2)
            user_limit = max(limit - 2, limit // 2)
            user_result = await db.execute(
                select(ChatSession.summary, ChatSession.source_channel)
                .where(
                    (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
                    ChatSession.summary.isnot(None),
                    ChatSession.source_channel.notin_(_INTERNAL_CHANNELS),
                )
                .order_by(ChatSession.last_message_at.desc())
                .limit(user_limit)
            )
            user_rows = user_result.all()

            # Fill remaining slots with internal sessions
            internal_limit = limit - len(user_rows)
            internal_rows: list[tuple] = []
            if internal_limit > 0:
                internal_result = await db.execute(
                    select(ChatSession.summary, ChatSession.source_channel)
                    .where(
                        (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
                        ChatSession.summary.isnot(None),
                        ChatSession.source_channel.in_(_INTERNAL_CHANNELS),
                    )
                    .order_by(ChatSession.last_message_at.desc())
                    .limit(internal_limit)
                )
                internal_rows = internal_result.all()

        summaries: list[str] = []
        for summary, _channel in user_rows:
            if summary:
                summaries.append(summary)
        for summary, channel in internal_rows:
            if summary:
                summaries.append(f"[internal:{channel}] {summary}")
        return summaries
    except Exception as exc:
        logger.debug("[AutoDream] Failed to load summaries: %s", exc)
        return []


async def _consolidate_with_llm(
    facts: list[dict],
    summaries: list[str],
    tenant_id: uuid.UUID,
) -> list[dict] | None:
    """Use LLM to merge and deduplicate facts against recent session context."""
    try:
        from app.services.memory_service import _get_summary_model_config
        from app.services.llm_client import LLMMessage, create_llm_client
    except ImportError:
        logger.debug("[AutoDream] LLM client not available for consolidation")
        return None

    model_config = await _get_summary_model_config(tenant_id)
    if not model_config:
        return None

    prompt = _build_dream_consolidation_prompt(facts=facts, summaries=summaries)

    try:
        client = create_llm_client(**model_config)
        response = await client.stream(
            messages=[
                LLMMessage(
                    role="system",
                    content=_AUTO_DREAM_SYSTEM_PROMPT,
                ),
                LLMMessage(role="user", content=prompt),
            ],
            max_tokens=4000,
            temperature=0.3,
        )
        content = response.content if hasattr(response, "content") else str(response)
        if hasattr(client, "close"):
            await client.close()

        import json
        start = content.find("[")
        end = content.rfind("]") + 1
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end])
            if isinstance(parsed, list):
                return [f for f in parsed if isinstance(f, dict) and f.get("content")]
    except Exception as exc:
        logger.debug("[AutoDream] LLM consolidation failed: %s", exc)

    return None


def _simple_dedup(facts: list[dict]) -> list[dict]:
    """Fallback deduplication by content similarity."""
    seen: set[str] = set()
    unique: list[dict] = []
    for fact in facts:
        content = fact.get("content", "").strip().lower()
        if content and content not in seen:
            seen.add(content)
            unique.append(fact)
    return unique
