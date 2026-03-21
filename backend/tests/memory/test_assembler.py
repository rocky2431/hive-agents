"""Tests for the memory assembler."""

from __future__ import annotations

from app.memory.assembler import MemoryAssembler
from app.memory.types import MemoryItem, MemoryKind


def _make_item(kind: MemoryKind, content: str, score: float = 0.5) -> MemoryItem:
    return MemoryItem(kind=kind, content=content, score=score, source="test")


class TestAssembleGroupsByKind:
    """Output has section headers in correct order."""

    def test_all_sections_present(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "User prefers dark mode"),
            _make_item(MemoryKind.WORKING, "Current focus: deploy v2"),
            _make_item(MemoryKind.EPISODIC, "Previously discussed auth flow"),
            _make_item(MemoryKind.EXTERNAL, "Viking: project architecture doc"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert "[Working Memory]" in result
        assert "[Episodic Memory]" in result
        assert "[Semantic Memory]" in result
        assert "[External Memory]" in result

    def test_section_order(self) -> None:
        """Working -> Episodic -> Semantic -> External."""
        items = [
            _make_item(MemoryKind.EXTERNAL, "external fact"),
            _make_item(MemoryKind.SEMANTIC, "semantic fact"),
            _make_item(MemoryKind.WORKING, "working focus"),
            _make_item(MemoryKind.EPISODIC, "episodic summary"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        working_pos = result.index("[Working Memory]")
        episodic_pos = result.index("[Episodic Memory]")
        semantic_pos = result.index("[Semantic Memory]")
        external_pos = result.index("[External Memory]")

        assert working_pos < episodic_pos < semantic_pos < external_pos

    def test_empty_items(self) -> None:
        assembler = MemoryAssembler()
        result = assembler.assemble([])
        assert result == ""

    def test_single_kind(self) -> None:
        items = [_make_item(MemoryKind.SEMANTIC, "fact one"), _make_item(MemoryKind.SEMANTIC, "fact two")]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert "[Semantic Memory]" in result
        assert "- fact one" in result
        assert "- fact two" in result
        assert "[Working Memory]" not in result

    def test_working_memory_no_bullet(self) -> None:
        """Working memory content is rendered without bullet prefix."""
        items = [_make_item(MemoryKind.WORKING, "Current focus: ship feature")]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert "Current focus: ship feature" in result
        assert "- Current focus" not in result

    def test_higher_score_items_render_first_within_section(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "low score fact", score=0.2),
            _make_item(MemoryKind.SEMANTIC, "high score fact", score=0.9),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert result.index("high score fact") < result.index("low score fact")


class TestAssembleBudgetTrim:
    """Output respects budget_chars limit."""

    def test_trim_to_budget(self) -> None:
        items = [_make_item(MemoryKind.SEMANTIC, f"fact number {i} with extra padding words") for i in range(100)]
        assembler = MemoryAssembler()
        result = assembler.assemble(items, budget_chars=200)

        assert len(result) <= 250  # header + some slack for section header
        assert "[Semantic Memory]" in result

    def test_small_budget_still_produces_output(self) -> None:
        items = [_make_item(MemoryKind.WORKING, "short")]
        assembler = MemoryAssembler()
        result = assembler.assemble(items, budget_chars=50)

        assert "[Working Memory]" in result
        assert "short" in result

    def test_budget_prioritizes_earlier_sections(self) -> None:
        """When budget is tight, working memory (first) gets included over external (last)."""
        items = [
            _make_item(MemoryKind.WORKING, "A" * 100),
            _make_item(MemoryKind.EXTERNAL, "B" * 100),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items, budget_chars=120)

        assert "[Working Memory]" in result
        # External may be trimmed out due to budget
        assert "B" * 100 not in result

    def test_budget_keeps_highest_scored_items_first(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "very long but high score " + ("A" * 80), score=0.95),
            _make_item(MemoryKind.SEMANTIC, "very long but low score " + ("B" * 80), score=0.10),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items, budget_chars=120)

        assert "very long but high score" in result
        assert "very long but low score" not in result


class TestAssembleDedup:
    """Duplicate items are removed."""

    def test_exact_duplicates_removed(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "User prefers dark mode"),
            _make_item(MemoryKind.SEMANTIC, "User prefers dark mode"),
            _make_item(MemoryKind.SEMANTIC, "User prefers dark mode"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert result.count("User prefers dark mode") == 1

    def test_case_insensitive_dedup(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "User prefers dark mode"),
            _make_item(MemoryKind.SEMANTIC, "user prefers dark mode"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        # Both normalize to same hash, so only one kept
        count = result.lower().count("user prefers dark mode")
        assert count == 1

    def test_different_content_preserved(self) -> None:
        items = [
            _make_item(MemoryKind.SEMANTIC, "fact alpha"),
            _make_item(MemoryKind.SEMANTIC, "fact beta"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert "fact alpha" in result
        assert "fact beta" in result

    def test_cross_kind_dedup(self) -> None:
        """Same content in different kinds is still deduplicated."""
        items = [
            _make_item(MemoryKind.SEMANTIC, "shared fact"),
            _make_item(MemoryKind.EXTERNAL, "shared fact"),
        ]
        assembler = MemoryAssembler()
        result = assembler.assemble(items)

        assert result.count("shared fact") == 1
