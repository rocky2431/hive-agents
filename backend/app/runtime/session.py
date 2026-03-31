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
