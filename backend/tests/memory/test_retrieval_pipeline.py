"""Tests for the four-layer memory retrieval pipeline."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.memory.retriever import MemoryRetriever, _score_relevance
from app.memory.types import MemoryKind


@pytest.fixture()
def agent_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def data_root(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture()
def retriever(data_root: Path) -> MemoryRetriever:
    return MemoryRetriever(data_root=data_root)


def _setup_focus(data_root: Path, agent_id: uuid.UUID, content: str) -> None:
    focus_file = data_root / str(agent_id) / "focus.md"
    focus_file.parent.mkdir(parents=True, exist_ok=True)
    focus_file.write_text(content, encoding="utf-8")


def _setup_memory_json(data_root: Path, agent_id: uuid.UUID, facts: list[dict]) -> None:
    memory_file = data_root / str(agent_id) / "memory" / "memory.json"
    memory_file.parent.mkdir(parents=True, exist_ok=True)
    memory_file.write_text(json.dumps(facts, ensure_ascii=False), encoding="utf-8")


@pytest.mark.asyncio
async def test_retrieve_returns_four_layers(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Working + semantic items returned in order; episodic/external degrade gracefully."""
    _setup_focus(data_root, agent_id, "Current focus: ship memory engine P1")
    _setup_memory_json(
        data_root,
        agent_id,
        [
            {"content": "User prefers dark mode"},
            {"content": "Project uses FastAPI and React"},
        ],
    )

    items = await retriever.retrieve(agent_id, "memory engine", session_id=None, tenant_id=None)

    # Working memory should be first
    working_items = [i for i in items if i.kind == MemoryKind.WORKING]
    assert len(working_items) == 1
    assert "ship memory engine P1" in working_items[0].content

    # Semantic items should follow
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]
    assert len(semantic_items) == 2

    # Episodic and external degrade to empty without DB/OpenViking
    episodic_items = [i for i in items if i.kind == MemoryKind.EPISODIC]
    external_items = [i for i in items if i.kind == MemoryKind.EXTERNAL]
    assert len(episodic_items) == 0
    assert len(external_items) == 0

    # Verify ordering: working before semantic
    kinds = [i.kind for i in items]
    working_idx = kinds.index(MemoryKind.WORKING)
    first_semantic_idx = kinds.index(MemoryKind.SEMANTIC)
    assert working_idx < first_semantic_idx


@pytest.mark.asyncio
async def test_retrieve_no_files(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Retriever returns empty list when no agent data exists."""
    items = await retriever.retrieve(agent_id, "anything", session_id=None, tenant_id=None)
    assert items == []


@pytest.mark.asyncio
async def test_retrieve_empty_focus(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Empty focus.md produces no working memory items."""
    _setup_focus(data_root, agent_id, "")
    items = await retriever.retrieve(agent_id, "", session_id=None, tenant_id=None)
    working_items = [i for i in items if i.kind == MemoryKind.WORKING]
    assert len(working_items) == 0


@pytest.mark.asyncio
async def test_retrieve_malformed_memory_json(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Malformed memory.json is handled gracefully."""
    memory_file = data_root / str(agent_id) / "memory" / "memory.json"
    memory_file.parent.mkdir(parents=True, exist_ok=True)
    memory_file.write_text("not valid json {{{", encoding="utf-8")

    items = await retriever.retrieve(agent_id, "test", session_id=None, tenant_id=None)
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]
    assert len(semantic_items) == 0


def test_semantic_scoring_relevant_higher() -> None:
    """Relevant facts score higher than irrelevant ones."""
    high_score = _score_relevance("memory engine retrieval pipeline", "memory engine")
    low_score = _score_relevance("user likes dark theme colors", "memory engine")
    assert high_score > low_score


def test_semantic_scoring_exact_match() -> None:
    """Exact query match scores 1.0."""
    score = _score_relevance("memory engine", "memory engine")
    assert score == 1.0


def test_semantic_scoring_no_overlap() -> None:
    """No keyword overlap scores 0.0."""
    score = _score_relevance("dark theme preferences", "memory engine")
    assert score == 0.0


def test_semantic_scoring_empty_query() -> None:
    """Empty query returns 0.0."""
    score = _score_relevance("some content", "")
    assert score == 0.0


@pytest.mark.asyncio
async def test_semantic_respects_limit(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Semantic retrieval respects the limit parameter."""
    facts = [{"content": f"fact number {i}"} for i in range(30)]
    _setup_memory_json(data_root, agent_id, facts)

    items = await retriever.retrieve(agent_id, "fact", session_id=None, tenant_id=None, limit=5)
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]
    assert len(semantic_items) == 5


@pytest.mark.asyncio
async def test_semantic_sorts_by_relevance(data_root: Path, agent_id: uuid.UUID, retriever: MemoryRetriever) -> None:
    """Semantic items are sorted by relevance score descending."""
    _setup_memory_json(
        data_root,
        agent_id,
        [
            {"content": "unrelated dark theme settings"},
            {"content": "memory engine pipeline design"},
            {"content": "retrieval architecture for memory"},
        ],
    )

    items = await retriever.retrieve(agent_id, "memory engine", session_id=None, tenant_id=None)
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]

    scores = [item.score for item in semantic_items]
    assert scores == sorted(scores, reverse=True)
    # The fact containing "memory engine" should be first
    assert "memory engine" in semantic_items[0].content


@pytest.mark.asyncio
async def test_semantic_prefers_newer_fact_when_relevance_ties(
    data_root: Path,
    agent_id: uuid.UUID,
    retriever: MemoryRetriever,
) -> None:
    _setup_memory_json(
        data_root,
        agent_id,
        [
            {"content": "memory engine architecture", "timestamp": "2024-01-01T00:00:00Z"},
            {"content": "memory engine architecture", "timestamp": "2026-03-01T00:00:00Z"},
        ],
    )

    items = await retriever.retrieve(agent_id, "memory engine", session_id=None, tenant_id=None)
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]

    assert semantic_items[0].metadata["timestamp"] == "2026-03-01T00:00:00Z"
    assert semantic_items[0].score >= semantic_items[1].score


@pytest.mark.asyncio
async def test_empty_query_prefers_recent_facts(
    data_root: Path,
    agent_id: uuid.UUID,
    retriever: MemoryRetriever,
) -> None:
    _setup_memory_json(
        data_root,
        agent_id,
        [
            {"content": "older fact", "timestamp": "2024-01-01T00:00:00Z"},
            {"content": "newer fact", "timestamp": "2026-03-01T00:00:00Z"},
        ],
    )

    items = await retriever.retrieve(agent_id, "", session_id=None, tenant_id=None)
    semantic_items = [i for i in items if i.kind == MemoryKind.SEMANTIC]

    assert semantic_items[0].content == "newer fact"
