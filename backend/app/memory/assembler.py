"""Assemble retrieved memory items into a prompt-ready text section.

Groups items by kind in priority order, deduplicates by content hash,
and trims output to a character budget.
"""

from __future__ import annotations

import hashlib

from app.memory.types import MemoryItem, MemoryKind

# Display order and section headers for each memory kind.
_SECTION_ORDER: list[tuple[MemoryKind, str]] = [
    (MemoryKind.WORKING, "[Working Memory]"),
    (MemoryKind.EPISODIC, "[Episodic Memory]"),
    (MemoryKind.SEMANTIC, "[Semantic Memory]"),
    (MemoryKind.EXTERNAL, "[External Memory]"),
]


def _content_hash(content: str) -> str:
    """Produce a short hash for deduplication."""
    return hashlib.md5(content.strip().lower().encode("utf-8")).hexdigest()  # noqa: S324


class MemoryAssembler:
    """Assemble retrieved memory items into a prompt section."""

    def assemble(self, items: list[MemoryItem], budget_chars: int = 4000) -> str:
        """Render memory items grouped by kind, deduplicated and budget-trimmed.

        Returns a string with section headers ready to inject into a system prompt.
        """
        # Deduplicate by content hash (first occurrence wins)
        seen: set[str] = set()
        unique_items: list[MemoryItem] = []
        for item in items:
            h = _content_hash(item.content)
            if h not in seen:
                seen.add(h)
                unique_items.append(item)

        # Group by kind
        groups: dict[MemoryKind, list[MemoryItem]] = {}
        for item in unique_items:
            groups.setdefault(item.kind, []).append(item)

        for kind_items in groups.values():
            kind_items.sort(key=lambda item: item.score, reverse=True)

        # Build output in priority order
        sections: list[str] = []
        total_chars = 0

        for kind, header in _SECTION_ORDER:
            kind_items = groups.get(kind)
            if not kind_items:
                continue

            lines: list[str] = [header]
            for item in kind_items:
                line = f"- {item.content}" if kind != MemoryKind.WORKING else item.content
                line_len = len(line) + 1  # +1 for newline
                if total_chars + line_len > budget_chars:
                    break
                lines.append(line)
                total_chars += line_len

            # Only add the section if it has content beyond the header
            if len(lines) > 1:
                sections.append("\n".join(lines))

            if total_chars >= budget_chars:
                break

        return "\n\n".join(sections)
