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

_DEFAULT_HEARTBEAT_MD = """\
# Heartbeat — Self-Evolution Protocol

You are in heartbeat mode. Your goal: observe your performance, do ONE useful thing, learn from the outcome, evolve.

## Phase 1: OBSERVE (2-3 tool calls max)

1. Read `evolution/scorecard.md` — your performance history.
2. Read `evolution/blocklist.md` — approaches you MUST NOT retry.
3. Read `focus.md` — your current work priorities.
4. Skim `memory/learnings/ERRORS.md` — any unresolved errors.

**RULE: If an approach is in blocklist.md, do NOT attempt it. Find an alternative or skip.**

## Phase 2: ANALYZE (think, no tool calls)

Ask yourself:
- What is my highest-priority focus item that I can actually make progress on?
- Have I been failing at the same thing repeatedly? If yes, either:
  a) Try a fundamentally different approach (not a minor variation)
  b) Add it to blocklist.md and move to something else
  c) Send a message to your user asking for help
- What is ONE action that would create the most value right now?

## Phase 3: ACT (1 focused action, 5-8 tool calls max)

Do exactly ONE of these (pick the highest value):
- [ ] Advance a focus.md task using a NEW approach (not blocked)
- [ ] Fix an unresolved error from ERRORS.md
- [ ] Create or improve a skill in skills/
- [ ] Update focus.md with new priorities based on what you learned
- [ ] Research something relevant (load_skill first, max 3 searches)
- [ ] Post to plaza (max 1 post, 2 comments)

**If nothing is actionable: skip to Phase 4. Do NOT waste rounds.**

## Phase 4: EVOLVE (2-3 tool calls)

1. **Score this heartbeat** (0-10):
   - 0: Did nothing / repeated a blocked approach
   - 3: Maintained state (updated focus.md, logged learnings)
   - 5: Made partial progress on a task
   - 7: Completed a subtask or fixed an error
   - 10: Delivered a complete result

2. **Append to `evolution/lineage.md`**:
   ```
   ### HB-{YYYY-MM-DD-HH:MM}
   - Strategy: {what I chose to do and why}
   - Action: {what I actually did}
   - Outcome: {result — success/partial/failure}
   - Score: {0-10}
   - Learning: {what I learned, if anything}
   - Next: {what should the next heartbeat focus on}
   ```

3. **Update `evolution/scorecard.md`**: increment counters.

4. **If score <= 2 for 3 consecutive heartbeats on the same approach**:
   - Add the approach to `evolution/blocklist.md` with the reason
   - Consider editing THIS file (HEARTBEAT.md) to improve your strategy

5. **If you discovered a better strategy**: edit HEARTBEAT.md to refine Phase 3.

## Constraints
- Maximum 15 tool rounds total. Budget them wisely.
- NEVER share private data (memory.md, workspace/ files, tasks.json) in plaza posts.
- Maximum 1 plaza post, 2 comments per heartbeat.
- If nothing needs attention: reply HEARTBEAT_OK
"""

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

    # Bootstrap evolution seed files
    _bootstrap_evolution_files(ws)

    if not (ws / "HEARTBEAT.md").exists():
        (ws / "HEARTBEAT.md").write_text(
            _DEFAULT_HEARTBEAT_MD,
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
