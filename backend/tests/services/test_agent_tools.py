from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_execute_tool_direct_prefers_tool_registry_executor(monkeypatch):
    from app.services.agent_tools import _execute_tool_direct
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRequest

    workspace = Path("/tmp/test-agent-workspace")
    agent_id = uuid4()
    captured = {}

    async def fake_resolve(self, *, agent_id: object, user_id: object):
        return ToolExecutionContext(
            agent_id=agent_id,
            user_id=user_id,
            tenant_id="tenant-1",
            workspace=workspace,
        )

    async def fake_try_execute(request: ToolExecutionRequest):
        captured["request"] = request
        return "registry-ok"

    monkeypatch.setattr("app.tools.resolver.ToolRuntimeResolver.resolve", fake_resolve)
    monkeypatch.setattr("app.services.agent_tools._ensure_tool_execution_registry", lambda: None)
    monkeypatch.setattr("app.services.agent_tools._TOOL_EXECUTION_REGISTRY.try_execute", fake_try_execute)

    result = await _execute_tool_direct(
        "execute_code",
        {"language": "python", "code": "print('hi')"},
        agent_id,
    )

    assert result == "registry-ok"
    assert captured["request"].tool_name == "execute_code"
    assert captured["request"].arguments == {"language": "python", "code": "print('hi')"}
    assert captured["request"].context.agent_id == agent_id
    assert captured["request"].context.workspace == workspace


@pytest.mark.asyncio
async def test_execute_tool_direct_falls_back_to_execute_code(monkeypatch):
    from app.services.agent_tools import _execute_tool_direct
    from app.tools.runtime import ToolExecutionContext

    workspace = Path("/tmp/test-agent-workspace")
    called = {}

    async def fake_resolve(self, *, agent_id: object, user_id: object):
        return ToolExecutionContext(
            agent_id=agent_id,
            user_id=user_id,
            tenant_id="tenant-1",
            workspace=workspace,
        )

    async def fake_try_execute(_request):
        return None

    async def fake_execute_code(ws, arguments):
        called["ws"] = ws
        called["arguments"] = arguments
        return "ok"

    monkeypatch.setattr("app.tools.resolver.ToolRuntimeResolver.resolve", fake_resolve)
    monkeypatch.setattr("app.services.agent_tools._ensure_tool_execution_registry", lambda: None)
    monkeypatch.setattr("app.services.agent_tools._TOOL_EXECUTION_REGISTRY.try_execute", fake_try_execute)
    monkeypatch.setattr("app.services.agent_tools._execute_code", fake_execute_code)

    result = await _execute_tool_direct(
        "execute_code",
        {"language": "python", "code": "print('hi')"},
        uuid4(),
    )

    assert result == "ok"
    assert called["ws"] == workspace
    assert called["arguments"] == {"language": "python", "code": "print('hi')"}
