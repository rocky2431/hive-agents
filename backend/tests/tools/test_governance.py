from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_governance_blocks_unsafe_tool_in_public_zone():
    from app.tools.governance import GovernanceDependencies, ToolGovernanceContext, run_tool_governance

    events = []

    async def resolve_security_zone(_agent_id):
        return "public"

    async def check_capability(_tenant_id, _agent_id, _tool_name):
        raise AssertionError("capability check should not run when security zone already blocks")

    async def write_audit(**kwargs):
        raise AssertionError("audit should not run for pure security-zone block")

    async def check_autonomy(*args, **kwargs):
        raise AssertionError("autonomy check should not run when security zone already blocks")

    message = await run_tool_governance(
        ToolGovernanceContext(
            agent_id=uuid4(),
            user_id=uuid4(),
            tenant_id=str(uuid4()),
            tool_name="write_file",
            arguments={"path": "focus.md", "content": "x"},
        ),
        GovernanceDependencies(
            resolve_security_zone=resolve_security_zone,
            check_capability=check_capability,
            write_audit_event=write_audit,
            check_autonomy=check_autonomy,
        ),
        event_callback=events.append,
    )

    assert message == "🔒 Tool 'write_file' is blocked — this agent is in the 'public' security zone and can only use safe read-only tools."
    assert events == [{
        "type": "permission",
        "tool_name": "write_file",
        "status": "blocked",
        "message": "🔒 Tool 'write_file' is blocked — this agent is in the 'public' security zone and can only use safe read-only tools.",
        "security_zone": "public",
    }]


@pytest.mark.asyncio
async def test_governance_emits_capability_denied_and_audit():
    from app.services.capability_gate import CapabilityCheckResult
    from app.tools.governance import GovernanceDependencies, ToolGovernanceContext, run_tool_governance

    tenant_id = uuid4()
    agent_id = uuid4()
    audit_calls = []
    events = []

    async def resolve_security_zone(_agent_id):
        return "standard"

    async def check_capability(_tenant_id, _agent_id, tool_name):
        assert _tenant_id == tenant_id
        assert _agent_id == agent_id
        assert tool_name == "execute_code"
        return CapabilityCheckResult(
            allowed=False,
            denied=True,
            capability="workspace.code.execute",
            reason="Capability 'workspace.code.execute' is not allowed for this agent",
        )

    async def write_audit(**kwargs):
        audit_calls.append(kwargs)

    async def check_autonomy(*args, **kwargs):
        raise AssertionError("autonomy check should not run after capability deny")

    message = await run_tool_governance(
        ToolGovernanceContext(
            agent_id=agent_id,
            user_id=uuid4(),
            tenant_id=str(tenant_id),
            tool_name="execute_code",
            arguments={"code": "print(1)"},
        ),
        GovernanceDependencies(
            resolve_security_zone=resolve_security_zone,
            check_capability=check_capability,
            write_audit_event=write_audit,
            check_autonomy=check_autonomy,
        ),
        event_callback=events.append,
    )

    assert message == "🚫 Capability denied: Capability 'workspace.code.execute' is not allowed for this agent"
    assert audit_calls == [{
        "event_type": "capability.denied",
        "severity": "warn",
        "actor_type": "agent",
        "actor_id": agent_id,
        "tenant_id": tenant_id,
        "action": "capability_denied",
        "resource_type": "tool",
        "resource_id": None,
        "details": {"tool": "execute_code", "capability": "workspace.code.execute"},
    }]
    assert events == [{
        "type": "permission",
        "tool_name": "execute_code",
        "status": "capability_denied",
        "message": "🚫 Capability denied: Capability 'workspace.code.execute' is not allowed for this agent",
        "capability": "workspace.code.execute",
    }]


@pytest.mark.asyncio
async def test_governance_returns_approval_required_for_l3_autonomy():
    from app.tools.governance import GovernanceDependencies, ToolGovernanceContext, run_tool_governance

    events = []

    async def resolve_security_zone(_agent_id):
        return "standard"

    async def check_capability(_tenant_id, _agent_id, _tool_name):
        return SimpleNamespace(denied=False, escalate_to_l3=False, capability="", reason="")

    async def write_audit(**kwargs):
        return None

    async def check_autonomy(*, agent_id, user_id, tool_name, arguments):
        assert tool_name == "send_feishu_message"
        assert arguments["message"] == "hi"
        return {"allowed": False, "level": "L3", "approval_id": "approval-1"}

    message = await run_tool_governance(
        ToolGovernanceContext(
            agent_id=uuid4(),
            user_id=uuid4(),
            tenant_id=str(uuid4()),
            tool_name="send_feishu_message",
            arguments={"member_name": "张三", "message": "hi"},
        ),
        GovernanceDependencies(
            resolve_security_zone=resolve_security_zone,
            check_capability=check_capability,
            write_audit_event=write_audit,
            check_autonomy=check_autonomy,
        ),
        event_callback=events.append,
    )

    assert message == (
        "⏳ This action requires approval. An approval request has been sent. "
        "Please wait for approval before retrying. (Approval ID: approval-1)"
    )
    assert events == [{
        "type": "permission",
        "tool_name": "send_feishu_message",
        "status": "approval_required",
        "message": (
            "⏳ This action requires approval. An approval request has been sent. "
            "Please wait for approval before retrying. (Approval ID: approval-1)"
        ),
        "approval_id": "approval-1",
        "autonomy_level": "L3",
    }]
