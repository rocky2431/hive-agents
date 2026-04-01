"""Lightweight Recovery Manifest for high-fidelity post-compaction restoration.

Captures structured state about what to restore after context compression,
instead of relying solely on natural language summaries. Built from
SessionContext runtime tracking fields.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RecoveryManifest:
    """Structured record of what to restore after compaction."""

    session_id: str | None = None

    # Files the agent recently read or wrote
    recent_reads: list[str] = field(default_factory=list)
    recent_writes: list[str] = field(default_factory=list)

    # Tool execution outcomes worth preserving
    recent_tool_outcomes: list[dict[str, str]] = field(default_factory=list)

    # Skills and packs currently active
    active_skills: list[str] = field(default_factory=list)
    active_packs: list[str] = field(default_factory=list)

    # External resources referenced
    recent_external_refs: list[str] = field(default_factory=list)

    # Unfinished work
    pending_items: list[str] = field(default_factory=list)

    # Blocked patterns from evolution (do-not-retry list)
    blocked_patterns: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not any([
            self.recent_reads, self.recent_writes,
            self.recent_tool_outcomes, self.active_skills,
            self.active_packs, self.recent_external_refs,
            self.pending_items, self.blocked_patterns,
        ])

    def to_restoration_text(self, *, budget_chars: int = 20000) -> str:
        """Render manifest as structured text for prompt injection."""
        sections: list[str] = []
        total = 0

        def _add(title: str, items: list[str]) -> None:
            nonlocal total
            if not items or total >= budget_chars:
                return
            block = f"### {title}\n" + "\n".join(f"- {item}" for item in items)
            if total + len(block) < budget_chars:
                sections.append(block)
                total += len(block)

        _add("Recent Reads", self.recent_reads[-5:])
        _add("Recent Writes", self.recent_writes[-5:])
        _add("Recent Tool Results", [
            f"{o.get('tool', '?')}: {o.get('summary', '')}"
            for o in self.recent_tool_outcomes[-5:]
        ])
        _add("Active Skills", self.active_skills)
        _add("Active Packs", self.active_packs)
        _add("External References", self.recent_external_refs[-5:])
        _add("Pending Work", self.pending_items[-5:])
        _add("Blocked Patterns (DO NOT retry)", self.blocked_patterns[-5:])

        if not sections:
            return ""
        return "\n\n".join(sections)


def build_recovery_manifest(session_context: Any) -> RecoveryManifest:
    """Build a RecoveryManifest from the current SessionContext state."""
    if session_context is None:
        return RecoveryManifest()

    pack_names = []
    for p in getattr(session_context, "active_packs", []):
        if isinstance(p, dict):
            pack_names.append(p.get("name", "?"))

    return RecoveryManifest(
        session_id=getattr(session_context, "session_id", None),
        recent_reads=list(getattr(session_context, "recent_files", [])),
        recent_writes=list(getattr(session_context, "recent_writes", [])),
        recent_tool_outcomes=list(getattr(session_context, "recent_tool_outcomes", [])),
        active_skills=list(getattr(session_context, "active_skills", [])),
        active_packs=pack_names,
        recent_external_refs=list(getattr(session_context, "recent_external_refs", [])),
        pending_items=list(getattr(session_context, "pending_items", [])),
    )
