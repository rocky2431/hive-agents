"""Explicit session context types for runtime entrypoints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class SessionContext:
    session_id: str | None = None
    source: str = "runtime"
    channel: str | None = None
    active_packs: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    # Prompt cache: frozen prefix reused within the same session
    prompt_prefix: str | None = None
    prompt_fingerprint: str | None = None
    # Memory hash for cache invalidation — rebuilt when memory context changes
    _memory_hash: str | None = None
    # Post-compact restoration: track recently-read files and active skills
    recent_files: list[str] = field(default_factory=list)  # file paths read by agent
    active_skills: list[str] = field(default_factory=list)  # skill names loaded via load_skill

    def track_file_read(self, path: str) -> None:
        """Record a file read for post-compact restoration. Keeps last 5 unique paths."""
        if path in self.recent_files:
            self.recent_files.remove(path)
        self.recent_files.append(path)
        if len(self.recent_files) > 5:
            self.recent_files.pop(0)

    def track_skill_loaded(self, skill_name: str) -> None:
        """Record a skill activation for post-compact restoration."""
        if skill_name not in self.active_skills:
            self.active_skills.append(skill_name)
