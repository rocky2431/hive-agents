from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _FakeClient:
    def __init__(self, responses: list[SimpleNamespace]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    async def stream(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise AssertionError("No fake response prepared")
        return self._responses.pop(0)

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_invoke_agent_expands_tools_after_skill_read(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    agent_id = uuid4()
    user_id = uuid4()
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    tool_load_calls: list[bool] = []

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    async def fake_compress(messages, **kwargs):
        return messages

    async def fake_get_agent_tools_for_llm(_agent_id, core_only=False):
        tool_load_calls.append(core_only)
        name = "core_tool" if core_only else "expanded_tool"
        return [{"type": "function", "function": {"name": name, "description": "", "parameters": {"type": "object"}}}]

    async def fake_execute_tool(tool_name, args, agent_id=None, user_id=None):
        assert tool_name == "read_file"
        assert args == {"path": "skills/web-research/SKILL.md"}
        assert agent_id
        assert user_id
        return "SKILL_CONTENT"

    fake_client = _FakeClient([
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_1",
                "function": {"name": "read_file", "arguments": '{"path":"skills/web-research/SKILL.md"}'},
            }],
            reasoning_content="reasoning",
            usage={"total_tokens": 10},
        ),
        SimpleNamespace(
            content="final answer",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 8},
        ),
    ])

    monkeypatch.setattr("app.runtime.invoker.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.invoker.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)
    monkeypatch.setattr("app.runtime.invoker.maybe_compress_messages", fake_compress)
    monkeypatch.setattr("app.runtime.invoker.get_agent_tools_for_llm", fake_get_agent_tools_for_llm)
    monkeypatch.setattr("app.runtime.invoker.execute_tool", fake_execute_tool)
    monkeypatch.setattr("app.runtime.invoker.create_llm_client", lambda **kwargs: fake_client)
    monkeypatch.setattr("app.runtime.invoker.record_token_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.runtime.invoker.get_max_tokens", lambda *args, **kwargs: 2048)

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "帮我做调研"}],
            agent_name="Researcher",
            role_description="Research agent",
            agent_id=agent_id,
            user_id=user_id,
        )
    )

    assert result.content == "final answer"
    assert tool_load_calls == [True, False]
    assert fake_client.calls[0]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[1]["tools"][0]["function"]["name"] == "expanded_tool"


@pytest.mark.asyncio
async def test_invoke_agent_composes_system_prompt_once(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    fake_client = _FakeClient([
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 5},
        ),
    ])

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return "KB_CONTEXT"

    async def fake_compress(messages, **kwargs):
        return messages

    monkeypatch.setattr("app.runtime.invoker.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.invoker.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)
    monkeypatch.setattr("app.runtime.invoker.maybe_compress_messages", fake_compress)
    monkeypatch.setattr("app.runtime.invoker.get_agent_tools_for_llm", lambda *args, **kwargs: [])
    monkeypatch.setattr("app.runtime.invoker.create_llm_client", lambda **kwargs: fake_client)
    monkeypatch.setattr("app.runtime.invoker.record_token_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.runtime.invoker.get_max_tokens", lambda *args, **kwargs: 2048)

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "最近公司政策有什么变化"}],
            agent_name="Analyst",
            role_description="Policy analyst",
            agent_id=uuid4(),
            user_id=uuid4(),
            memory_context="MEMORY_CONTEXT",
        )
    )

    assert result.content == "done"
    system_prompt = fake_client.calls[0]["messages"][0].content
    # Memory is in frozen prefix (before knowledge); knowledge is in dynamic suffix
    assert system_prompt == "BASE_PROMPT\n\nMEMORY_CONTEXT\n\nKB_CONTEXT"


@pytest.mark.asyncio
async def test_invoke_agent_passes_cancel_and_fallback_to_kernel(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    captured = {}
    cancel_event = asyncio.Event()
    fallback_model = SimpleNamespace(
        provider="anthropic",
        model="claude-sonnet",
        api_key="fallback",
        base_url=None,
        max_output_tokens=None,
    )

    class _FakeKernel:
        async def handle(self, request):
            captured["request"] = request
            return SimpleNamespace(content="ok", tokens_used=0, final_tools=None, parts=[])

    monkeypatch.setattr("app.runtime.invoker.get_agent_kernel", lambda: _FakeKernel())

    result = await invoke_agent(
        AgentInvocationRequest(
            model=SimpleNamespace(
                provider="openai",
                model="gpt-4.1",
                api_key="key",
                base_url=None,
                max_output_tokens=None,
            ),
            fallback_model=fallback_model,
            cancel_event=cancel_event,
            messages=[{"role": "user", "content": "hello"}],
            agent_name="Agent",
            role_description="desc",
            agent_id=uuid4(),
            user_id=uuid4(),
        )
    )

    assert result.content == "ok"
    assert captured["request"].cancel_event is cancel_event
    assert captured["request"].fallback_model is fallback_model


@pytest.mark.asyncio
async def test_invoke_agent_passes_execution_mode_to_kernel(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    captured = {}

    class _FakeKernel:
        async def handle(self, request):
            captured["request"] = request
            return SimpleNamespace(content="ok", tokens_used=0, final_tools=None, parts=[])

    monkeypatch.setattr("app.runtime.invoker.get_agent_kernel", lambda: _FakeKernel())

    result = await invoke_agent(
        AgentInvocationRequest(
            model=SimpleNamespace(
                provider="openai",
                model="gpt-4.1",
                api_key="key",
                base_url=None,
                max_output_tokens=None,
            ),
            messages=[{"role": "user", "content": "hello"}],
            agent_name="Coordinator",
            role_description="desc",
            agent_id=uuid4(),
            user_id=uuid4(),
            execution_mode="coordinator",
        )
    )

    assert result.content == "ok"
    assert captured["request"].execution_mode == "coordinator"


@pytest.mark.asyncio
async def test_invoke_agent_without_agent_id_uses_collected_initial_tools(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    captured = {}

    class _FakeKernel:
        async def handle(self, request):
            captured["request"] = request
            return SimpleNamespace(content="ok", tokens_used=0, final_tools=None, parts=[])

    monkeypatch.setattr("app.runtime.invoker.get_agent_kernel", lambda: _FakeKernel())
    monkeypatch.setattr(
        "app.runtime.invoker.get_combined_openai_tools",
        lambda: [{"type": "function", "function": {"name": "web_search", "description": "", "parameters": {"type": "object"}}}],
    )

    result = await invoke_agent(
        AgentInvocationRequest(
            model=SimpleNamespace(
                provider="openai",
                model="gpt-4.1",
                api_key="key",
                base_url=None,
                max_output_tokens=None,
            ),
            messages=[{"role": "user", "content": "hello"}],
            agent_name="Agent",
            role_description="desc",
            agent_id=None,
            user_id=uuid4(),
        )
    )

    assert result.content == "ok"
    assert captured["request"].initial_tools == [
        {"type": "function", "function": {"name": "web_search", "description": "", "parameters": {"type": "object"}}}
    ]


@pytest.mark.asyncio
async def test_invoke_agent_emits_compaction_events(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    fake_client = _FakeClient([
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 5},
        ),
    ])
    runtime_events: list[dict] = []

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    async def fake_compress(messages, **kwargs):
        on_compaction = kwargs.get("on_compaction")
        assert on_compaction is not None
        await on_compaction({
            "summary": "older context compressed",
            "original_message_count": len(messages),
            "kept_message_count": 2,
        })
        return [{"role": "system", "content": "[Previous conversation summary]\nolder context compressed"}]

    monkeypatch.setattr("app.runtime.invoker.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.invoker.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)
    monkeypatch.setattr("app.runtime.invoker.maybe_compress_messages", fake_compress)
    monkeypatch.setattr("app.runtime.invoker.get_agent_tools_for_llm", lambda *args, **kwargs: [])
    monkeypatch.setattr("app.runtime.invoker.create_llm_client", lambda **kwargs: fake_client)
    monkeypatch.setattr("app.runtime.invoker.record_token_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.runtime.invoker.get_max_tokens", lambda *args, **kwargs: 2048)

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": "second"},
                {"role": "user", "content": "third"},
            ],
            agent_name="Analyst",
            role_description="Policy analyst",
            agent_id=uuid4(),
            user_id=uuid4(),
            on_event=runtime_events.append,
        )
    )

    assert result.content == "done"
    assert runtime_events == [{
        "type": "session_compact",
        "summary": "older context compressed",
        "original_message_count": 3,
        "kept_message_count": 2,
    }]


@pytest.mark.asyncio
async def test_invoke_agent_forwards_permission_events(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    agent_id = uuid4()
    user_id = uuid4()
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    fake_client = _FakeClient([
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_1",
                "function": {"name": "write_file", "arguments": '{"path":"workspace/focus.md","content":"todo"}'},
            }],
            reasoning_content="reasoning",
            usage={"total_tokens": 10},
        ),
        SimpleNamespace(
            content="request blocked",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 8},
        ),
    ])

    runtime_events: list[dict] = []

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    async def fake_compress(messages, **kwargs):
        return messages

    async def fake_execute_tool(tool_name, args, agent_id=None, user_id=None, event_callback=None):
        assert tool_name == "write_file"
        assert event_callback is not None
        await event_callback({
            "type": "permission",
            "tool_name": "write_file",
            "status": "approval_required",
            "message": "This action requires approval.",
            "approval_id": "approval-123",
        })
        return "⏳ This action requires approval. An approval request has been sent. (Approval ID: approval-123)"

    monkeypatch.setattr("app.runtime.invoker.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.invoker.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)
    monkeypatch.setattr("app.runtime.invoker.maybe_compress_messages", fake_compress)
    monkeypatch.setattr("app.runtime.invoker.get_agent_tools_for_llm", lambda *args, **kwargs: [{"type": "function", "function": {"name": "write_file", "description": "", "parameters": {"type": "object"}}}])
    monkeypatch.setattr("app.runtime.invoker.execute_tool", fake_execute_tool)
    monkeypatch.setattr("app.runtime.invoker.create_llm_client", lambda **kwargs: fake_client)
    monkeypatch.setattr("app.runtime.invoker.record_token_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.runtime.invoker.get_max_tokens", lambda *args, **kwargs: 2048)

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "写入 focus.md"}],
            agent_name="Analyst",
            role_description="Policy analyst",
            agent_id=agent_id,
            user_id=user_id,
            on_event=runtime_events.append,
        )
    )

    assert result.content == "request blocked"
    assert runtime_events == [{
        "type": "permission",
        "tool_name": "write_file",
        "status": "approval_required",
        "message": "This action requires approval.",
        "approval_id": "approval-123",
    }]


@pytest.mark.asyncio
async def test_invoke_agent_loads_and_persists_runtime_memory(monkeypatch):
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    agent_id = uuid4()
    tenant_id = uuid4()
    user_id = uuid4()
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    fake_client = _FakeClient([
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 5},
        ),
    ])
    captured = {}

    async def fake_resolve_runtime_config(_agent_id):
        return SimpleNamespace(tenant_id=tenant_id, max_tool_rounds=50, quota_message=None)

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    async def fake_build_memory_snapshot(_agent_id, _tenant_id, session_id=None):
        captured["loaded"] = (_agent_id, _tenant_id, session_id)
        return "RUNTIME_MEMORY"

    async def fake_persist_runtime_memory(*, agent_id, session_id, tenant_id, messages):
        captured["persisted"] = {
            "agent_id": agent_id,
            "session_id": session_id,
            "tenant_id": tenant_id,
            "messages": messages,
        }

    async def fake_compress(messages, **kwargs):
        return messages

    monkeypatch.setattr("app.runtime.invoker._resolve_runtime_config", fake_resolve_runtime_config)
    monkeypatch.setattr("app.runtime.invoker.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.invoker.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)
    monkeypatch.setattr("app.runtime.invoker.build_memory_snapshot", fake_build_memory_snapshot)
    monkeypatch.setattr("app.runtime.invoker.persist_runtime_memory", fake_persist_runtime_memory)
    monkeypatch.setattr("app.runtime.invoker.maybe_compress_messages", fake_compress)
    monkeypatch.setattr("app.runtime.invoker.get_agent_tools_for_llm", lambda *args, **kwargs: [])
    monkeypatch.setattr("app.runtime.invoker.create_llm_client", lambda **kwargs: fake_client)
    monkeypatch.setattr("app.runtime.invoker.record_token_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.runtime.invoker.get_max_tokens", lambda *args, **kwargs: 2048)

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "hello"}],
            memory_messages=[{"role": "user", "content": "hello"}],
            memory_session_id="session-1",
            agent_name="Analyst",
            role_description="Policy analyst",
            agent_id=agent_id,
            user_id=user_id,
            memory_context="MANUAL_MEMORY",
        )
    )

    assert result.content == "done"
    assert captured["loaded"] == (agent_id, tenant_id, "session-1")
    assert fake_client.calls[0]["messages"][0].content == "BASE_PROMPT\n\nRUNTIME_MEMORY\n\nMANUAL_MEMORY"
    assert captured["persisted"] == {
        "agent_id": agent_id,
        "session_id": "session-1",
        "tenant_id": tenant_id,
        "messages": [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "done"},
        ],
    }
