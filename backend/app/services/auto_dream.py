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

    # Distill evolution files into semantic_facts BEFORE replacing,
    # so the distilled facts are included in the consolidated set.
    evolution_facts = await _distill_evolution_to_facts(agent_id, tenant_id)
    if evolution_facts:
        from app.services.memory_service import _merge_memory_facts
        consolidated = _merge_memory_facts(consolidated, evolution_facts)

    store.replace_semantic_facts(agent_id, consolidated)

    # L3→L2 sync: LLM synthesizes consolidated facts into memory/memory.md
    # so agent_context "### Memory" section stays current with semantic store.
    await _sync_facts_to_memory_md(agent_id, consolidated, tenant_id)

    # L3→L1 promotion: LLM rephrases high-frequency feedback as personality traits
    await _promote_to_soul(agent_id, consolidated, tenant_id)

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


# ── L3 → L2 sync: semantic_facts → memory/memory.md ──────────────


_MEMORY_SYNTHESIS_PROMPT = (
    "You are synthesizing an agent's long-term memory into a clean markdown document.\n"
    "This document will be injected into the agent's system prompt as '### Memory'.\n\n"
    "Guidelines:\n"
    "- Group related facts into coherent sections with ## headers\n"
    "- Merge redundant facts into concise statements\n"
    "- Use natural prose or short bullet points — NOT raw database dumps\n"
    "- Prioritize: constraints > user preferences > strategies > project context > references\n"
    "- Keep the total under 2000 characters — this is a prompt section, not a full document\n"
    "- Write in the same language as the facts (likely Chinese or English)\n"
    "- Do NOT add speculation or commentary — only synthesize what the facts say\n"
    "- Output ONLY the markdown content, no preamble"
)

_SOUL_PROMOTION_PROMPT = (
    "You are updating an agent's personality document (soul.md).\n"
    "Below are behavioral patterns that have been repeatedly confirmed through experience.\n"
    "Rephrase each into a concise personality trait or behavioral rule that reads naturally\n"
    "as part of a character description.\n\n"
    "Guidelines:\n"
    "- Convert 'FEEDBACK: user prefers X' → 'I prioritize X in my work'\n"
    "- Convert 'CONSTRAINT: never do Y' → 'I avoid Y'\n"
    "- Each trait should be one sentence, written in first person\n"
    "- Output ONLY the bullet list, no headers or preamble\n"
    "- Write in the same language as the input facts"
)

_CATEGORY_DISPLAY_ORDER = [
    "constraint", "feedback", "user", "strategy",
    "blocked_pattern", "project", "reference", "general",
]

_CATEGORY_HEADERS = {
    "constraint": "Rules",
    "feedback": "Feedback & Corrections",
    "user": "User Profile",
    "strategy": "Strategies",
    "blocked_pattern": "Blocked Patterns",
    "project": "Project Context",
    "reference": "References",
    "general": "General",
}


async def _sync_facts_to_memory_md(
    agent_id: uuid.UUID, facts: list[dict], tenant_id: uuid.UUID,
) -> None:
    """Synthesize consolidated facts into memory/memory.md via LLM.

    Uses LLM to produce a coherent, readable memory document instead of
    mechanical bullet-point rendering. Falls back to programmatic render
    if LLM is unavailable.
    """
    if not facts:
        return

    # Build fact input for LLM
    fact_lines = []
    for f in facts:
        cat = f.get("category", "general")
        content = f.get("content", "").strip()
        if content:
            fact_lines.append(f"[{cat}] {content}")
    fact_text = "\n".join(fact_lines)

    # Try LLM synthesis
    content = await _llm_synthesize_memory(fact_text, tenant_id)

    if not content:
        # Fallback: programmatic rendering
        content = _render_facts_as_markdown(facts)

    _write_to_workspaces(agent_id, "memory/memory.md", content)
    logger.info("[AutoDream] Synced %d facts → memory.md for agent %s (llm=%s)", len(facts), agent_id, content != _render_facts_as_markdown(facts))


async def _llm_synthesize_memory(fact_text: str, tenant_id: uuid.UUID) -> str | None:
    """Use LLM to synthesize facts into a coherent memory document."""
    try:
        from app.services.memory_service import _get_summary_model_config
        from app.services.llm_client import LLMMessage, create_llm_client
    except ImportError as imp_err:
        logger.debug("[AutoDream] LLM imports unavailable for memory synthesis: %s", imp_err)
        return None

    model_config = await _get_summary_model_config(tenant_id)
    if not model_config:
        return None

    try:
        client = create_llm_client(**model_config)
        response = await client.stream(
            messages=[
                LLMMessage(role="system", content=_MEMORY_SYNTHESIS_PROMPT),
                LLMMessage(role="user", content=f"Facts to synthesize:\n\n{fact_text}"),
            ],
            max_tokens=2000,
            temperature=0.3,
        )
        result = response.content if hasattr(response, "content") else str(response)
        if result and not result.startswith("#"):
            result = "# Long-Term Memory\n\n" + result
        return result.strip() if result and len(result) > 20 else None
    except Exception as exc:
        logger.debug("[AutoDream] LLM memory synthesis failed: %s", exc)
        return None


def _render_facts_as_markdown(facts: list[dict]) -> str:
    """Programmatic fallback: render facts as categorized bullet list."""
    grouped: dict[str, list[str]] = {}
    for fact in facts:
        cat = fact.get("category", "general")
        content = fact.get("content", "").strip()
        if content:
            grouped.setdefault(cat, []).append(content)

    lines = ["# Long-Term Memory", ""]
    for cat in _CATEGORY_DISPLAY_ORDER:
        items = grouped.get(cat)
        if not items:
            continue
        header = _CATEGORY_HEADERS.get(cat, cat.title())
        lines.append(f"## {header}")
        for item in items:
            lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines)


# ── L3 → L1 promotion: high-frequency feedback/constraint → soul.md ──


async def _promote_to_soul(
    agent_id: uuid.UUID, facts: list[dict], tenant_id: uuid.UUID,
) -> None:
    """Promote high-frequency feedback/constraint facts to soul.md via LLM.

    If the same subject appears 3+ times in semantic facts, it's stable
    enough to become part of the agent's personality. Uses LLM to rephrase
    raw facts into natural personality traits. Falls back to direct append.
    """
    from collections import Counter

    promotable_categories = {"feedback", "constraint"}
    subject_counts: Counter[str] = Counter()
    subject_content: dict[str, str] = {}
    for fact in facts:
        cat = fact.get("category", "")
        if cat not in promotable_categories:
            continue
        subject = fact.get("subject") or fact.get("content", "")[:60].strip()
        if not subject:
            continue
        subject_counts[subject] += 1
        content = fact.get("content", "").strip()
        if len(content) > len(subject_content.get(subject, "")):
            subject_content[subject] = content

    promotable = [
        subject_content[subj]
        for subj, count in subject_counts.items()
        if count >= 3 and subj in subject_content
    ]
    if not promotable:
        return

    LEARNED_HEADER = "## Learned Behaviors"

    # Try LLM rephrasing
    rephrased = await _llm_rephrase_behaviors(promotable, tenant_id)

    # Resolve canonical workspace (F3 fix: single write target)
    from app.services.heartbeat import _get_canonical_workspace
    ws_root = _get_canonical_workspace(agent_id)
    if not ws_root:
        settings = get_settings()
        ws_root = Path(settings.AGENT_DATA_DIR) / str(agent_id)

    soul_path = ws_root / "soul.md"
    try:
        existing = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
    except Exception as read_err:
        logger.debug("[AutoDream] Failed to read soul.md: %s", read_err)
        existing = ""

    existing_lower = existing.lower()

    source = rephrased if rephrased else [f"- {c}" for c in promotable]
    new_behaviors = []
    for line in source:
        check = line.lstrip("- ").strip()[:80].lower()
        if check and check not in existing_lower:
            new_behaviors.append(line if line.startswith("- ") else f"- {line}")

    if not new_behaviors:
        return

    behavior_block = "\n".join(new_behaviors) + "\n"
    if LEARNED_HEADER in existing:
        idx = existing.index(LEARNED_HEADER) + len(LEARNED_HEADER)
        updated = existing[:idx] + "\n" + behavior_block + existing[idx:]
    else:
        # BP-D fix: Insert BEFORE the first ## heading so Learned Behaviors
        # survive prompt budget trimming (which cuts from the end).
        first_h2 = existing.find("\n## ")
        if first_h2 > 0:
            updated = (
                existing[:first_h2]
                + f"\n\n{LEARNED_HEADER}\n" + behavior_block
                + existing[first_h2:]
            )
        else:
            updated = existing.rstrip() + f"\n\n{LEARNED_HEADER}\n" + behavior_block

    try:
        soul_path.write_text(updated, encoding="utf-8")
        logger.info("[AutoDream] Promoted %d behaviors to soul.md for agent %s (llm=%s)", len(new_behaviors), agent_id, rephrased is not None)
    except Exception as exc:
        logger.debug("[AutoDream] Failed to write soul.md at %s: %s", soul_path, exc)


async def _llm_rephrase_behaviors(raw_facts: list[str], tenant_id: uuid.UUID) -> list[str] | None:
    """Use LLM to rephrase raw feedback facts into personality traits."""
    try:
        from app.services.memory_service import _get_summary_model_config
        from app.services.llm_client import LLMMessage, create_llm_client
    except ImportError as imp_err:
        logger.debug("[AutoDream] LLM imports unavailable for behavior rephrasing: %s", imp_err)
        return None

    model_config = await _get_summary_model_config(tenant_id)
    if not model_config:
        return None

    fact_text = "\n".join(f"- {f}" for f in raw_facts)
    try:
        client = create_llm_client(**model_config)
        response = await client.stream(
            messages=[
                LLMMessage(role="system", content=_SOUL_PROMOTION_PROMPT),
                LLMMessage(role="user", content=f"Behavioral patterns to rephrase:\n\n{fact_text}"),
            ],
            max_tokens=800,
            temperature=0.3,
        )
        result = response.content if hasattr(response, "content") else str(response)
        if not result:
            return None
        # Parse bullet list
        lines = [line.strip() for line in result.strip().splitlines() if line.strip().startswith("- ")]
        return lines if lines else None
    except Exception as exc:
        logger.debug("[AutoDream] LLM behavior rephrasing failed: %s", exc)
        return None


# ── Evolution distillation: evolution/* → semantic_facts ──────────

_EVOLUTION_DISTILL_PROMPT = (
    "You are distilling an agent's self-evolution data into structured memory facts.\n"
    "You will receive: performance scorecard, recent strategy lineage, and a blocklist.\n\n"
    "Produce a JSON array of facts. Each fact has: content (str), category (str).\n"
    "Categories to use:\n"
    "- blocked_pattern: approaches that failed (from blocklist + failed lineage entries)\n"
    "- strategy: approaches that worked (from successful lineage entries)\n"
    "- feedback: self-assessment insights (from scorecard trends)\n\n"
    "Rules:\n"
    "- Each fact under 200 chars, actionable and specific\n"
    "- Extract 3-8 facts total (only the most important)\n"
    "- Skip generic observations — only concrete, reusable insights\n"
    "- Write in the same language as the input\n"
    "- Return ONLY the JSON array, no other text"
)


async def _distill_evolution_to_facts(
    agent_id: uuid.UUID, tenant_id: uuid.UUID,
) -> list[dict]:
    """Read evolution files and distill them into typed semantic facts.

    This replaces direct injection of evolution/ into agent_context.
    Instead, evolution insights flow through the normal memory retrieval
    pipeline with proper scoring (blocked_pattern ×1.5, strategy ×1.2).
    """
    from app.services.heartbeat import _get_canonical_workspace

    ws_root = _get_canonical_workspace(agent_id)
    if not ws_root:
        return []

    # Read evolution files
    parts: list[str] = []
    for filename, label in [
        ("evolution/scorecard.md", "Performance Scorecard"),
        ("evolution/blocklist.md", "Blocked Approaches"),
        ("evolution/lineage.md", "Recent Strategy Lineage"),
    ]:
        fpath = ws_root / filename
        if fpath.exists():
            try:
                content = fpath.read_text(encoding="utf-8", errors="replace").strip()
                if content:
                    # For lineage, only take last 20 entries to keep prompt short
                    if "lineage" in filename:
                        lines = content.split("\n")
                        if len(lines) > 60:
                            content = "\n".join(lines[:3] + ["...(earlier omitted)..."] + lines[-50:])
                    parts.append(f"## {label}\n{content}")
            except Exception as read_err:
                logger.debug("[AutoDream] Failed to read %s: %s", filename, read_err)

    if not parts:
        return []

    evolution_text = "\n\n".join(parts)

    # Try LLM distillation
    facts = await _llm_distill_evolution(evolution_text, tenant_id)
    if facts:
        return facts

    # Fallback: extract blocklist entries mechanically as blocked_pattern facts
    return _mechanical_distill_blocklist(ws_root)


async def _llm_distill_evolution(
    evolution_text: str, tenant_id: uuid.UUID,
) -> list[dict] | None:
    """Use LLM to distill evolution data into structured facts."""
    try:
        from app.services.memory_service import _get_summary_model_config
        from app.services.llm_client import LLMMessage, create_llm_client
    except ImportError as imp_err:
        logger.debug("[AutoDream] LLM imports unavailable for evolution distill: %s", imp_err)
        return None

    model_config = await _get_summary_model_config(tenant_id)
    if not model_config:
        return None

    try:
        client = create_llm_client(**model_config)
        response = await client.stream(
            messages=[
                LLMMessage(role="system", content=_EVOLUTION_DISTILL_PROMPT),
                LLMMessage(role="user", content=f"Evolution data to distill:\n\n{evolution_text[:4000]}"),
            ],
            max_tokens=1500,
            temperature=0.3,
        )
        content = response.content if hasattr(response, "content") else str(response)
        start = content.find("[")
        end = content.rfind("]") + 1
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end])
            if isinstance(parsed, list):
                now = datetime.now(timezone.utc).isoformat()
                valid = []
                for f in parsed:
                    if isinstance(f, dict) and f.get("content"):
                        cat = f.get("category", "strategy")
                        if cat not in ("blocked_pattern", "strategy", "feedback"):
                            cat = "strategy"
                        valid.append({
                            "content": str(f["content"])[:200],
                            "category": cat,
                            "subject": "evolution_digest",
                            "timestamp": now,
                        })
                logger.info("[AutoDream] Distilled %d evolution facts for agent", len(valid))
                return valid if valid else None
    except Exception as exc:
        logger.debug("[AutoDream] LLM evolution distill failed: %s", exc)

    return None


def _mechanical_distill_blocklist(ws_root: Path) -> list[dict]:
    """Fallback: extract blocklist entries as blocked_pattern facts."""
    blocklist_path = ws_root / "evolution" / "blocklist.md"
    if not blocklist_path.exists():
        return []
    try:
        text = blocklist_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []

    now = datetime.now(timezone.utc).isoformat()
    facts: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("- ") and len(line) > 10:
            facts.append({
                "content": line[2:].strip()[:200],
                "category": "blocked_pattern",
                "subject": "evolution_digest",
                "timestamp": now,
            })
    return facts[:10]


def _write_to_workspaces(agent_id: uuid.UUID, rel_path: str, content: str) -> None:
    """Write content to the canonical workspace for an agent.

    Uses _get_canonical_workspace to resolve the single source-of-truth
    path instead of writing to both locations (F3 fix).
    """
    from app.services.heartbeat import _get_canonical_workspace

    ws_root = _get_canonical_workspace(agent_id)
    if not ws_root:
        # Fallback: try persistent data dir
        settings = get_settings()
        ws_root = Path(settings.AGENT_DATA_DIR) / str(agent_id)

    target = ws_root / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(content, encoding="utf-8")
    except Exception as exc:
        logger.debug("[AutoDream] Failed to write %s at %s: %s", rel_path, target, exc)
