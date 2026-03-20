"""Resolve governance context and dependencies for tool execution."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.policy import write_audit_event
from app.database import async_session
from app.models.agent import Agent
from app.services.autonomy_service import autonomy_service
from app.services.capability_gate import check_capability
from app.tools.governance import GovernanceDependencies, ToolGovernanceContext
from app.tools.runtime import ToolExecutionContext


class ToolGovernanceResolver:
    """Build governance context and dependency wrappers for tool runtime."""

    async def build_context(
        self,
        *,
        runtime_context: ToolExecutionContext,
        tool_name: str,
        arguments: dict,
    ) -> ToolGovernanceContext:
        return ToolGovernanceContext(
            agent_id=runtime_context.agent_id,
            user_id=runtime_context.user_id,
            tenant_id=runtime_context.tenant_id,
            tool_name=tool_name,
            arguments=arguments,
        )

    def build_dependencies(self) -> GovernanceDependencies:
        async def _resolve_security_zone(agent_id: uuid.UUID) -> str:
            async with async_session() as db:
                result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = result.scalar_one_or_none()
                return getattr(agent, "security_zone", None) or "standard"

        async def _check_capability(tenant_id: uuid.UUID, agent_id: uuid.UUID, tool_name: str):
            async with async_session() as db:
                return await check_capability(db, tenant_id, agent_id, tool_name)

        async def _write_audit_event(**kwargs) -> None:
            async with async_session() as db:
                await write_audit_event(db, **kwargs)
                await db.commit()

        async def _check_autonomy(
            *,
            agent_id: uuid.UUID,
            user_id: uuid.UUID,
            tool_name: str,
            arguments: dict,
            action_type: str,
        ) -> dict:
            async with async_session() as db:
                result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = result.scalar_one_or_none()
                if not agent:
                    return {"allowed": False, "level": "unknown", "message": "Agent not found"}
                outcome = await autonomy_service.check_and_enforce(
                    db,
                    agent,
                    action_type,
                    {"tool": tool_name, "args": str(arguments)[:200], "requested_by": str(user_id)},
                )
                await db.commit()
                return outcome

        return GovernanceDependencies(
            resolve_security_zone=_resolve_security_zone,
            check_capability=_check_capability,
            write_audit_event=_write_audit_event,
            check_autonomy=_check_autonomy,
        )
