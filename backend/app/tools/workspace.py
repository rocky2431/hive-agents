"""Workspace bootstrap helpers for tool runtime."""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path

from sqlalchemy import select

from app.config import get_settings
from app.database import async_session
from app.models.agent import Agent
from app.models.task import Task

logger = logging.getLogger(__name__)

_settings = get_settings()
WORKSPACE_ROOT = Path(_settings.AGENT_DATA_DIR)


async def ensure_workspace(agent_id: uuid.UUID, tenant_id: str | None = None) -> Path:
    """Initialize agent workspace with standard structure."""
    ws = WORKSPACE_ROOT / str(agent_id)
    ws.mkdir(parents=True, exist_ok=True)

    (ws / "skills").mkdir(exist_ok=True)
    (ws / "workspace").mkdir(exist_ok=True)
    (ws / "workspace" / "knowledge_base").mkdir(exist_ok=True)
    (ws / "memory").mkdir(exist_ok=True)

    if tenant_id:
        enterprise_dir = WORKSPACE_ROOT / f"enterprise_info_{tenant_id}"
    else:
        enterprise_dir = WORKSPACE_ROOT / "enterprise_info"
    enterprise_dir.mkdir(parents=True, exist_ok=True)
    (enterprise_dir / "knowledge_base").mkdir(exist_ok=True)

    profile_path = enterprise_dir / "company_profile.md"
    if not profile_path.exists():
        profile_path.write_text(
            "# Company Profile\n\n_Edit company information here. All digital employees can access this._\n\n## Basic Info\n- Company Name:\n- Industry:\n- Founded:\n\n## Business Overview\n\n## Organization Structure\n\n## Company Culture\n",
            encoding="utf-8",
        )

    if (ws / "memory.md").exists() and not (ws / "memory" / "memory.md").exists():
        shutil.move(str(ws / "memory.md"), str(ws / "memory" / "memory.md"))

    if not (ws / "memory" / "memory.md").exists():
        (ws / "memory" / "memory.md").write_text(
            "# Memory\n\n_Record important information and knowledge here._\n",
            encoding="utf-8",
        )

    if not (ws / "soul.md").exists():
        try:
            async with async_session() as db:
                result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = result.scalar_one_or_none()
                if agent and agent.role_description:
                    (ws / "soul.md").write_text(
                        f"# Personality\n\n{agent.role_description}\n",
                        encoding="utf-8",
                    )
                else:
                    (ws / "soul.md").write_text(
                        "# Personality\n\n_Describe your role and responsibilities._\n",
                        encoding="utf-8",
                    )
        except Exception:
            (ws / "soul.md").write_text(
                "# Personality\n\n_Describe your role and responsibilities._\n",
                encoding="utf-8",
            )

    await _sync_tasks_to_file(agent_id, ws)
    return ws


async def _sync_tasks_to_file(agent_id: uuid.UUID, ws: Path) -> None:
    """Sync tasks from DB to tasks.json in workspace."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(Task).where(Task.agent_id == agent_id).order_by(Task.created_at.desc())
            )
            tasks = result.scalars().all()

        task_list = []
        for task in tasks:
            task_list.append({
                "title": task.title,
                "status": task.status,
                "priority": task.priority,
                "description": task.description or "",
                "created_at": task.created_at.isoformat() if task.created_at else "",
                "completed_at": task.completed_at.isoformat() if task.completed_at else "",
            })

        (ws / "tasks.json").write_text(
            json.dumps(task_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.error("[Workspace] Failed to sync tasks for agent %s: %s", agent_id, exc)
