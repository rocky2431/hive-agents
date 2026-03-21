from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _query):
        if not self._execute_values:
            raise AssertionError("No fake execute result prepared")
        return _FakeScalarResult(self._execute_values.pop(0))

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_build_memory_context_prefers_current_session_summary(monkeypatch):
    from app.services.memory_service import build_memory_context

    agent_id = uuid4()
    tenant_id = uuid4()
    fake_session = _FakeSession(["current summary"])

    monkeypatch.setattr("app.services.memory_service.async_session", lambda: fake_session)
    monkeypatch.setattr("app.services.memory_service._load_agent_memory", lambda _agent_id: "- prefers structured docs")

    context = await build_memory_context(agent_id, tenant_id, session_id=str(uuid4()))

    assert context == (
        "[Previous conversation summary]\ncurrent summary\n\n"
        "[Agent memory]\n- prefers structured docs"
    )


@pytest.mark.asyncio
async def test_build_memory_context_falls_back_to_previous_summary(monkeypatch):
    from app.services.memory_service import build_memory_context

    agent_id = uuid4()
    tenant_id = uuid4()
    fake_session = _FakeSession([None, "previous summary"])

    monkeypatch.setattr("app.services.memory_service.async_session", lambda: fake_session)
    monkeypatch.setattr("app.services.memory_service._load_agent_memory", lambda _agent_id: "")

    context = await build_memory_context(agent_id, tenant_id, session_id=str(uuid4()))

    assert context == "[Previous conversation summary]\nprevious summary"


@pytest.mark.asyncio
async def test_build_memory_context_without_session_id_uses_only_agent_memory(monkeypatch):
    from app.services.memory_service import build_memory_context

    agent_id = uuid4()
    tenant_id = uuid4()

    def _unexpected_session():
        raise AssertionError("session summary should not load without session_id")

    monkeypatch.setattr("app.services.memory_service.async_session", _unexpected_session)
    monkeypatch.setattr("app.services.memory_service._load_agent_memory", lambda _agent_id: "- keeps durable facts")

    context = await build_memory_context(agent_id, tenant_id)

    assert context == "[Agent memory]\n- keeps durable facts"


@pytest.mark.asyncio
async def test_persist_runtime_memory_updates_short_session_and_agent_memory(monkeypatch):
    from app.services.memory_service import persist_runtime_memory

    agent_id = uuid4()
    tenant_id = uuid4()
    chat_session = SimpleNamespace(summary=None)
    fake_session = _FakeSession([chat_session])
    update_calls = []

    async def fake_generate_session_summary(messages, _tenant_id):
        assert len(messages) == 2
        return "rolled summary"

    async def fake_update_agent_memory(_agent_id, messages, _tenant_id):
        update_calls.append((_agent_id, messages, _tenant_id))

    async def fake_get_memory_config(_tenant_id):
        return {}

    monkeypatch.setattr("app.services.memory_service.async_session", lambda: fake_session)
    monkeypatch.setattr("app.services.memory_service._generate_session_summary", fake_generate_session_summary)
    monkeypatch.setattr("app.services.memory_service._update_agent_memory", fake_update_agent_memory)
    monkeypatch.setattr("app.services.memory_service._get_memory_config", fake_get_memory_config)

    await persist_runtime_memory(
        agent_id=agent_id,
        session_id=str(uuid4()),
        tenant_id=tenant_id,
        messages=[
            {"role": "user", "content": "我更喜欢咖啡而不是茶，请记住。"},
            {"role": "assistant", "content": "已记录你的偏好。"},
        ],
    )

    assert chat_session.summary == "rolled summary"
    assert fake_session.commits == 1
    assert update_calls == [(
        agent_id,
        [
            {"role": "user", "content": "我更喜欢咖啡而不是茶，请记住。"},
            {"role": "assistant", "content": "已记录你的偏好。"},
        ],
        tenant_id,
    )]


@pytest.mark.asyncio
async def test_update_agent_memory_dedupes_and_replaces_latest_fact(monkeypatch, tmp_path):
    from app.services.memory_service import _update_agent_memory
    from app.memory.store import PersistentMemoryStore

    agent_id = uuid4()
    tenant_id = uuid4()
    memory_dir = tmp_path / str(agent_id) / "memory"
    memory_dir.mkdir(parents=True)
    memory_file = memory_dir / "memory.json"
    memory_file.write_text(json.dumps([
        {
            "content": "Alice prefers tea",
            "subject": "preference:drink",
            "timestamp": "2026-03-19T12:00:00+00:00",
        },
        {
            "content": "Works on Project X",
            "timestamp": "2026-03-19T12:05:00+00:00",
        },
    ], ensure_ascii=False), encoding="utf-8")

    async def fake_get_summary_model_config(_tenant_id):
        return None

    monkeypatch.setattr(
        "app.services.memory_service.get_settings",
        lambda: SimpleNamespace(AGENT_DATA_DIR=str(tmp_path)),
    )
    monkeypatch.setattr("app.services.memory_service._get_summary_model_config", fake_get_summary_model_config)
    monkeypatch.setattr(
        "app.services.memory_service._extract_facts_simple",
        lambda _messages: [
            {"content": "Alice prefers coffee", "subject": "preference:drink"},
            {"content": "Works on Project X"},
        ],
    )

    await _update_agent_memory(
        agent_id,
        [{"role": "user", "content": "请记住我现在更喜欢咖啡，并且还在 Project X。"}],
        tenant_id,
    )

    facts = json.loads(memory_file.read_text(encoding="utf-8"))
    persisted_facts = PersistentMemoryStore(data_root=tmp_path).load_semantic_facts(agent_id)

    assert [fact["content"] for fact in facts] == [
        "Alice prefers coffee",
        "Works on Project X",
    ]
    assert [fact["content"] for fact in persisted_facts] == [
        "Alice prefers coffee",
        "Works on Project X",
    ]
    assert all(fact.get("timestamp") for fact in facts)
