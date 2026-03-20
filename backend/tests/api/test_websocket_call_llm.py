from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_call_llm_delegates_to_runtime_invoker(monkeypatch):
    from app.api.websocket import call_llm

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
    )

    assert result == "runtime-result"
    assert captured["request"].model is model
    assert captured["request"].supports_vision is True
    assert captured["request"].memory_session_id == "session-1"
    assert captured["request"].memory_messages == [{"role": "user", "content": "hello"}]
    assert captured["request"].memory_context == "MEM"
    assert captured["request"].session_context is not None
    assert captured["request"].session_context.session_id == "session-1"
    assert captured["request"].session_context.source == "websocket"
    assert captured["request"].session_context.channel == "web"
