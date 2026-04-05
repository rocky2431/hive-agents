"""§ Knowledge section — external knowledge retrieval results."""

from __future__ import annotations


def build_knowledge_section(retrieval_context: str = "", *, budget_chars: int = 3000) -> str:
    """Build the knowledge retrieval section.

    Args:
        retrieval_context: Pre-fetched knowledge text from fetch_relevant_knowledge().
        budget_chars: Max chars for the knowledge section.
    """
    if not retrieval_context or not retrieval_context.strip():
        return ""

    text = retrieval_context.strip()
    if len(text) > budget_chars:
        # Trim by lines to avoid cutting mid-sentence
        lines = text.splitlines()
        kept: list[str] = []
        used = 0
        for line in lines:
            cost = len(line) + 1
            if used + cost > budget_chars:
                break
            kept.append(line)
            used += cost
        text = "\n".join(kept) + "\n..."

    return text
