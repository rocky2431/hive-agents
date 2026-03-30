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

# Single source of truth for HEARTBEAT.md: app/templates/HEARTBEAT.md
_HEARTBEAT_TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "HEARTBEAT.md"

_EVOLUTION_SCORECARD_SEED = """\
# Evolution Scorecard

## Metrics (updated each heartbeat)
- total_heartbeats: 0
- useful_heartbeats: 0
- failed_attempts: 0
- blocked_approaches: 0
- skills_created: 0
- strategies_evolved: 0

## Recent Trend
(updated automatically by heartbeat Phase 4)
"""

_EVOLUTION_BLOCKLIST_SEED = """\
# Blocked Approaches

Approaches proven impossible in this environment. Do NOT retry these.

(none yet)
"""

_EVOLUTION_LINEAGE_SEED = """\
# Evolution Lineage

Each heartbeat records what was tried and the outcome.
The next heartbeat reads this to avoid repeating failures and to build on successes.

(no entries yet)
"""


def _bootstrap_evolution_files(ws: Path) -> None:
    """Create evolution seed files if they don't exist."""
    seeds = {
        "evolution/scorecard.md": _EVOLUTION_SCORECARD_SEED,
        "evolution/blocklist.md": _EVOLUTION_BLOCKLIST_SEED,
        "evolution/lineage.md": _EVOLUTION_LINEAGE_SEED,
    }
    for rel_path, content in seeds.items():
        fpath = ws / rel_path
        if not fpath.exists():
            fpath.write_text(content, encoding="utf-8")


async def ensure_workspace(agent_id: uuid.UUID, tenant_id: str | None = None) -> Path:
    """Initialize agent workspace with standard structure."""
    ws = WORKSPACE_ROOT / str(agent_id)
    ws.mkdir(parents=True, exist_ok=True)

    (ws / "skills").mkdir(exist_ok=True)
    (ws / "workspace").mkdir(exist_ok=True)
    (ws / "workspace" / "knowledge_base").mkdir(exist_ok=True)
    (ws / "memory").mkdir(exist_ok=True)
    (ws / "memory" / "learnings").mkdir(exist_ok=True)
    (ws / "evolution").mkdir(exist_ok=True)

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

    # Pre-create learnings standard files so heartbeat/skills don't waste tool calls on missing files
    for learnings_file, learnings_seed in [
        ("memory/learnings/ERRORS.md", "# Errors\n\nRecord operation failures here for review during heartbeat.\n"),
        ("memory/learnings/LEARNINGS.md", "# Learnings\n\nRecord corrections, insights, and best practices here.\n"),
    ]:
        lpath = ws / learnings_file
        if not lpath.exists():
            lpath.write_text(learnings_seed, encoding="utf-8")

    if not (ws / "memory" / "memory.md").exists():
        (ws / "memory" / "memory.md").write_text(
            "# Memory\n\n_Record important information and knowledge here._\n",
            encoding="utf-8",
        )

    if not (ws / "soul.md").exists():
        # Structure aligned with agent_template/soul.md (single source of truth)
        agent_name = str(agent_id)[:8]
        role_desc = "digital assistant"
        try:
            async with async_session() as db:
                result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = result.scalar_one_or_none()
                if agent:
                    agent_name = agent.name or agent_name
                    role_desc = agent.role_description or role_desc
        except Exception as exc:
            logger.warning("[Workspace] Failed to load agent for soul.md: %s", exc)
        soul_content = f"""# Soul — {agent_name}

## Identity
- Name: {agent_name}
- Role: {role_desc}

## Personality
- 认真负责、注重细节
- 主动汇报工作进展
- 遇到不确定的信息会主动确认

## Boundaries
- 遵守企业保密制度
- 敏感操作需经过创建者审批
"""
        (ws / "soul.md").write_text(soul_content.strip() + "\n", encoding="utf-8")

    # Bootstrap evolution seed files
    _bootstrap_evolution_files(ws)

    if not (ws / "HEARTBEAT.md").exists():
        try:
            hb_content = _HEARTBEAT_TEMPLATE_PATH.read_text(encoding="utf-8")
        except Exception:
            hb_content = "# Heartbeat\n\nCheck focus.md, do one useful thing, reply HEARTBEAT_OK if nothing needed.\n"
        (ws / "HEARTBEAT.md").write_text(hb_content, encoding="utf-8")

    # Pre-install system skills from templates
    templates_dir = Path(__file__).resolve().parent.parent / "templates" / "skills"
    if templates_dir.is_dir():
        for skill_tmpl in templates_dir.iterdir():
            if skill_tmpl.is_dir() and not (ws / "skills" / skill_tmpl.name / "SKILL.md").exists():
                dest = ws / "skills" / skill_tmpl.name
                dest.mkdir(parents=True, exist_ok=True)
                for f in skill_tmpl.rglob("*"):
                    if f.is_file():
                        rel = f.relative_to(skill_tmpl)
                        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(str(f), str(dest / rel))

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
