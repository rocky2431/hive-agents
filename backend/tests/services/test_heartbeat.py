from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: self._value or [])


class _FakeSession:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _query):
        if not self._execute_values:
            raise AssertionError("No fake execute result prepared")
        return _FakeScalarResult(self._execute_values.pop(0))

    async def commit(self):
        return None


@pytest.mark.asyncio
async def test_build_heartbeat_tool_executor_enforces_plaza_limits(monkeypatch):
    from app.services.heartbeat import _build_heartbeat_tool_executor

    agent_id = uuid4()
    creator_id = uuid4()
    calls = []

    async def fake_execute_tool(tool_name, args, _agent_id, _creator_id):
        calls.append((tool_name, args, _agent_id, _creator_id))
        return f"ran:{tool_name}"

    monkeypatch.setattr("app.services.heartbeat.execute_tool", fake_execute_tool)

    executor = _build_heartbeat_tool_executor(agent_id, creator_id)

    first_post = await executor("plaza_create_post", {"content": "post-1"})
    blocked_post = await executor("plaza_create_post", {"content": "post-2"})
    first_comment = await executor("plaza_add_comment", {"content": "comment-1"})
    second_comment = await executor("plaza_add_comment", {"content": "comment-2"})
    blocked_comment = await executor("plaza_add_comment", {"content": "comment-3"})
    generic = await executor("web_search", {"query": "heartbeat"})

    assert first_post == "ran:plaza_create_post"
    assert blocked_post.startswith("[BLOCKED]")
    assert first_comment == "ran:plaza_add_comment"
    assert second_comment == "ran:plaza_add_comment"
    assert blocked_comment.startswith("[BLOCKED]")
    assert generic == "ran:web_search"
    assert calls == [
        ("plaza_create_post", {"content": "post-1"}, agent_id, creator_id),
        ("plaza_add_comment", {"content": "comment-1"}, agent_id, creator_id),
        ("plaza_add_comment", {"content": "comment-2"}, agent_id, creator_id),
        ("web_search", {"query": "heartbeat"}, agent_id, creator_id),
    ]


@pytest.mark.asyncio
async def test_execute_heartbeat_passes_memory_messages_to_runtime(monkeypatch):
    from app.services.heartbeat import _execute_heartbeat

    agent_id = uuid4()
    creator_id = uuid4()
    model_id = uuid4()
    agent = SimpleNamespace(
        id=agent_id,
        name="Heartbeat Agent",
        role_description="Watcher",
        primary_model_id=model_id,
        fallback_model_id=None,
        creator_id=creator_id,
    )
    model = SimpleNamespace(
        id=model_id,
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )
    fake_session = _FakeSession([agent, model, []])
    captured = {}

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="HEARTBEAT_OK")

    monkeypatch.setattr("app.database.async_session", lambda: fake_session)
    monkeypatch.setattr("app.services.heartbeat.invoke_agent", fake_invoke_agent)
    monkeypatch.setattr("app.services.heartbeat._load_heartbeat_instruction", lambda _agent_id: "HB")

    await _execute_heartbeat(agent_id)

    request = captured["request"]
    assert request.messages == [{"role": "user", "content": "HB"}]
    assert request.memory_messages == request.messages
