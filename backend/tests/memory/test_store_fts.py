"""Tests for PersistentMemoryStore FTS5 search."""

import json
import uuid
from pathlib import Path

import pytest

from app.memory.store import PersistentMemoryStore


@pytest.fixture
def store(tmp_path):
    return PersistentMemoryStore(data_root=tmp_path)


@pytest.fixture
def agent_id():
    return uuid.uuid4()


@pytest.fixture
def seeded_store(store, agent_id):
    """Store with pre-seeded facts."""
    facts = [
        {"content": "User prefers Python over JavaScript", "subject": "preferences"},
        {"content": "Weekly standup is every Monday at 10am", "subject": "schedule"},
        {"content": "Project deadline is March 30th", "subject": "project"},
        {"content": "Database uses PostgreSQL with asyncpg", "subject": "tech"},
        {"content": "User speaks Chinese and English", "subject": "language"},
        {"content": "API rate limit is 100 requests per minute", "subject": "limits"},
    ]
    store.replace_semantic_facts(agent_id, facts)
    return store


def test_search_facts_returns_matching_results(seeded_store, agent_id):
    results = seeded_store.search_facts(agent_id, "Python")
    assert len(results) >= 1
    contents = [r["content"] for r in results]
    assert any("Python" in c for c in contents)


def test_search_facts_respects_limit(seeded_store, agent_id):
    results = seeded_store.search_facts(agent_id, "User", limit=1)
    assert len(results) <= 1


def test_search_facts_empty_query_returns_all(seeded_store, agent_id):
    results = seeded_store.search_facts(agent_id, "", limit=10)
    assert len(results) == 6


def test_search_facts_no_match_returns_empty(seeded_store, agent_id):
    results = seeded_store.search_facts(agent_id, "nonexistent_xyzzy_term")
    assert len(results) == 0


def test_search_facts_matches_subject(seeded_store, agent_id):
    results = seeded_store.search_facts(agent_id, "schedule")
    assert len(results) >= 1
    assert any("Monday" in r["content"] for r in results)


def test_fts_rebuilt_after_replace(store, agent_id):
    store.replace_semantic_facts(agent_id, [{"content": "alpha bravo charlie"}])
    results = store.search_facts(agent_id, "bravo")
    assert len(results) == 1
    assert results[0]["content"] == "alpha bravo charlie"

    # Replace with new facts — old FTS entries should be gone
    store.replace_semantic_facts(agent_id, [{"content": "delta echo foxtrot"}])
    results = store.search_facts(agent_id, "bravo")
    assert len(results) == 0
    results = store.search_facts(agent_id, "echo")
    assert len(results) == 1


def test_fts_works_with_legacy_json_import(store, agent_id, tmp_path):
    """FTS should be populated even when facts come from legacy memory.json."""
    memory_dir = tmp_path / str(agent_id) / "memory"
    memory_dir.mkdir(parents=True)
    facts = [
        {"content": "Legacy fact about Kubernetes"},
        {"content": "Another fact about Docker"},
    ]
    (memory_dir / "memory.json").write_text(json.dumps(facts))

    results = store.search_facts(agent_id, "Kubernetes")
    assert len(results) >= 1
    assert "Kubernetes" in results[0]["content"]


def test_search_preserves_metadata(store, agent_id):
    facts = [
        {"content": "Meeting notes from sprint review", "subject": "meetings", "timestamp": "2026-03-20"},
    ]
    store.replace_semantic_facts(agent_id, facts)
    results = store.search_facts(agent_id, "sprint")
    assert len(results) == 1
    assert results[0]["subject"] == "meetings"
    assert results[0]["timestamp"] == "2026-03-20"
