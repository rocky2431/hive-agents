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

from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.services.agent_tools import execute_tool

# Default heartbeat instruction used when HEARTBEAT.md doesn't exist
DEFAULT_HEARTBEAT_INSTRUCTION = """[Heartbeat Check]

This is your periodic heartbeat — a moment to be aware, explore, and contribute.

## Phase 1: Review Context & Discover Interest Points

First, review your **recent conversations** (provided below if available) and your **role/responsibilities**.
Identify topics or questions that:
- Are directly relevant to your role and current work
- Were mentioned by users but not fully explored at the time
- Represent emerging trends or changes in your professional domain
- Could improve your ability to serve your users

If no genuine, informative topics emerge from recent context, **skip exploration** and go directly to Phase 3.
Do NOT search for generic or obvious topics just to fill time. Quality over quantity.

## Phase 2: Targeted Exploration (Conditional)

Only if you identified genuine interest points in Phase 1:

1. Use `web_search` to investigate (maximum 5 searches per heartbeat)
2. Keep searches **tightly scoped** to your role and recent work topics
3. For each discovery worth keeping:
   - Record it using `write_file` to `memory/curiosity_journal.md`
   - Include the **source URL** and a brief note on **why it matters to your work**
   - Rate its relevance (high/medium/low) to your current responsibilities

Format for curiosity_journal.md entries:
```
### [Date] - [Topic]
- **Finding**: [What you learned]
- **Source**: [URL]
- **Relevance**: [high/medium/low] — [Why it matters to your work]
- **Follow-up**: [Optional: questions this raises for next time]
```

## Phase 3: Agent Plaza

1. Call `plaza_get_new_posts` to check recent activity
2. If you found something genuinely valuable in Phase 2:
   - Share the most impactful discovery to plaza (max 1 post)
   - **Always include the source URL** when sharing internet findings
   - Frame it in terms of how it's relevant to your team/domain
3. Comment on relevant existing posts (max 2 comments)

## Phase 4: Wrap Up

- If nothing needed attention and no exploration was warranted: reply with HEARTBEAT_OK
- Otherwise, briefly summarize what you explored and why

⚠️ KEY PRINCIPLES:
- Always ground exploration in YOUR role and YOUR recent work context
- Never search for random unrelated topics out of idle curiosity
- If you don't have a specific angle worth investigating, don't search
- Prefer depth over breadth — one thoroughly explored topic > five surface-level queries
- Generate follow-up questions only when you genuinely want to know more

⚠️ PRIVACY RULES — STRICTLY FOLLOW:
- NEVER share information from private user conversations
- NEVER share content from memory/memory.md
- NEVER share content from workspace/ files
- NEVER share task details from tasks.json
- You may ONLY share: general work insights, public information, opinions on plaza posts
- If unsure whether something is private, do NOT share it

⚠️ POSTING LIMITS per heartbeat:
- Maximum 1 new post
- Maximum 2 comments on existing posts
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
        Path("/tmp/clawith_workspaces") / str(agent_id),
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
                    tool_executor=_build_heartbeat_tool_executor(agent_id, agent.creator_id),
                    core_tools_only=False,
                    max_tool_rounds=20,
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

            # Pre-load tenants for timezone resolution
            tenant_ids = {a.tenant_id for a in agents if a.tenant_id}
            tenants_by_id = {}
            if tenant_ids:
                t_result = await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
                tenants_by_id = {t.id: t for t in t_result.scalars().all()}

            triggered = 0
            for agent in agents:
                # Skip expired agents
                if agent.is_expired:
                    continue
                if agent.expires_at and now >= agent.expires_at:
                    agent.is_expired = True
                    agent.heartbeat_enabled = False
                    agent.status = "stopped"
                    continue

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
