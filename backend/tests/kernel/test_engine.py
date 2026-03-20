from __future__ import annotations

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
async def test_agent_kernel_handles_tool_round_and_collects_parts():
    from app.kernel.contracts import InvocationRequest
    from app.kernel.engine import AgentKernel, KernelDependencies, RuntimeConfig

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
    persisted_payloads: list[dict] = []

    async def resolve_runtime_config(_agent_id):
        return RuntimeConfig(tenant_id=uuid4(), max_tool_rounds=5, quota_message=None)

    async def resolve_current_user_name(_user_id):
        return "Rocky"

    async def build_system_prompt(request, tenant_id, memory_context, current_user_name):
        assert tenant_id is not None
        assert current_user_name == "Rocky"
        assert memory_context == ""
        return f"PROMPT::{request.agent_name}"

    async def resolve_memory_context(request, tenant_id):
        assert tenant_id is not None
        return ""

    async def get_tools(_agent_id, core_only):
        tool_load_calls.append(core_only)
        name = "core_tool" if core_only else "expanded_tool"
        return [{"type": "function", "function": {"name": name, "description": "", "parameters": {"type": "object"}}}]

    async def maybe_compress_messages(messages, **kwargs):
        return messages

    async def execute_tool(tool_name, args, request, emit_event):
        del request, emit_event
        assert tool_name == "read_file"
        assert args == {"path": "skills/web-research/SKILL.md"}
        return "SKILL_CONTENT"

    async def persist_memory(**kwargs):
        persisted_payloads.append(kwargs)

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
            reasoning_content="final reasoning",
            usage={"total_tokens": 8},
        ),
    ])

    kernel = AgentKernel(
        KernelDependencies(
            resolve_runtime_config=resolve_runtime_config,
            resolve_current_user_name=resolve_current_user_name,
            build_system_prompt=build_system_prompt,
            resolve_memory_context=resolve_memory_context,
            get_tools=get_tools,
            maybe_compress_messages=maybe_compress_messages,
            create_client=lambda model: fake_client,
            execute_tool=execute_tool,
            persist_memory=persist_memory,
            record_token_usage=lambda *args, **kwargs: None,
            get_max_tokens=lambda *args, **kwargs: 2048,
            extract_usage_tokens=lambda usage: usage.get("total_tokens"),
            estimate_tokens_from_chars=lambda chars: chars // 4,
        )
    )

    result = await kernel.handle(
        InvocationRequest(
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
    assert result.parts == [
        {
            "type": "tool_call",
            "name": "read_file",
            "args": {"path": "skills/web-research/SKILL.md"},
            "status": "done",
            "result": "SKILL_CONTENT",
            "reasoning": "reasoning",
        },
        {"type": "reasoning", "text": "final reasoning"},
        {"type": "text", "text": "final answer"},
    ]
    assert persisted_payloads


@pytest.mark.asyncio
async def test_runtime_invoker_delegates_to_agent_kernel(monkeypatch):
    from app.kernel.contracts import InvocationResult
    from app.runtime.invoker import AgentInvocationRequest, invoke_agent

    captured = {}

    class _FakeKernel:
        async def handle(self, request):
            captured["request"] = request
            return InvocationResult(
                content="kernel-result",
                tokens_used=7,
                final_tools=[{"type": "function", "function": {"name": "x"}}],
                parts=[{"type": "text", "text": "kernel-result"}],
            )

    monkeypatch.setattr("app.runtime.invoker.get_agent_kernel", lambda: _FakeKernel())

    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="key",
        base_url=None,
        max_output_tokens=None,
    )

    result = await invoke_agent(
        AgentInvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "hello"}],
            agent_name="Agent",
            role_description="desc",
            agent_id=uuid4(),
            user_id=uuid4(),
        )
    )

    assert captured["request"].agent_name == "Agent"
    assert captured["request"].messages == [{"role": "user", "content": "hello"}]
    assert result.content == "kernel-result"
    assert result.tokens_used == 7
    assert result.final_tools == [{"type": "function", "function": {"name": "x"}}]
    assert result.parts == [{"type": "text", "text": "kernel-result"}]


@pytest.mark.asyncio
async def test_agent_kernel_expands_tools_after_load_skill():
    from app.kernel.contracts import InvocationRequest
    from app.kernel.engine import AgentKernel, KernelDependencies, RuntimeConfig

    tool_load_calls: list[bool] = []
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    async def resolve_runtime_config(_agent_id):
        return RuntimeConfig(tenant_id=uuid4(), max_tool_rounds=4, quota_message=None)

    async def get_tools(_agent_id, core_only):
        tool_load_calls.append(core_only)
        name = "core_tool" if core_only else "expanded_tool"
        return [{"type": "function", "function": {"name": name, "description": "", "parameters": {"type": "object"}}}]

    fake_client = _FakeClient([
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_1",
                "function": {"name": "load_skill", "arguments": '{"name":"web research"}'},
            }],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
    ])

    kernel = AgentKernel(
        KernelDependencies(
            resolve_runtime_config=resolve_runtime_config,
            resolve_current_user_name=lambda *_args, **_kwargs: "Rocky",
            build_system_prompt=lambda *_args, **_kwargs: "PROMPT",
            resolve_memory_context=lambda *_args, **_kwargs: "",
            get_tools=get_tools,
            maybe_compress_messages=lambda messages, **kwargs: messages,
            create_client=lambda _model: fake_client,
            execute_tool=lambda *_args, **_kwargs: "SKILL",
            persist_memory=lambda **kwargs: None,
            record_token_usage=lambda *args, **kwargs: None,
            get_max_tokens=lambda *args, **kwargs: 2048,
            extract_usage_tokens=lambda usage: usage.get("total_tokens"),
            estimate_tokens_from_chars=lambda chars: chars // 4,
        )
    )

    result = await kernel.handle(
        InvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "load a skill"}],
            agent_name="Researcher",
            role_description="Research agent",
            agent_id=uuid4(),
            user_id=uuid4(),
        )
    )

    assert result.content == "done"
    assert tool_load_calls == [True, False]
    assert fake_client.calls[0]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[1]["tools"][0]["function"]["name"] == "expanded_tool"


@pytest.mark.asyncio
async def test_agent_kernel_prefers_declared_tool_subset_after_load_skill():
    from app.kernel.contracts import InvocationRequest
    from app.kernel.engine import AgentKernel, KernelDependencies, RuntimeConfig, ToolExpansionResult

    tool_load_calls: list[bool] = []
    expansion_calls: list[tuple[str, dict[str, str]]] = []
    emitted_events: list[dict] = []
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    async def resolve_runtime_config(_agent_id):
        return RuntimeConfig(tenant_id=uuid4(), max_tool_rounds=4, quota_message=None)

    async def get_tools(_agent_id, core_only):
        tool_load_calls.append(core_only)
        name = "core_tool" if core_only else "expanded_tool"
        return [{"type": "function", "function": {"name": name, "description": "", "parameters": {"type": "object"}}}]

    async def resolve_tool_expansion(_request, tool_name, args):
        expansion_calls.append((tool_name, args))
        return ToolExpansionResult(
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "",
                        "parameters": {"type": "object"},
                    },
                }
            ],
            active_packs=[{
                "name": "web_pack",
                "summary": "网页搜索与抓取能力",
                "tools": ["web_search"],
                "source": "system",
            }],
            event_payload={
                "type": "pack_activation",
                "packs": [{
                    "name": "web_pack",
                    "summary": "网页搜索与抓取能力",
                    "tools": ["web_search"],
                    "source": "system",
                }],
                "message": "Activated web_pack",
                "status": "info",
            },
        )

    fake_client = _FakeClient([
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_1",
                "function": {"name": "load_skill", "arguments": '{"name":"web research"}'},
            }],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
    ])

    kernel = AgentKernel(
        KernelDependencies(
            resolve_runtime_config=resolve_runtime_config,
            resolve_current_user_name=lambda *_args, **_kwargs: "Rocky",
            build_system_prompt=lambda *_args, **_kwargs: "PROMPT",
            resolve_memory_context=lambda *_args, **_kwargs: "",
            get_tools=get_tools,
            resolve_tool_expansion=resolve_tool_expansion,
            maybe_compress_messages=lambda messages, **kwargs: messages,
            create_client=lambda _model: fake_client,
            execute_tool=lambda *_args, **_kwargs: "SKILL",
            persist_memory=lambda **kwargs: None,
            record_token_usage=lambda *args, **kwargs: None,
            get_max_tokens=lambda *args, **kwargs: 2048,
            extract_usage_tokens=lambda usage: usage.get("total_tokens"),
            estimate_tokens_from_chars=lambda chars: chars // 4,
        )
    )

    result = await kernel.handle(
        InvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "load a skill"}],
            agent_name="Researcher",
            role_description="Research agent",
            agent_id=uuid4(),
            user_id=uuid4(),
            on_event=lambda event: emitted_events.append(event),
        )
    )

    assert result.content == "done"
    assert tool_load_calls == [True]
    assert expansion_calls == [("load_skill", {"name": "web research"})]
    assert fake_client.calls[0]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[1]["tools"][0]["function"]["name"] == "web_search"
    assert emitted_events[0]["type"] == "pack_activation"
    assert emitted_events[0]["packs"][0]["name"] == "web_pack"


@pytest.mark.asyncio
async def test_agent_kernel_does_not_auto_expand_without_skill_or_mcp_trigger():
    from app.kernel.contracts import InvocationRequest
    from app.kernel.engine import AgentKernel, KernelDependencies, RuntimeConfig

    tool_load_calls: list[bool] = []
    model = SimpleNamespace(
        provider="openai",
        model="gpt-4.1",
        api_key="test-key",
        base_url=None,
        max_output_tokens=None,
    )

    async def resolve_runtime_config(_agent_id):
        return RuntimeConfig(tenant_id=uuid4(), max_tool_rounds=5, quota_message=None)

    async def get_tools(_agent_id, core_only):
        tool_load_calls.append(core_only)
        name = "core_tool" if core_only else "expanded_tool"
        return [{"type": "function", "function": {"name": name, "description": "", "parameters": {"type": "object"}}}]

    fake_client = _FakeClient([
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_1",
                "function": {"name": "list_files", "arguments": '{"path":"skills"}'},
            }],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_2",
                "function": {"name": "list_files", "arguments": '{"path":"workspace"}'},
            }],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
        SimpleNamespace(
            content="",
            tool_calls=[{
                "id": "call_3",
                "function": {"name": "list_files", "arguments": '{"path":"memory"}'},
            }],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
        SimpleNamespace(
            content="done",
            tool_calls=[],
            reasoning_content=None,
            usage={"total_tokens": 2},
        ),
    ])

    kernel = AgentKernel(
        KernelDependencies(
            resolve_runtime_config=resolve_runtime_config,
            resolve_current_user_name=lambda *_args, **_kwargs: "Rocky",
            build_system_prompt=lambda *_args, **_kwargs: "PROMPT",
            resolve_memory_context=lambda *_args, **_kwargs: "",
            get_tools=get_tools,
            maybe_compress_messages=lambda messages, **kwargs: messages,
            create_client=lambda _model: fake_client,
            execute_tool=lambda *_args, **_kwargs: "OK",
            persist_memory=lambda **kwargs: None,
            record_token_usage=lambda *args, **kwargs: None,
            get_max_tokens=lambda *args, **kwargs: 2048,
            extract_usage_tokens=lambda usage: usage.get("total_tokens"),
            estimate_tokens_from_chars=lambda chars: chars // 4,
        )
    )

    result = await kernel.handle(
        InvocationRequest(
            model=model,
            messages=[{"role": "user", "content": "keep using the default toolkit"}],
            agent_name="Researcher",
            role_description="Research agent",
            agent_id=uuid4(),
            user_id=uuid4(),
        )
    )

    assert result.content == "done"
    assert tool_load_calls == [True]
    assert fake_client.calls[0]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[1]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[2]["tools"][0]["function"]["name"] == "core_tool"
    assert fake_client.calls[3]["tools"][0]["function"]["name"] == "core_tool"
