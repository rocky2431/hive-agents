"""Memory configuration API — manage tenant memory/summarization settings."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_admin, get_current_user
from app.core.tenant_scope import resolve_tenant_scope
from app.database import get_db
from app.models.chat_session import ChatSession
from app.models.tenant_setting import TenantSetting
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enterprise/memory", tags=["memory"])


class MemoryConfigUpdate(BaseModel):
    summary_model_id: str | None = None
    compress_threshold: int = 70  # percentage
    keep_recent: int = 10
    extract_to_viking: bool = False


@router.get("/config")
async def get_memory_config(
    tenant_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get tenant memory configuration."""
    target_tenant_id = resolve_tenant_scope(current_user, tenant_id)
    result = await db.execute(
        select(TenantSetting).where(
            TenantSetting.tenant_id == target_tenant_id,
            TenantSetting.key == "memory_config",
        )
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {
            "summary_model_id": None,
            "compress_threshold": 70,
            "keep_recent": 10,
            "extract_to_viking": False,
        }
    return setting.value


@router.put("/config")
async def update_memory_config(
    data: MemoryConfigUpdate,
    tenant_id: str | None = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update tenant memory configuration (admin only)."""
    target_tenant_id = resolve_tenant_scope(current_user, tenant_id)

    result = await db.execute(
        select(TenantSetting).where(
            TenantSetting.tenant_id == target_tenant_id,
            TenantSetting.key == "memory_config",
        )
    )
    setting = result.scalar_one_or_none()

    config_dict = data.model_dump()

    if setting:
        setting.value = config_dict
    else:
        setting = TenantSetting(
            tenant_id=target_tenant_id,
            key="memory_config",
            value=config_dict,
        )
        db.add(setting)

    await db.commit()
    return config_dict


@router.get("/agents/{agent_id}/memory")
async def get_agent_memory(
    agent_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """View agent's structured memory facts (tenant-scoped)."""
    from app.models.agent import Agent

    # Verify agent belongs to caller's tenant
    result = await db.execute(select(Agent.tenant_id).where(Agent.id == agent_id))
    agent_tenant = result.scalar_one_or_none()
    if agent_tenant is None or agent_tenant != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    memory_file = Path(settings.AGENT_DATA_DIR) / str(agent_id) / "memory" / "memory.json"

    if not memory_file.exists():
        return {"facts": []}

    try:
        facts = json.loads(memory_file.read_text())
        if not isinstance(facts, list):
            facts = []
        return {"facts": facts}
    except (json.JSONDecodeError, OSError):
        return {"facts": []}


@router.get("/sessions/{session_id}/summary")
async def get_session_summary(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """View session summary (owner-only access)."""
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": str(session.id),
        "summary": session.summary,
        "title": session.title,
    }
