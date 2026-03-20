"""Compatibility memory store backed by the current file/database layout."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Awaitable, Callable


SummaryLoader = Callable[[uuid.UUID, str | None], Awaitable[str | None]]
MemoryLoader = Callable[[uuid.UUID], str]


class FileBackedMemoryStore:
    """Build runtime memory context from the current Clawith storage layout."""

    def __init__(
        self,
        *,
        data_root: Path,
        load_session_summary: SummaryLoader,
        load_previous_session_summary: SummaryLoader,
        load_agent_memory: MemoryLoader | None = None,
    ) -> None:
        self.data_root = Path(data_root)
        self.load_session_summary = load_session_summary
        self.load_previous_session_summary = load_previous_session_summary
        self.load_agent_memory = load_agent_memory or self._load_agent_memory

    async def build_context(
        self,
        *,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
        session_id: str | None = None,
    ) -> str:
        del tenant_id  # reserved for future backends

        parts: list[str] = []
        if session_id:
            current_summary = await self.load_session_summary(agent_id, session_id)
            if current_summary:
                parts.append(f"[Previous conversation summary]\n{current_summary}")
            else:
                previous_summary = await self.load_previous_session_summary(agent_id, session_id)
                if previous_summary:
                    parts.append(f"[Previous conversation summary]\n{previous_summary}")

        memory_text = self.load_agent_memory(agent_id)
        if memory_text:
            parts.append(f"[Agent memory]\n{memory_text}")

        return "\n\n".join(parts)

    def _load_agent_memory(self, agent_id: uuid.UUID) -> str:
        memory_file = self.data_root / str(agent_id) / "memory" / "memory.json"
        if not memory_file.exists():
            return ""

        try:
            facts = json.loads(memory_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return ""

        if not isinstance(facts, list) or not facts:
            return ""

        lines: list[str] = []
        for fact in facts[-15:]:
            if not isinstance(fact, dict):
                continue
            content = fact.get("content", fact.get("fact", ""))
            if content:
                lines.append(f"- {content}")
        return "\n".join(lines)
