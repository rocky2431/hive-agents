from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.runtime.session import SessionContext


@pytest.mark.asyncio
async def test_call_llm_delegates_to_runtime_invoker(monkeypatch):
    from app.api.websocket import call_llm

    captured = {}
    cancel_event = asyncio.Event()
    fallback_model = SimpleNamespace(
        provider="anthropic",
        model="claude-sonnet",
        api_key="fallback",
        base_url=None,
        max_output_tokens=None,
    )

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="runtime-result")

    monkeypatch.setattr("app.api.websocket.invoke_agent", fake_invoke_agent)

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )

    result = await call_llm(
        model=model,
        messages=[{"role": "user", "content": "hello"}],
        agent_name="Agent",
        role_description="desc",
        agent_id=uuid4(),
        user_id=uuid4(),
        supports_vision=True,
        session_id="session-1",
        memory_messages=[{"role": "user", "content": "hello"}],
        memory_context="MEM",
        cancel_event=cancel_event,
        fallback_model=fallback_model,
    )

    assert result == "runtime-result"
    assert captured["request"].model is model
    assert captured["request"].fallback_model is fallback_model
    assert captured["request"].cancel_event is cancel_event
    assert captured["request"].supports_vision is True
    assert captured["request"].memory_session_id == "session-1"
    assert captured["request"].memory_messages == [{"role": "user", "content": "hello"}]
    assert captured["request"].memory_context == "MEM"
    assert captured["request"].session_context is not None
    assert captured["request"].session_context.session_id == "session-1"
    assert captured["request"].session_context.source == "websocket"
    assert captured["request"].session_context.channel == "web"


@pytest.mark.asyncio
async def test_call_llm_strips_upstream_system_messages_and_passes_execution_identity(monkeypatch):
    from app.api.websocket import call_llm
    from app.kernel.contracts import ExecutionIdentityRef

    captured = {}

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="runtime-result")

    monkeypatch.setattr("app.api.websocket.invoke_agent", fake_invoke_agent)

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )
    execution_identity = ExecutionIdentityRef(
        identity_type="delegated_user",
        identity_id=uuid4(),
        label="Rocky via web",
    )

    result = await call_llm(
        model=model,
        messages=[
            {"role": "system", "content": "legacy system prompt"},
            {"role": "user", "content": "hello"},
        ],
        agent_name="Agent",
        role_description="desc",
        agent_id=uuid4(),
        user_id=uuid4(),
        session_id="session-2",
        memory_messages=[
            {"role": "system", "content": "legacy system prompt"},
            {"role": "user", "content": "hello"},
        ],
        execution_identity=execution_identity,
    )

    assert result == "runtime-result"
    assert captured["request"].messages == [{"role": "user", "content": "hello"}]
    assert captured["request"].memory_messages == [{"role": "user", "content": "hello"}]
    assert captured["request"].execution_identity is execution_identity


@pytest.mark.asyncio
async def test_call_llm_reuses_provided_session_context(monkeypatch):
    from app.api.websocket import call_llm

    captured = {}
    session_context = SessionContext(session_id="session-reused", source="websocket", channel="web")
    session_context.prompt_prefix = "CACHED_PREFIX"
    session_context.active_skills.append("Skill A")

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="runtime-result")

    monkeypatch.setattr("app.api.websocket.invoke_agent", fake_invoke_agent)

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )

    result = await call_llm(
        model=model,
        messages=[{"role": "user", "content": "hello"}],
        agent_name="Agent",
        role_description="desc",
        agent_id=uuid4(),
        user_id=uuid4(),
        session_id="session-reused",
        session_context=session_context,
    )

    assert result == "runtime-result"
    assert captured["request"].session_context is session_context
    assert captured["request"].session_context.prompt_prefix == "CACHED_PREFIX"
    assert captured["request"].session_context.active_skills == ["Skill A"]
