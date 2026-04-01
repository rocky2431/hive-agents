from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_delegate_to_agent_builds_runtime_request(monkeypatch):
    from app.agents.orchestrator import delegate_to_agent

    target = SimpleNamespace(
        id=uuid4(),
        name="Target Agent",
        role_description="Helpful",
    )
    target_model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )
    tool_executor = object()
    captured = {}

    async def fake_invoke_agent(request):
        captured["request"] = request
        return SimpleNamespace(content="delegated reply")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke_agent)

    reply = await delegate_to_agent(
        target=target,
        target_model=target_model,
        conversation_messages=[{"role": "user", "content": "hello"}],
        owner_id=uuid4(),
        session_id="session-1",
        tool_executor=tool_executor,
        system_prompt_suffix="A2A_SUFFIX",
        max_tool_rounds=7,
    )

    request = captured["request"]
    assert reply == "delegated reply"
    assert request.agent_id == target.id
    assert request.agent_name == "Target Agent"
    assert request.role_description == "Helpful"
    assert request.model is target_model
    assert request.messages == [{"role": "user", "content": "hello"}]
    assert request.memory_messages == request.messages
    assert request.memory_session_id == "session-1"
    assert request.tool_executor is tool_executor
    assert request.session_context is not None
    assert request.session_context.source == "agent"
    assert request.session_context.channel == "agent"
    assert request.session_context.session_id == "session-1"
    assert request.core_tools_only is True
    assert request.max_tool_rounds == 7
    assert request.system_prompt_suffix == "A2A_SUFFIX"


@pytest.mark.asyncio
async def test_delegate_to_agent_enforces_depth_limit(monkeypatch):
    from app.agents.orchestrator import AgentDelegationRequest, OrchestrationPolicy, _delegate

    target = SimpleNamespace(id=uuid4(), name="Target", role_description="Helpful")
    target_model = SimpleNamespace(provider="openai", model="gpt-4.1")

    async def _unexpected_invoke(_request):
        raise AssertionError("invoke_agent should not be called when depth limit is exceeded")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", _unexpected_invoke)

    result = await _delegate(
        AgentDelegationRequest(
            target=target,
            target_model=target_model,
            conversation_messages=[{"role": "user", "content": "hello"}],
            owner_id=uuid4(),
            session_id="session-1",
            depth=3,
            policy=OrchestrationPolicy(max_depth=2),
        )
    )

    assert result.timed_out is False
    assert result.depth_limited is True
    assert "delegation depth limit" in result.content.lower()


@pytest.mark.asyncio
async def test_delegate_to_agent_applies_timeout_and_trace_metadata(monkeypatch):
    from app.agents.orchestrator import AgentDelegationRequest, OrchestrationPolicy, _delegate

    target = SimpleNamespace(id=uuid4(), name="Target", role_description="Helpful")
    target_model = SimpleNamespace(provider="openai", model="gpt-4.1")
    owner_id = uuid4()

    async def fake_invoke_agent(request):
        metadata = request.session_context.metadata
        assert metadata["delegation"] is True
        assert metadata["delegation_depth"] == 1
        assert metadata["delegation_parent_agent_id"] == "source-agent"
        assert metadata["delegation_parent_session_id"] == "parent-session"
        assert metadata["delegation_trace_id"] == "trace-123"
        await asyncio.sleep(0.05)
        return SimpleNamespace(content="late reply")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke_agent)

    result = await _delegate(
        AgentDelegationRequest(
            target=target,
            target_model=target_model,
            conversation_messages=[{"role": "user", "content": "hello"}],
            owner_id=owner_id,
            session_id="child-session",
            parent_agent_id="source-agent",
            parent_session_id="parent-session",
            trace_id="trace-123",
            depth=1,
            policy=OrchestrationPolicy(timeout_seconds=0.01),
        )
    )

    assert result.timed_out is True
    assert result.depth_limited is False
    assert result.trace_id == "trace-123"
    assert result.child_session_id == "child-session"


@pytest.mark.asyncio
async def test_delegate_async_returns_handle_immediately(monkeypatch):
    from app.agents.orchestrator import delegate_async, check_async_delegation

    completed = asyncio.Event()

    async def fake_invoke(invocation):
        await completed.wait()
        return SimpleNamespace(content="async result")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke)

    target = SimpleNamespace(id=uuid4(), name="Worker", role_description="helper")
    model = SimpleNamespace(provider="openai", model="gpt-4.1", api_key="k", base_url=None, max_output_tokens=None)

    handle = await delegate_async(
        target=target,
        target_model=model,
        conversation_messages=[{"role": "user", "content": "do research"}],
        owner_id=uuid4(),
        session_id="sess-1",
        parent_agent_id=uuid4(),
    )

    assert handle.task_id
    assert handle.target_name == "Worker"

    # Task should be running
    status = await check_async_delegation(handle.task_id)
    assert status["status"] == "running"

    # Let the task complete
    completed.set()
    await asyncio.sleep(0.05)

    # Now it should be completed
    status = await check_async_delegation(handle.task_id)
    assert status["status"] == "completed"
    assert status["result"] == "async result"


@pytest.mark.asyncio
async def test_check_async_delegation_not_found():
    from app.agents.orchestrator import check_async_delegation

    status = await check_async_delegation("nonexistent-id")
    assert status["status"] == "not_found"


@pytest.mark.asyncio
async def test_delegate_async_handles_failure(monkeypatch):
    from app.agents.orchestrator import delegate_async, check_async_delegation

    async def fake_invoke(invocation):
        raise RuntimeError("LLM exploded")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke)

    target = SimpleNamespace(id=uuid4(), name="Crasher", role_description="")
    model = SimpleNamespace(provider="openai", model="gpt-4.1", api_key="k", base_url=None, max_output_tokens=None)

    handle = await delegate_async(
        target=target,
        target_model=model,
        conversation_messages=[{"role": "user", "content": "crash"}],
        owner_id=uuid4(),
        session_id="sess-2",
    )

    await asyncio.sleep(0.05)

    status = await check_async_delegation(handle.task_id)
    assert status["status"] == "failed"
    assert "failed" in status["result"]


@pytest.mark.asyncio
async def test_list_async_delegations(monkeypatch):
    from app.agents.orchestrator import delegate_async, list_async_delegations

    never_finish = asyncio.Event()

    async def fake_invoke(invocation):
        await never_finish.wait()
        return SimpleNamespace(content="done")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke)

    target = SimpleNamespace(id=uuid4(), name="Lister", role_description="")
    model = SimpleNamespace(provider="openai", model="gpt-4.1", api_key="k", base_url=None, max_output_tokens=None)

    handle = await delegate_async(
        target=target,
        target_model=model,
        conversation_messages=[{"role": "user", "content": "list test"}],
        owner_id=uuid4(),
        session_id="sess-3",
    )

    tasks = list_async_delegations()
    assert any(t["task_id"] == handle.task_id for t in tasks)
    assert any(t["status"] == "running" for t in tasks)

    # Cleanup
    never_finish.set()
    await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_delegate_async_persists_runtime_task_lifecycle(monkeypatch):
    from app.agents.orchestrator import check_async_delegation, delegate_async

    persisted: list[tuple[str, dict]] = []

    async def fake_create_task(**kwargs):
        persisted.append(("create", kwargs))
        return kwargs["task_id"]

    async def fake_update_task(task_id, **kwargs):
        persisted.append(("update", {"task_id": task_id, **kwargs}))

    async def fake_invoke(_invocation):
        return SimpleNamespace(content="async result")

    monkeypatch.setattr("app.agents.orchestrator.invoke_agent", fake_invoke)
    monkeypatch.setattr("app.agents.orchestrator.create_runtime_task_record", fake_create_task)
    monkeypatch.setattr("app.agents.orchestrator.update_runtime_task_record", fake_update_task)

    target = SimpleNamespace(id=uuid4(), name="Worker", role_description="helper")
    model = SimpleNamespace(provider="openai", model="gpt-4.1", api_key="k", base_url=None, max_output_tokens=None)

    handle = await delegate_async(
        target=target,
        target_model=model,
        conversation_messages=[{"role": "user", "content": "do research"}],
        owner_id=uuid4(),
        session_id="sess-runtime",
        parent_agent_id=uuid4(),
    )

    await asyncio.sleep(0.05)
    status = await check_async_delegation(handle.task_id)

    assert status["status"] == "completed"
    assert persisted[0][0] == "create"
    assert persisted[0][1]["task_id"] == handle.task_id
    assert any(kind == "update" and payload["status"] == "completed" for kind, payload in persisted)
