from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _ListResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.deleted = []
        self.committed = False

    async def execute(self, _stmt):
        if not self._results:
            raise AssertionError("Unexpected execute() call")
        return self._results.pop(0)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.committed = True

    async def flush(self):
        return None

    async def delete(self, value):
        self.deleted.append(value)


def test_tools_router_is_registered_in_app_surface():
    project_root = Path(__file__).resolve().parents[3]
    main_source = (project_root / "backend/app/main.py").read_text()
    tools_api_path = project_root / "backend/app/api/tools.py"

    assert "from app.api.tools import router as tools_router" in main_source
    assert "tools_router" in main_source
    assert tools_api_path.exists()


@pytest.mark.asyncio
async def test_create_tool_assigns_new_tool_to_current_tenant_agents():
    import app.api.tools as tools_api

    tenant_id = uuid4()
    current_user = SimpleNamespace(id=uuid4(), role="org_admin", tenant_id=tenant_id)
    agent_one = SimpleNamespace(id=uuid4(), tenant_id=tenant_id)
    agent_two = SimpleNamespace(id=uuid4(), tenant_id=tenant_id)
    db = _FakeDB([
        _ListResult([agent_one, agent_two]),
    ])

    payload = tools_api.ToolCreateIn(
        name="mcp_demo_tool",
        display_name="Demo Tool",
        description="Example",
        type="mcp",
        category="custom",
        icon="·",
        mcp_server_url="https://example.com/sse",
        mcp_server_name="Demo MCP",
        mcp_tool_name="demo",
        parameters_schema={"type": "object"},
        is_default=False,
    )

    result = await tools_api.create_tool(data=payload, current_user=current_user, db=db)

    assert result["name"] == "mcp_demo_tool"
    assert result["tenant_id"] == str(tenant_id)
    assert len(db.added) == 3
    agent_tool_rows = [item for item in db.added if getattr(item, "agent_id", None)]
    assert len(agent_tool_rows) == 2
    assert {row.agent_id for row in agent_tool_rows} == {agent_one.id, agent_two.id}
    assert db.committed is True


@pytest.mark.asyncio
async def test_remove_agent_tool_uses_agent_manage_access_not_admin_role():
    import app.api.tools as tools_api

    agent_tool_id = uuid4()
    tool_id = uuid4()
    agent_id = uuid4()
    current_user = SimpleNamespace(id=uuid4(), role="member", tenant_id=uuid4())
    agent_tool = SimpleNamespace(id=agent_tool_id, agent_id=agent_id, tool_id=tool_id)
    tool = SimpleNamespace(id=tool_id, type="mcp")
    db = _FakeDB([
        _ScalarResult(agent_tool),
        _ScalarResult(None),
        _ScalarResult(tool),
    ])

    async def fake_require_manage_access(db_session, user, target_agent_id):
        assert db_session is db
        assert user is current_user
        assert target_agent_id == agent_id
        return SimpleNamespace(id=agent_id)

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(tools_api, "_require_manage_access", fake_require_manage_access)

    try:
        result = await tools_api.remove_agent_tool(
            agent_tool_id=agent_tool_id,
            current_user=current_user,
            db=db,
        )
    finally:
        monkeypatch.undo()

    assert result == {"status": "deleted", "agent_tool_id": str(agent_tool_id)}
    assert db.deleted == [agent_tool, tool]
    assert db.committed is True
