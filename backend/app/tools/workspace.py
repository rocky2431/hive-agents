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
    (ws / "memory" / "learnings").mkdir(exist_ok=True)

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
        role_desc = "_Describe your role and responsibilities._"
        try:
            async with async_session() as db:
                result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = result.scalar_one_or_none()
                if agent and agent.role_description:
                    role_desc = agent.role_description
        except Exception as exc:
            logger.warning("[Workspace] Failed to load role_description for soul.md: %s", exc)
        soul_content = f"""# Personality

{role_desc}

# Behavioral Protocols

- **Write-before-reply (WAL)**: When you receive corrections, decisions, or critical info, write to focus.md (current task) or memory/memory.md (long-term knowledge) BEFORE responding.
- **Think proactively**: Don't wait for instructions. Ask yourself "what would help my user?" and surface suggestions.
- **Be relentless**: When something fails, try a different approach. Exhaust 5+ methods before asking for help. "Can't" means all options are exhausted.
- **Self-improve**: When an operation fails or the user corrects you, log it to memory/learnings/ (load_skill Self-Improving Agent for the full format).
- **Vet before installing**: Before installing any third-party skill, load_skill Skill Vetter and run the security review. Never skip it.
"""
        (ws / "soul.md").write_text(soul_content.strip() + "\n", encoding="utf-8")

    if not (ws / "HEARTBEAT.md").exists():
        (ws / "HEARTBEAT.md").write_text(
            """\
# Heartbeat

## Self-Check
- [ ] Is focus.md up to date with current work status? Update if stale.
- [ ] Any errors in memory/learnings/ERRORS.md that need follow-up?
- [ ] Any learnings worth promoting to soul.md or memory/memory.md?

## Proactive
- [ ] What could I do right now that would help my user without being asked?
- [ ] Any repeated requests I could automate with a trigger?
- [ ] Any decisions older than 7 days that need follow-up?

## Explore
- Review recent conversations for topics worth investigating.
- If a genuine topic emerges, use web_search/jina_search to research (max 5 searches).
- Record findings to memory/curiosity_journal.md with source URL and relevance rating.
- If nothing worth exploring, skip to Plaza.

## Plaza
- Check plaza_get_new_posts for recent activity.
- Share 1 valuable discovery (max 1 post, must include source URL).
- Comment on relevant posts (max 2 comments).

## Wrap Up
- If nothing needed attention: reply HEARTBEAT_OK
- Otherwise: briefly summarize what you did and why
""",
            encoding="utf-8",
        )

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
