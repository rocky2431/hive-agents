"""Heartbeat service — proactive agent awareness loop.

Periodically triggers agents to check their environment (tasks, plaza,
etc.) and take autonomous actions. Inspired by OpenClaw's heartbeat
mechanism.

Runs as a background task inside the FastAPI process.
"""

import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from loguru import logger
from sqlalchemy import select

from app.kernel.contracts import ExecutionIdentityRef
from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext
from app.services.agent_tools import execute_tool

# Single source of truth: app/templates/HEARTBEAT.md
# No hardcoded instruction here — read from template file at runtime.
_HEARTBEAT_TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "HEARTBEAT.md"

_HEARTBEAT_PRIVACY_SUFFIX = """
⚠️ PRIVACY RULES — STRICTLY FOLLOW:
- NEVER share information from private user conversations
- NEVER share content from memory/memory.md or workspace/ files
- NEVER share task details from tasks.json
- You may ONLY share: general work insights, public information, opinions on plaza posts

⚠️ POSTING LIMITS per heartbeat:
- Maximum 1 new post, 2 comments
- Do NOT post trivial or repetitive content
"""


def _get_default_heartbeat_instruction() -> str:
    """Read default heartbeat instruction from templates/HEARTBEAT.md (single source of truth)."""
    try:
        return _HEARTBEAT_TEMPLATE_PATH.read_text(encoding="utf-8").strip()
    except Exception:
        return "[Heartbeat] Check focus.md, do one useful thing, reply HEARTBEAT_OK if nothing needed."


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
    """Read agent's HEARTBEAT.md, fallback to templates/HEARTBEAT.md (single source of truth)."""
    from app.config import get_settings

    settings = get_settings()

    for ws_root in [
        Path("/tmp/hive_workspaces") / str(agent_id),
        Path(settings.AGENT_DATA_DIR) / str(agent_id),
    ]:
        hb_file = ws_root / "HEARTBEAT.md"
        if not hb_file.exists():
            continue
        try:
            custom = hb_file.read_text(encoding="utf-8", errors="replace").strip()
        except Exception as e:
            logger.debug(f"Failed to read HEARTBEAT.md from {hb_file}: {e}")
            custom = ""
        if not custom:
            break
        return custom + _HEARTBEAT_PRIVACY_SUFFIX

    return _get_default_heartbeat_instruction() + _HEARTBEAT_PRIVACY_SUFFIX



async def _build_evolution_context(agent_id: uuid.UUID, recent_activities: list) -> str:
    """Build structured evolution context from activity logs and workspace evolution files.

    This is the server-side pattern analysis that feeds into the heartbeat prompt,
    giving the agent pre-computed metrics instead of raw activity logs.
    """
    from collections import Counter
    from pathlib import Path

    from app.config import get_settings

    settings = get_settings()
    parts: list[str] = []

    # 1. Read evolution files from workspace
    for ws_root in [
        Path("/tmp/hive_workspaces") / str(agent_id),
        Path(settings.AGENT_DATA_DIR) / str(agent_id),
    ]:
        for filename in ["evolution/scorecard.md", "evolution/blocklist.md"]:
            fpath = ws_root / filename
            if fpath.exists():
                try:
                    content = fpath.read_text(encoding="utf-8", errors="replace").strip()
                    if content:
                        parts.append(content)
                except Exception as e:
                    logger.debug(f"Failed to read evolution file {fpath}: {e}")

        # Only read lineage tail (last 5 entries to save tokens)
        lineage_path = ws_root / "evolution" / "lineage.md"
        if lineage_path.exists():
            try:
                full = lineage_path.read_text(encoding="utf-8", errors="replace").strip()
                lines = full.split("\n")
                if len(lines) > 35:
                    parts.append("\n".join(lines[:3] + ["...(earlier entries omitted)..."] + lines[-30:]))
                else:
                    parts.append(full)
            except Exception as e:
                logger.debug(f"Failed to read evolution lineage: {e}")

        if parts:
            break  # Found workspace, don't check fallback path

    # 2. Compute pattern summary from activity logs
    if recent_activities:
        error_count = sum(1 for a in recent_activities if a.action_type == "error")
        heartbeat_count = sum(1 for a in recent_activities if a.action_type == "heartbeat")
        tool_count = sum(1 for a in recent_activities if a.action_type == "tool_call")
        total = len(recent_activities)

        # Detect repeated failure patterns
        error_summaries = [a.summary[:80] for a in recent_activities if a.action_type == "error"]
        repeated_errors = [
            f"  - '{err}' (x{count})"
            for err, count in Counter(error_summaries).most_common(3)
            if count > 1
        ]

        # Tool usage frequency
        tool_names = []
        for a in recent_activities:
            if a.action_type == "tool_call" and a.detail_json:
                tool_name = a.detail_json.get("tool", "")
                if tool_name:
                    tool_names.append(tool_name)
        top_tools = [f"  - {name} (x{count})" for name, count in Counter(tool_names).most_common(5)]

        pattern_section = (
            f"\n---\n## Activity Pattern Analysis (auto-computed, last {total} activities)\n"
            f"- Errors: {error_count} ({error_count * 100 // max(total, 1)}%)\n"
            f"- Heartbeats logged: {heartbeat_count}\n"
            f"- Tool calls: {tool_count}\n"
        )
        if repeated_errors:
            pattern_section += "- **Repeated failures** (MUST NOT retry these approaches):\n" + "\n".join(repeated_errors) + "\n"
        if top_tools:
            pattern_section += "- Top tools used:\n" + "\n".join(top_tools) + "\n"

        parts.append(pattern_section)

    return "\n\n".join(parts) if parts else ""


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

            model_result = await db.execute(
                select(LLMModel).where(LLMModel.id == model_id, LLMModel.tenant_id == agent.tenant_id)
            )
            model = model_result.scalar_one_or_none()
            if not model:
                return

            # Fetch recent activity for evolution context
            from app.models.activity_log import AgentActivityLog
            try:
                recent_result = await db.execute(
                    select(AgentActivityLog)
                    .where(AgentActivityLog.agent_id == agent_id)
                    .where(AgentActivityLog.action_type.in_(
                        ["chat_reply", "tool_call", "task_created", "task_updated", "error", "heartbeat"]
                    ))
                    .order_by(AgentActivityLog.created_at.desc())
                    .limit(50)
                )
                recent_activities = recent_result.scalars().all()
                evolution_context = await _build_evolution_context(agent_id, recent_activities)
            except Exception as e:
                logger.warning(f"Failed to build evolution context for heartbeat: {e}")
                evolution_context = ""

            heartbeat_instruction = _load_heartbeat_instruction(agent_id)
            if evolution_context:
                heartbeat_instruction += "\n\n" + evolution_context
            runtime_messages = [{"role": "user", "content": heartbeat_instruction}]

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
                    max_tool_rounds=15,
                )
            )
            reply = result.content

            # Always log heartbeat outcome — evolution system needs complete data
            is_ok = "HEARTBEAT_OK" in reply.upper().replace(" ", "_") if reply else False
            outcome_type = "noop" if is_ok else "action_taken"
            if reply and any(kw in reply.lower() for kw in ["error", "failed", "cannot", "unable", "blocked"]):
                outcome_type = "failure"

            from app.services.activity_logger import log_activity
            await log_activity(
                agent_id, "heartbeat",
                f"Heartbeat: {'OK' if is_ok else (reply[:80] if reply else 'empty')}",
                detail={
                    "reply": reply[:500] if reply else "",
                    "outcome_type": outcome_type,
                },
            )

            # Update last_heartbeat_at
            agent.last_heartbeat_at = datetime.now(timezone.utc)
            await db.commit()

            logger.info(f"💓 Heartbeat for {agent.name}: {'OK' if is_ok else reply[:60] if reply else 'empty'}")

    except Exception as e:
        logger.error(f"Heartbeat error for agent {agent_id}: {e}", exc_info=True)
        # CRITICAL: Update last_heartbeat_at even on failure to prevent
        # every-minute storm (if timestamp stays None, agent is always eligible)
        try:
            from app.database import async_session as _async_session
            async with _async_session() as _db:
                from app.models.agent import Agent as _Agent
                _result = await _db.execute(select(_Agent).where(_Agent.id == agent_id))
                _agent = _result.scalar_one_or_none()
                if _agent:
                    _agent.last_heartbeat_at = datetime.now(timezone.utc)
                    await _db.commit()
        except Exception as db_err:
            logger.warning(f"Failed to update last_heartbeat_at after error: {db_err}")
        # Log crash to activity so evolution system can see it
        try:
            from app.services.activity_logger import log_activity
            await log_activity(
                agent_id, "heartbeat",
                f"Heartbeat crash: {str(e)[:80]}",
                detail={"outcome_type": "crash", "error": str(e)[:300]},
            )
        except Exception as log_err:
            logger.debug(f"Failed to log heartbeat crash to activity: {log_err}")


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
