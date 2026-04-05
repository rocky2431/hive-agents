"""Extractor — T0→T2 memory extraction sub-agent.

Aligned with Claude Code's extractMemories architecture:
- Fire-and-forget from RESPONSE_COMPLETE hook
- Per-agent cursor (only process new messages since last extraction)
- Mutual exclusion + coalescing (concurrent safety)
- LLM primary extraction → pattern-based fallback
- Writes to T2 learnings/*.md (MD bullets), not SQLite

Pipeline: messages → LLM extract → append to learnings/{category}.md
Fallback: messages → regex patterns → append to learnings/{category}.md
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)


# ── Extraction prompt (aligned with Claude Code extractMemories) ──

EXTRACT_PROMPT = """\
You are the memory extraction sub-agent for {agent_name}.
Analyze the conversation below and extract anything worth remembering long-term.

## Extraction Types
| Type | Category | Signal |
|------|----------|--------|
| User correction / preference | feedback | "don't", "always", "I prefer", "stop doing X" |
| User role / knowledge / style | user | "I'm a", "my team", personal info |
| Agent insight / discovery | reference | "I found that", "the reason is", "turns out" |
| Execution error / failure | error | Tool failures, unexpected results, blocked approaches |
| Project decision / status | project | "we decided", "deadline is", "version X" |
| Capability gap / wish | request | "if only", "I wish", "can you add" |

## Rules
1. Only extract from the provided messages — do not infer or fabricate
2. Format each extraction as a single line: `[category] description`
3. Extract MORE rather than less — downstream curation will filter quality
4. Skip ephemeral task details (current file edits, transient debugging steps)
5. Prioritize: user corrections > preferences > decisions > discoveries > errors
6. Maximum 8 extractions per batch
7. If nothing worth extracting, respond with exactly: NOTHING

## Output Format
One extraction per line:
[feedback] User prefers snake_case for all Python variable names
[error] web_search tool fails when query contains Chinese characters
[project] Deadline for v2.0 is 2026-04-15

## Conversation
{conversation}
"""

# ── Category → T2 file mapping ──

_CATEGORY_FILE_MAP: dict[str, str] = {
    "feedback": "insights.md",
    "user": "insights.md",
    "reference": "insights.md",
    "error": "errors.md",
    "request": "requests.md",
    "project": "insights.md",
    "constraint": "insights.md",
    "strategy": "insights.md",
    "blocked_pattern": "errors.md",
    "general": "insights.md",
}

# ── Pattern-based extraction (fallback, zero LLM) ──

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

_PATTERN_MAP = [
    (_CORRECTION_PATTERNS, "feedback"),
    (_INSTRUCTION_PATTERNS, "feedback"),
    (_PREFERENCE_PATTERNS, "user"),
    (_DECISION_PATTERNS, "project"),
    (_PROJECT_PATTERNS, "project"),
]


def _pattern_extract(messages: list[dict]) -> list[dict[str, str]]:
    """Pattern-based extraction fallback. Returns list of {category, content}."""
    results: list[dict[str, str]] = []
    seen: set[str] = set()

    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str) or len(content) < 10 or len(content) > 1000:
            continue

        for pattern, category in _PATTERN_MAP:
            if pattern.search(content):
                snippet = content[:300].strip()
                dedup_key = snippet[:60].lower()
                if dedup_key not in seen:
                    seen.add(dedup_key)
                    results.append({"category": category, "content": snippet})
                break
    return results[-8:]


# ── LLM extraction ──


def _build_conversation_text(messages: list[dict], max_messages: int = 120) -> str:
    """Build condensed conversation text for LLM extraction prompt."""
    parts: list[str] = []
    tool_names: dict[str, str] = {}

    for msg in messages[-max_messages:]:
        role = msg.get("role", "")
        content = msg.get("content", "")

        # Track tool_call names for resolution
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            tool_names[tc.get("id", "")] = fn.get("name", "") if isinstance(fn, dict) else ""

        if not isinstance(content, str) or not content.strip():
            continue

        if role in ("user", "assistant") and "tool_calls" not in msg:
            parts.append(f"{role}: {content[:600]}")
        elif role == "tool":
            tc_id = msg.get("tool_call_id", "")
            tool_name = tool_names.get(tc_id, "unknown")
            # Skip low-value tools
            if tool_name not in ("list_files", "get_current_time", "list_triggers", "list_tasks", "tool_search"):
                parts.append(f"tool({tool_name}): {content[:300]}")

    return "\n".join(parts)


def _parse_extractions(raw: str) -> list[dict[str, str]]:
    """Parse LLM output lines like `[category] description` into structured dicts."""
    if not raw or raw.strip() == "NOTHING":
        return []

    results: list[dict[str, str]] = []
    pattern = re.compile(r"^\[(\w+)]\s+(.+)$", re.MULTILINE)
    for match in pattern.finditer(raw):
        category = match.group(1).lower()
        content = match.group(2).strip()
        if content and category in _CATEGORY_FILE_MAP:
            results.append({"category": category, "content": content})
    return results[:8]


async def _llm_extract(messages: list[dict], tenant_id: uuid.UUID, agent_name: str) -> list[dict[str, str]] | None:
    """Run LLM extraction. Returns None on failure (caller should fallback)."""
    from app.services.llm_client import LLMMessage, create_llm_client
    from app.services.memory_service import _get_summary_model_config

    model_config = await _get_summary_model_config(tenant_id)
    if not model_config:
        return None

    conversation_text = _build_conversation_text(messages)
    if not conversation_text:
        return None

    prompt = EXTRACT_PROMPT.format(agent_name=agent_name, conversation=conversation_text)

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[LLMMessage(role="user", content=prompt)],
            max_tokens=1000,
            temperature=0.3,
        )
        return _parse_extractions(response.content or "")
    except Exception as exc:
        logger.warning("[Extractor] LLM extraction failed: %s", exc)
        return None
    finally:
        await client.close()


# ── T2 file writer ──


def _append_to_learnings(agent_id: uuid.UUID, extractions: list[dict[str, str]]) -> int:
    """Append extractions to T2 learnings files. Returns count written."""
    if not extractions:
        return 0

    learnings_dir = Path(get_settings().AGENT_DATA_DIR) / str(agent_id) / "memory" / "learnings"
    learnings_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    written = 0

    # Group by target file
    by_file: dict[str, list[str]] = {}
    for ext in extractions:
        target = _CATEGORY_FILE_MAP.get(ext["category"], "insights.md")
        line = f"- [{today}] {ext['content']}"
        by_file.setdefault(target, []).append(line)

    for filename, lines in by_file.items():
        filepath = learnings_dir / filename
        try:
            # Read existing to dedup
            existing = ""
            if filepath.exists():
                existing = filepath.read_text(encoding="utf-8")

            new_lines = [ln for ln in lines if ln not in existing]
            if not new_lines:
                continue

            with open(filepath, "a", encoding="utf-8") as f:
                for ln in new_lines:
                    f.write(ln + "\n")
            written += len(new_lines)
        except Exception as exc:
            logger.error("[Extractor] Failed to write to %s: %s", filepath, exc)

    return written


# ── ExtractAgent (per-agent state management) ──


class ExtractAgent:
    """LLM-driven memory extraction sub-agent.

    Manages per-agent extraction state:
    - cursor: last processed message index (skip already-extracted messages)
    - mutex: mutual exclusion (one extraction at a time per agent)
    - pending: coalescing stash (merge concurrent requests)
    """

    def __init__(self) -> None:
        self._cursors: dict[str, int] = {}
        self._in_progress: dict[str, bool] = {}
        self._pending: dict[str, dict[str, Any]] = {}
        self._in_flight: dict[str, asyncio.Task[None]] = {}

    async def extract(
        self,
        agent_id: uuid.UUID,
        messages: list[dict] | None,
        source: str = "web",
        tenant_id: uuid.UUID | None = None,
        agent_name: str = "Agent",
    ) -> None:
        """Main entry — fire-and-forget extraction.

        If another extraction is in progress for this agent, stashes
        the request and runs a trailing extraction after the current one.
        """
        key = str(agent_id)
        msgs = messages or []

        if not msgs:
            return

        # Skip heartbeat source (heartbeat has its own T2 pipeline)
        if source == "heartbeat":
            return

        # Apply cursor — only process messages after last extraction
        cursor = self._cursors.get(key, 0)
        new_msgs = msgs[cursor:]
        if not new_msgs:
            return

        # Coalescing: if extraction in progress, stash for trailing run
        if self._in_progress.get(key):
            self._pending[key] = {
                "messages": msgs,
                "source": source,
                "tenant_id": tenant_id,
                "agent_name": agent_name,
            }
            logger.debug("[Extractor] Coalesced extraction for %s (in progress)", agent_id)
            return

        # Run extraction
        self._in_progress[key] = True
        try:
            await self._do_extract(agent_id, new_msgs, tenant_id, agent_name)
            # Advance cursor
            self._cursors[key] = len(msgs)
        finally:
            self._in_progress[key] = False

        # Trailing run: process stashed request
        pending = self._pending.pop(key, None)
        if pending:
            logger.debug("[Extractor] Running trailing extraction for %s", agent_id)
            await self.extract(
                agent_id=agent_id,
                messages=pending["messages"],
                source=pending["source"],
                tenant_id=pending["tenant_id"],
                agent_name=pending["agent_name"],
            )

    async def _do_extract(
        self,
        agent_id: uuid.UUID,
        messages: list[dict],
        tenant_id: uuid.UUID | None,
        agent_name: str,
    ) -> None:
        """Execute extraction: LLM primary → pattern fallback → write T2."""
        extractions: list[dict[str, str]] | None = None

        # LLM primary path
        if tenant_id:
            extractions = await _llm_extract(messages, tenant_id, agent_name)
            if extractions is not None:
                logger.info("[Extractor] LLM extracted %d items for %s", len(extractions), agent_id)

        # Pattern fallback
        if extractions is None:
            extractions = _pattern_extract(messages)
            if extractions:
                logger.info("[Extractor] Pattern extracted %d items for %s (LLM unavailable)", len(extractions), agent_id)

        # Write to T2
        if extractions:
            written = _append_to_learnings(agent_id, extractions)
            logger.info("[Extractor] Wrote %d items to T2 for %s", written, agent_id)

    async def drain(self, agent_id: uuid.UUID, timeout_s: float = 10.0) -> None:
        """Wait for any in-flight extraction to complete."""
        key = str(agent_id)
        task = self._in_flight.get(key)
        if task and not task.done():
            try:
                await asyncio.wait_for(task, timeout=timeout_s)
            except asyncio.TimeoutError:
                logger.warning("[Extractor] Drain timeout for %s after %.1fs", agent_id, timeout_s)

    def reset_cursor(self, agent_id: uuid.UUID) -> None:
        """Reset cursor for an agent (e.g., on new session)."""
        self._cursors.pop(str(agent_id), None)


# Module-level singleton
extract_agent = ExtractAgent()
