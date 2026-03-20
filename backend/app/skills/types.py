"""Shared skill types."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class SkillMetadata:
    name: str
    description: str
    declared_tools: tuple[str, ...] = ()


@dataclass(slots=True)
class ParsedSkill:
    metadata: SkillMetadata
    body: str
    file_path: Path
    relative_path: str
