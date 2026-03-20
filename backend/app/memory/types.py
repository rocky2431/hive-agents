"""Lightweight memory layer types used by the compatibility store."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class WorkingMemory:
    content: str = ""
    source: str = "focus"


@dataclass(slots=True)
class EpisodicMemory:
    summary: str = ""
    session_id: str | None = None


@dataclass(slots=True)
class SemanticMemory:
    subject: str = ""
    content: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExternalMemoryRef:
    source: str
    content: str
