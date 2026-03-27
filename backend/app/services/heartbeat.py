"""Heartbeat service — proactive agent awareness loop.

Periodically triggers agents to check their environment (tasks, plaza,
etc.) and take autonomous actions. Inspired by OpenClaw's heartbeat
mechanism.

Runs as a background task inside the FastAPI process.
"""

import asyncio
import uuid
from datetime import datetime, timezone, timedelta

from loguru import logger
from sqlalchemy import select

from app.kernel.contracts import ExecutionIdentityRef
from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext
from app.services.agent_tools import execute_tool

# Default heartbeat instruction used when HEARTBEAT.md doesn't exist
DEFAULT_HEARTBEAT_INSTRUCTION = """[Heartbeat Check]

This is your periodic heartbeat — a moment for self-maintenance, proactive thinking, and exploration.

## Phase 1: Self-Check (Always)

1. Read `focus.md` — is it current? Update if stale or missing.
2. Check `memory/learnings/ERRORS.md` — any unresolved errors to retry or document?
3. Check `memory/learnings/LEARNINGS.md` — any learnings worth promoting to `soul.md` or `memory/memory.md`?
4. Verify `memory/memory.md` — any important context from recent conversations that should be persisted?

## Phase 2: Proactive Thinking

Ask yourself:
- What could I do right now that would help my user without being asked?
- Are there repeated requests I could automate with a trigger?
- Are there decisions older than 7 days that need follow-up?

If you identify something actionable, do it (within your autonomy policy).

## Phase 3: Exploration (Conditional)

Review recent conversations for topics worth investigating.
If a genuine, role-relevant topic emerges:
1. Use `load_skill` or `tool_search` to activate web research
2. Investigate with web tools (maximum 5 searches)
3. Record findings to `memory/curiosity_journal.md` with source URL and relevance rating

If nothing worth exploring, skip to Phase 4.

## Phase 4: Agent Plaza

1. Call `plaza_get_new_posts` to check recent activity
2. Share 1 valuable discovery (max 1 post, must include source URL)
3. Comment on relevant posts (max 2 comments)

## Phase 5: Wrap Up

- If nothing needed attention: reply HEARTBEAT_OK
- Otherwise: briefly summarize what you did and why

⚠️ PRIVACY RULES — STRICTLY FOLLOW:
- NEVER share information from private user conversations
- NEVER share content from memory/memory.md or workspace/ files
- You may ONLY share: general work insights, public information, opinions on plaza posts

⚠️ POSTING LIMITS per heartbeat:
- Maximum 1 new post, 2 comments
- Do NOT post trivial or repetitive content
"""


def _is_in_active_hours(active_hours: str, tz_name: str = "UTC") -> bool:
    """Check if current time is within the agent's active hours.

    Format: "HH:MM-HH:MM" (e.g., "09:00-18:00")
    Uses agent's configured timezone (defaults to UTC).
    """
    try:
        from zoneinfo import ZoneInfo
        start_str, end_str = active_hours.split("-")
        sh, sm = map(int, start_str.strip().split(":"))
        eh, em = map(int, end_str.strip().split(":"))
        try:
            tz = ZoneInfo(tz_name)
        except (KeyError, Exception):
            tz = ZoneInfo("UTC")
        now = datetime.now(tz)
        current_minutes = now.hour * 60 + now.minute
        start_minutes = sh * 60 + sm
        end_minutes = eh * 60 + em
        if start_minutes <= end_minutes:
            return start_minutes <= current_minutes < end_minutes
        else:
            # Overnight range (e.g., "22:00-06:00")
            return current_minutes >= start_minutes or current_minutes < end_minutes
    except Exception:
        return True  # Default to active if parsing fails


def _load_heartbeat_instruction(agent_id: uuid.UUID) -> str:
    """Read HEARTBEAT.md if present, otherwise fall back to the default instruction."""
    from pathlib import Path

    from app.config import get_settings

    settings = get_settings()
    heartbeat_instruction = DEFAULT_HEARTBEAT_INSTRUCTION

    for ws_root in [
        Path("/tmp/hive_workspaces") / str(agent_id),
        Path(settings.AGENT_DATA_DIR) / str(agent_id),
    ]:
        hb_file = ws_root / "HEARTBEAT.md"
        if not hb_file.exists():
            continue
        try:
            custom = hb_file.read_text(encoding="utf-8", errors="replace").strip()
        except Exception:
            custom = ""
        if not custom:
            break
        return custom + """

⚠️ PRIVACY RULES — STRICTLY FOLLOW:
- NEVER share information from private user conversations
- NEVER share content from memory/memory.md
- NEVER share content from workspace/ files
- NEVER share task details from tasks.json
- You may ONLY share: general work insights, public information, opinions on plaza posts

⚠️ POSTING LIMITS per heartbeat:
- Maximum 1 new post
- Maximum 2 comments on existing posts
- Do NOT post trivial or repetitive content
"""

    return heartbeat_instruction


def _format_recent_activity_context(recent_activities: list) -> str:
    if not recent_activities:
        return ""

    items = []
    for act in reversed(recent_activities):
        ts = act.created_at.strftime("%m-%d %H:%M") if act.created_at else ""
        items.append(f"- [{ts}] {act.action_type}: {act.summary[:120]}")
    return (
        "\n\n---\n## Recent Activity Context\n"
        "Here are your recent interactions and work to help you identify relevant topics:\n\n"
        + "\n".join(items)
    )


def _build_heartbeat_tool_executor(agent_id: uuid.UUID, creator_id: uuid.UUID):
    """Build a tool executor with per-heartbeat plaza posting limits."""
    plaza_posts_made = 0
    plaza_comments_made = 0

    async def _executor(tool_name: str, args: dict) -> str:
        nonlocal plaza_posts_made, plaza_comments_made

        if tool_name == "plaza_create_post":
            if plaza_posts_made >= 1:
                return "[BLOCKED] You have already made 1 plaza post this heartbeat. Do not post again."
            plaza_posts_made += 1
        elif tool_name == "plaza_add_comment":
            if plaza_comments_made >= 2:
                return "[BLOCKED] You have already made 2 comments this heartbeat. Do not comment again."
            plaza_comments_made += 1

        return await execute_tool(tool_name, args, agent_id, creator_id)

    return _executor


async def _execute_heartbeat(agent_id: uuid.UUID):
    """Execute a single heartbeat for an agent."""
    try:
        from app.database import async_session
        from app.models.agent import Agent
        from app.models.llm import LLMModel

        async with async_session() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent:
                return

            # Set execution identity — autonomous heartbeat action
            from app.core.execution_context import set_agent_bot_identity
            set_agent_bot_identity(agent_id, agent.name, source="heartbeat")

            model_id = agent.primary_model_id or agent.fallback_model_id
            if not model_id:
                return

            model_result = await db.execute(select(LLMModel).where(LLMModel.id == model_id))
            model = model_result.scalar_one_or_none()
            if not model:
                return

            # Fetch recent activity to give heartbeat context for curiosity exploration
            from app.models.activity_log import AgentActivityLog
            try:
                recent_result = await db.execute(
                    select(AgentActivityLog)
                    .where(AgentActivityLog.agent_id == agent_id)
                    .where(AgentActivityLog.action_type.in_(["chat_reply", "tool_call", "task_created", "task_updated"]))
                    .order_by(AgentActivityLog.created_at.desc())
                    .limit(50)
                )
                recent_activities = recent_result.scalars().all()
                recent_context = _format_recent_activity_context(recent_activities)
            except Exception as e:
                logger.warning(f"Failed to fetch recent activity for heartbeat context: {e}")
                recent_context = ""

            full_instruction = _load_heartbeat_instruction(agent_id) + recent_context
            runtime_messages = [{"role": "user", "content": full_instruction}]

            result = await invoke_agent(
                AgentInvocationRequest(
                    model=model,
                    messages=runtime_messages,
                    memory_messages=runtime_messages,
                    agent_name=agent.name,
                    role_description=agent.role_description or "",
                    agent_id=agent_id,
                    user_id=agent.creator_id,
                    execution_identity=ExecutionIdentityRef(
                        identity_type="agent_bot",
                        identity_id=agent_id,
                        label=f"Agent: {agent.name} (heartbeat)",
                    ),
                    session_context=SessionContext(
                        source="heartbeat",
                        channel="heartbeat",
                        metadata={"agent_id": str(agent_id)},
                    ),
                    tool_executor=_build_heartbeat_tool_executor(agent_id, agent.creator_id),
                    core_tools_only=True,
                    max_tool_rounds=50,
                )
            )
            reply = result.content

            # Suppress HEARTBEAT_OK
            is_ok = "HEARTBEAT_OK" in reply.upper().replace(" ", "_") if reply else False
            if not is_ok and reply:
                from app.services.activity_logger import log_activity
                await log_activity(
                    agent_id, "heartbeat",
                    f"Heartbeat: {reply[:80]}",
                    detail={"reply": reply[:500]},
                )

            # Update last_heartbeat_at
            agent.last_heartbeat_at = datetime.now(timezone.utc)
            await db.commit()

            logger.info(f"💓 Heartbeat for {agent.name}: {'OK' if is_ok else reply[:60]}")

    except Exception as e:
        logger.error(f"Heartbeat error for agent {agent_id}: {e}", exc_info=True)


async def _heartbeat_tick():
    """One heartbeat tick: find agents due for heartbeat."""
    from app.database import async_session
    from app.models.agent import Agent
    from app.services.audit_logger import write_audit_log
    from app.services.timezone_utils import get_agent_timezone_sync
    from app.models.tenant import Tenant

    now = datetime.now(timezone.utc)

    try:
        async with async_session() as db:
            result = await db.execute(
                select(Agent).where(
                    Agent.heartbeat_enabled == True,
                    Agent.status.in_(["running", "idle"]),
                )
            )
            agents = result.scalars().all()

            # Periodic workspace sync — write DB data to files agents can read
            synced_tenants = set()
            for a in agents:
                if a.tenant_id and a.tenant_id not in synced_tenants:
                    try:
                        from app.services.workspace_sync import sync_all_for_tenant
                        await sync_all_for_tenant(db, a.tenant_id)
                        synced_tenants.add(a.tenant_id)
                    except Exception as sync_err:
                        logger.debug(f"Workspace sync skipped: {sync_err}")

            # Pre-load tenants for timezone resolution
            tenant_ids = {a.tenant_id for a in agents if a.tenant_id}
            tenants_by_id = {}
            if tenant_ids:
                t_result = await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
                tenants_by_id = {t.id: t for t in t_result.scalars().all()}

            triggered = 0
            for agent in agents:
                # Resolve timezone
                tenant = tenants_by_id.get(agent.tenant_id)
                tz_name = get_agent_timezone_sync(agent, tenant)

                # Check active hours (in agent's timezone)
                if not _is_in_active_hours(agent.heartbeat_active_hours or "09:00-18:00", tz_name):
                    continue

                # Check interval
                interval = timedelta(minutes=agent.heartbeat_interval_minutes or 30)
                if agent.last_heartbeat_at and (now - agent.last_heartbeat_at) < interval:
                    continue

                # Fire heartbeat
                logger.info(f"💓 Triggering heartbeat for {agent.name}")
                await write_audit_log("heartbeat_fire", {"agent_name": agent.name}, agent_id=agent.id)
                asyncio.create_task(_execute_heartbeat(agent.id))
                triggered += 1

            if triggered:
                await write_audit_log("heartbeat_tick", {"eligible_agents": len(agents), "triggered": triggered})

    except Exception as e:
        logger.error(f"Heartbeat tick error: {e}", exc_info=True)
        await write_audit_log("heartbeat_error", {"error": str(e)[:300]})


async def start_heartbeat():
    """Start the background heartbeat loop. Call from FastAPI startup."""
    logger.info("💓 Agent heartbeat service started (60s tick)")
    while True:
        await _heartbeat_tick()
        await asyncio.sleep(60)
