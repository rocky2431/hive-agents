"""Skill registry and catalog renderer."""

from __future__ import annotations

from collections import OrderedDict

from .types import ParsedSkill


class SkillRegistry:
    """Deduplicated registry keyed by display name."""

    def __init__(self) -> None:
        self._skills: "OrderedDict[str, ParsedSkill]" = OrderedDict()

    def register(self, skill: ParsedSkill) -> None:
        self._skills.setdefault(skill.metadata.name, skill)

    def register_many(self, skills: list[ParsedSkill]) -> None:
        for skill in skills:
            self.register(skill)

    def names(self) -> list[str]:
        return list(self._skills.keys())

    def resolve(self, name: str) -> ParsedSkill:
        if name in self._skills:
            return self._skills[name]

        normalized = self._normalize(name)
        for key, skill in self._skills.items():
            if self._normalize(key) == normalized:
                return skill

        raise KeyError(name)

    def load_body(self, name: str) -> str:
        return self.resolve(name).body

    def render_catalog(self) -> str:
        if not self._skills:
            return ""

        lines = [
            "You have the following skills available. Each skill defines specific instructions for a task domain.",
            "",
            "| Skill | Description | File |",
            "|-------|-------------|------|",
        ]
        for skill in self._skills.values():
            lines.append(
                f"| {skill.metadata.name} | {skill.metadata.description} | {skill.relative_path} |"
            )

        lines.extend(
            [
                "",
                "When a user request matches a skill, FIRST call `load_skill` with the Skill name above to load the full instructions.",
                "Do NOT guess what the skill contains — always read it first.",
                "Folder-based skills may contain auxiliary files (scripts/, references/, examples/). Use `read_file` on the skill folder when needed.",
            ]
        )
        return "\n".join(lines)

    @staticmethod
    def _normalize(name: str) -> str:
        return name.strip().lower().replace("_", "-").replace(" ", "-")
