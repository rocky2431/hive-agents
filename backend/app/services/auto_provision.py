"""Auto-provision Main Agent on first login (ARCHITECTURE.md Phase 5).

When a user logs in and has no Main Agent, this service creates one
using the matching Role Template (by department, or tenant default).
"""

from __future__ import annotations

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentTemplate
from app.models.user import User
from app.services.sync_service import bump_sync_version


async def ensure_main_agent(db: AsyncSession, user: User) -> Agent | None:
    """Create a Main Agent for the user if they don't already have one.

    Resolution order for Role Template:
    1. Template matching the user's department_id (within their tenant)
    2. Tenant-level default template (category='default')
    3. No template found → skip silently, return None

    Returns the existing or newly created Main Agent, or None.
    """
    if not user.tenant_id:
        return None

    # Check if user already has a main agent
    result = await db.execute(
        select(Agent).where(
            Agent.owner_user_id == user.id,
            Agent.agent_kind == "main",
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    # Find matching Role Template
    template = await _resolve_template(db, user)
    if not template:
        logger.debug(f"[auto-provision] No Role Template for user {user.username} — skipping")
        return None

    agent = Agent(
        name=template.name,
        role_description=template.description,
        bio=template.soul_template or None,
        agent_kind="main",
        owner_user_id=user.id,
        creator_id=user.id,
        tenant_id=user.tenant_id,
        template_id=template.id,
        primary_model_id=template.model_id,
        channel_perms=True,
        config_version=1,
        status="running",
    )
    db.add(agent)
    await db.flush()

    await bump_sync_version(db, user.tenant_id)

    logger.info(f"[auto-provision] Created Main Agent '{agent.name}' for user {user.username} from template '{template.name}'")
    return agent


async def _resolve_template(db: AsyncSession, user: User) -> AgentTemplate | None:
    """Find the best matching Role Template for the user."""
    # 1. Department-specific template
    if user.department_id:
        result = await db.execute(
            select(AgentTemplate).where(
                AgentTemplate.tenant_id == user.tenant_id,
                AgentTemplate.department_id == user.department_id,
            ).limit(1)
        )
        template = result.scalar_one_or_none()
        if template:
            return template

    # 2. Tenant-level default template
    result = await db.execute(
        select(AgentTemplate).where(
            AgentTemplate.tenant_id == user.tenant_id,
            AgentTemplate.category == "default",
        ).limit(1)
    )
    return result.scalar_one_or_none()
