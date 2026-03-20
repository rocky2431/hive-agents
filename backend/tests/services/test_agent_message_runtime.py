from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_invoke_agent_message_runtime_delegates_to_runtime(monkeypatch):
    from app.services.agent_tools import _invoke_agent_message_runtime

    target_id = uuid4()
    owner_id = uuid4()
    session_agent_id = uuid4()
    participant_id = uuid4()
    target = SimpleNamespace(
        id=target_id,
        name="Target Agent",
        role_description="Helpful agent",
        max_tool_rounds=9,
    )
    target_model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )
    conversation_messages = [{"role": "user", "content": "[From Source] hello"}]

    captured = {}
    tool_executor = object()

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="target reply")

    monkeypatch.setattr("app.runtime.invoker.invoke_agent", fake_invoke_agent)
    monkeypatch.setattr(
        "app.services.agent_tools._build_agent_message_tool_executor",
        lambda *args, **kwargs: tool_executor,
    )

    reply = await _invoke_agent_message_runtime(
        target=target,
        target_model=target_model,
        conversation_messages=conversation_messages,
        owner_id=owner_id,
        session_id="session-1",
        session_agent_id=session_agent_id,
        participant_id=participant_id,
    )

    request = captured["request"]
    assert reply == "target reply"
    assert request.model is target_model
    assert request.agent_id == target_id
    assert request.user_id == owner_id
    assert request.messages == conversation_messages
    assert request.memory_messages == conversation_messages
    assert request.memory_session_id == "session-1"
    assert request.tool_executor is tool_executor
    assert request.core_tools_only is False
    assert request.max_tool_rounds == 9
    assert "Agent-to-Agent Message" in request.system_prompt_suffix


@pytest.mark.asyncio
async def test_build_agent_message_tool_executor_persists_tool_calls(monkeypatch):
    from app.services.agent_tools import _build_agent_message_tool_executor

    target_id = uuid4()
    owner_id = uuid4()
    participant_id = uuid4()
    calls = {}

    async def fake_execute_tool(tool_name, args, agent_id, user_id):
        calls["execute"] = (tool_name, args, agent_id, user_id)
        return "TOOL_RESULT"

    async def fake_persist(**kwargs):
        calls["persist"] = kwargs

    monkeypatch.setattr("app.services.agent_tools.execute_tool", fake_execute_tool)
    monkeypatch.setattr("app.services.agent_tools._persist_agent_tool_call", fake_persist)

    executor = _build_agent_message_tool_executor(
        target_agent_id=target_id,
        owner_id=owner_id,
        session_agent_id=uuid4(),
        session_id="session-2",
        participant_id=participant_id,
    )

    result = await executor("read_file", {"path": "skills/test/SKILL.md"})

    assert result == "TOOL_RESULT"
    assert calls["execute"] == (
        "read_file",
        {"path": "skills/test/SKILL.md"},
        target_id,
        owner_id,
    )
    assert calls["persist"]["tool_name"] == "read_file"
    assert calls["persist"]["tool_args"] == {"path": "skills/test/SKILL.md"}
    assert calls["persist"]["tool_result"] == "TOOL_RESULT"
    assert calls["persist"]["participant_id"] == participant_id
