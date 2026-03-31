"""Heartbeat service — proactive agent awareness loop.

Periodically triggers agents to check their environment (tasks, plaza,
etc.) and take autonomous actions. Inspired by OpenClaw's heartbeat
mechanism.

Runs as a background task inside the FastAPI process.
"""

import asyncio
import re
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



def _parse_heartbeat_outcome(reply: str | None) -> tuple[str, int | None]:
    """Parse structured outcome from heartbeat reply.

    Expects LLM to output [OUTCOME:noop|action_taken|failure] [SCORE:0-10].
    Falls back to heuristics if structured tags are missing.

    Returns (outcome_type, score).
    """
    if not reply:
        return "noop", None

    # Try structured tag first: [OUTCOME:action_taken]
    outcome_match = re.search(r"\[OUTCOME:\s*(noop|action_taken|failure)\s*\]", reply, re.IGNORECASE)
    score_match = re.search(r"\[SCORE:\s*(\d+)\s*\]", reply)

    if outcome_match:
        outcome = outcome_match.group(1).lower()
    else:
        # Fallback heuristics — only when structured tags are absent
        is_ok = "HEARTBEAT_OK" in reply.upper().replace(" ", "_")
        if is_ok:
            outcome = "noop"
        else:
            outcome = "action_taken"

    score = int(score_match.group(1)) if score_match else None
    if score is not None:
        score = min(score, 10)

    return outcome, score


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

        # Read lineage tail — keep enough history for long-term pattern recognition
        lineage_path = ws_root / "evolution" / "lineage.md"
        if lineage_path.exists():
            try:
                full = lineage_path.read_text(encoding="utf-8", errors="replace").strip()
                lines = full.split("\n")
                if len(lines) > 80:
                    parts.append("\n".join(lines[:5] + ["...(earlier entries omitted)..."] + lines[-70:]))
                else:
                    parts.append(full)
            except Exception as e:
                logger.debug(f"Failed to read evolution lineage: {e}")

        # Read compaction summary — context the agent lost during mid-loop compression
        compaction_path = ws_root / "workspace" / "compaction_summary.md"
        if compaction_path.exists():
            try:
                compaction = compaction_path.read_text(encoding="utf-8", errors="replace").strip()
                if compaction:
                    parts.append(f"\n---\n## Last Session Compaction Summary\n{compaction[:2000]}")
            except Exception as e:
                logger.debug(f"Failed to read compaction summary: {e}")

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

        # Include error details (not just summaries) for learning
        error_details = []
        for a in recent_activities:
            if a.action_type == "error" and a.detail_json:
                detail = a.detail_json.get("error", "") or a.detail_json.get("message", "")
                if detail:
                    error_details.append(f"  - {str(detail)[:300]}")
        error_details = error_details[:5]  # Top 5 most recent errors

        pattern_section = (
            f"\n---\n## Activity Pattern Analysis (auto-computed, last {total} activities)\n"
            f"- Errors: {error_count} ({error_count * 100 // max(total, 1)}%)\n"
            f"- Heartbeats logged: {heartbeat_count}\n"
            f"- Tool calls: {tool_count}\n"
        )
        if repeated_errors:
            pattern_section += "- **Repeated failures** (MUST NOT retry these approaches):\n" + "\n".join(repeated_errors) + "\n"
        if error_details:
            pattern_section += "- **Recent error details** (learn from these):\n" + "\n".join(error_details) + "\n"
        if top_tools:
            pattern_section += "- Top tools used:\n" + "\n".join(top_tools) + "\n"

        parts.append(pattern_section)

    # 3. Cold start bootstrap — guide new agents through first heartbeats
    non_heartbeat_activities = [a for a in recent_activities if a.action_type != "heartbeat"]
    is_cold_start = len(non_heartbeat_activities) < 3

    if is_cold_start:
        # Detect repeated bootstrap failures — prevent infinite loop
        recent_heartbeats = [a for a in recent_activities if a.action_type == "heartbeat"]
        consecutive_failures = 0
        for hb in recent_heartbeats:
            outcome = (hb.detail_json or {}).get("outcome_type", "")
            if outcome in ("crash", "failure"):
                consecutive_failures += 1
            else:
                break  # Stop counting at first non-failure

        if consecutive_failures >= 3:
            # Auto-seed evolution files server-side to break the cycle
            _auto_seed_evolution(agent_id)
            parts.append(
                "\n---\n## Bootstrap Recovery (auto-seeded)\n"
                "Your previous bootstrap attempts failed. Evolution files have been\n"
                "auto-seeded with initial values. Skip bootstrapping and proceed with\n"
                "the normal 4-phase heartbeat protocol.\n"
                "Focus on ONE simple action: read focus.md and do something small.\n"
                "Output: [OUTCOME:action_taken] [SCORE:3]"
            )
        else:
            parts.append(
                "\n---\n## Bootstrap Mode (first heartbeats)\n"
                "You have very little activity history. This is normal for a new agent.\n"
                "Instead of the normal heartbeat protocol, do these bootstrapping steps:\n"
                "1. **Read soul.md** — understand your identity and role\n"
                "2. **Read focus.md** — check if initial tasks were set during creation\n"
                "3. **List and read your skills/** — understand your capabilities\n"
                "4. **If focus.md is empty**: write an initial focus based on your role from soul.md\n"
                "5. **Write to evolution/lineage.md** with your bootstrap observations\n"
                "6. Output: [OUTCOME:action_taken] [SCORE:3]\n\n"
                "After bootstrapping, future heartbeats will follow the normal 4-phase protocol."
            )

    return "\n\n".join(parts) if parts else ""


def _auto_seed_evolution(agent_id: uuid.UUID) -> None:
    """Server-side emergency seed: write minimal evolution files to break bootstrap loop."""
    from pathlib import Path

    from app.config import get_settings

    settings = get_settings()
    for ws_root in [
        Path("/tmp/hive_workspaces") / str(agent_id),
        Path(settings.AGENT_DATA_DIR) / str(agent_id),
    ]:
        evo_dir = ws_root / "evolution"
        if ws_root.exists():
            evo_dir.mkdir(parents=True, exist_ok=True)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H:%M")
            # Seed scorecard with initial counters
            scorecard = evo_dir / "scorecard.md"
            if not scorecard.exists() or "(updated each heartbeat)" in scorecard.read_text(encoding="utf-8", errors="replace"):
                scorecard.write_text(
                    "# Evolution Scorecard\n\n## Metrics\n"
                    "- total_heartbeats: 3\n- useful_heartbeats: 0\n"
                    "- failed_attempts: 3\n- blocked_approaches: 0\n"
                    "- skills_created: 0\n- strategies_evolved: 0\n\n"
                    "## Recent Trend\nBootstrap failures detected — auto-seeded.\n",
                    encoding="utf-8",
                )
            # Seed lineage with recovery record
            lineage = evo_dir / "lineage.md"
            lineage_content = lineage.read_text(encoding="utf-8", errors="replace") if lineage.exists() else ""
            if "(no entries yet)" in lineage_content or not lineage_content.strip():
                lineage.write_text(
                    "# Evolution Lineage\n\n"
                    f"### HB-{now} [auto-seed]\n"
                    "- Outcome: recovery\n"
                    "- Summary: 3 bootstrap failures detected, evolution files auto-seeded by server\n",
                    encoding="utf-8",
                )
            logger.info("[Heartbeat] Auto-seeded evolution files for agent %s after 3 bootstrap failures", agent_id)
            return
    logger.warning("[Heartbeat] Cannot auto-seed evolution: no workspace found for agent %s", agent_id)





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


async def _touch_last_heartbeat(agent_id: uuid.UUID) -> None:
    """Update last_heartbeat_at even on early return to prevent infinite re-triggering."""
    try:
        from app.database import async_session as _async_session
        from app.models.agent import Agent as _Agent
        async with _async_session() as _db:
            _result = await _db.execute(select(_Agent).where(_Agent.id == agent_id))
            _agent = _result.scalar_one_or_none()
            if _agent:
                _agent.last_heartbeat_at = datetime.now(timezone.utc)
                await _db.commit()
    except Exception as _exc:
        logger.debug("[Heartbeat] Failed to touch last_heartbeat_at for %s: %s", agent_id, _exc)


async def _execute_heartbeat(agent_id: uuid.UUID):
    """Execute a single heartbeat for an agent.

    Creates a Reflection Session (like trigger_daemon) so tool calls and
    the final reply are persisted and visible in the UI.
    """
    import json as _json

    try:
        from app.database import async_session
        from app.models.agent import Agent
        from app.models.audit import ChatMessage
        from app.models.chat_session import ChatSession
        from app.models.llm import LLMModel
        from app.models.participant import Participant

        async with async_session() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent:
                logger.warning("[Heartbeat] Agent %s not found in DB — skipping", agent_id)
                await _touch_last_heartbeat(agent_id)
                return

            # Set execution identity — autonomous heartbeat action
            from app.core.execution_context import set_agent_bot_identity
            set_agent_bot_identity(agent_id, agent.name, source="heartbeat")

            model_id = agent.primary_model_id or agent.fallback_model_id
            if not model_id:
                logger.warning("[Heartbeat] Agent %s (%s) has no model configured — skipping", agent.name, agent_id)
                await _touch_last_heartbeat(agent_id)
                return

            model_result = await db.execute(
                select(LLMModel).where(LLMModel.id == model_id, LLMModel.tenant_id == agent.tenant_id)
            )
            model = model_result.scalar_one_or_none()
            if not model:
                logger.warning("[Heartbeat] Model %s for agent %s (%s) not found — skipping", model_id, agent.name, agent_id)
                await _touch_last_heartbeat(agent_id)
                return

            # Fetch recent activity for evolution context
            from app.models.activity_log import AgentActivityLog
            try:
                recent_result = await db.execute(
                    select(AgentActivityLog)
                    .where(AgentActivityLog.agent_id == agent_id)
                    .where(AgentActivityLog.action_type.in_([
                        "chat_reply", "tool_call", "task_created", "task_updated",
                        "error", "heartbeat", "web_msg_sent", "feishu_msg_sent",
                        "agent_msg_sent", "file_written", "schedule_run", "plaza_post",
                    ]))
                    .order_by(AgentActivityLog.created_at.desc())
                    .limit(50)
                )
                recent_activities = list(recent_result.scalars().all())
                evolution_context = await _build_evolution_context(agent_id, recent_activities)
            except Exception as e:
                logger.warning(f"Failed to build evolution context for heartbeat: {e}")
                evolution_context = ""

            heartbeat_instruction = _load_heartbeat_instruction(agent_id)
            if evolution_context:
                heartbeat_instruction += "\n\n" + evolution_context
            runtime_messages = [{"role": "user", "content": heartbeat_instruction}]

            # --- Create Reflection Session for observability ---
            p_result = await db.execute(
                select(Participant).where(Participant.type == "agent", Participant.ref_id == agent_id)
            )
            agent_participant = p_result.scalar_one_or_none()
            agent_participant_id = agent_participant.id if agent_participant else None

            session = ChatSession(
                agent_id=agent_id,
                user_id=agent.creator_id,
                participant_id=agent_participant_id,
                source_channel="heartbeat",
                title=f"💓 心跳：{agent.name}"[:200],
            )
            db.add(session)
            await db.flush()
            session_id = session.id

            # Save heartbeat instruction as first message
            db.add(ChatMessage(
                agent_id=agent_id,
                conversation_id=str(session_id),
                role="user",
                content=heartbeat_instruction[:4000],
                user_id=agent.creator_id,
                participant_id=agent_participant_id,
            ))
            await db.commit()

            # Tool call persistence callback
            async def _on_tool_call(data: dict) -> None:
                if data.get("status") != "done":
                    return
                try:
                    async with async_session() as _tc_db:
                        _tc_db.add(ChatMessage(
                            agent_id=agent_id,
                            conversation_id=str(session_id),
                            role="tool_call",
                            content=_json.dumps({
                                "name": data["name"],
                                "args": data.get("args"),
                                "status": "done",
                                "result": str(data.get("result", ""))[:2000],
                            }, ensure_ascii=False, default=str),
                            user_id=agent.creator_id,
                            participant_id=agent_participant_id,
                        ))
                        await _tc_db.commit()
                except Exception as tc_err:
                    logger.debug(f"Failed to persist heartbeat tool call: {tc_err}")

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
                        session_id=str(session_id),
                        metadata={"agent_id": str(agent_id)},
                    ),
                    on_tool_call=_on_tool_call,
                    tool_executor=_build_heartbeat_tool_executor(agent_id, agent.creator_id),
                    core_tools_only=False,
                    max_tool_rounds=25,
                )
            )
            reply = result.content

            # Save assistant reply to Reflection Session
            async with async_session() as db2:
                db2.add(ChatMessage(
                    agent_id=agent_id,
                    conversation_id=str(session_id),
                    role="assistant",
                    content=reply or "",
                    user_id=agent.creator_id,
                    participant_id=agent_participant_id,
                ))
                await db2.commit()

            # Parse structured outcome from LLM reply
            outcome_type, heartbeat_score = _parse_heartbeat_outcome(reply)

            from app.services.activity_logger import log_activity
            summary = reply[:80] if reply else "empty"
            await log_activity(
                agent_id, "heartbeat",
                f"Heartbeat [{outcome_type}]: {summary}",
                detail={
                    "reply": reply[:500] if reply else "",
                    "outcome_type": outcome_type,
                    "score": heartbeat_score,
                    "session_id": str(session_id),
                },
            )

            # Update last_heartbeat_at
            async with async_session() as db3:
                a_result = await db3.execute(select(Agent).where(Agent.id == agent_id))
                a = a_result.scalar_one_or_none()
                if a:
                    a.last_heartbeat_at = datetime.now(timezone.utc)
                    await db3.commit()

            score_str = f" score={heartbeat_score}" if heartbeat_score is not None else ""
            logger.info(f"💓 Heartbeat for {agent.name}: {outcome_type}{score_str} — {summary}")

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
        # NOTE: crash is already logged to activity_log above.
        # Evolution files are NOT updated server-side to avoid double-write.


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
            synced_tenants: set[uuid.UUID] = set()
            from app.services.workspace_sync import sync_all_for_tenant
            for a in agents:
                if a.tenant_id and a.tenant_id not in synced_tenants:
                    for attempt in range(2):
                        try:
                            await sync_all_for_tenant(db, a.tenant_id)
                            synced_tenants.add(a.tenant_id)
                            break
                        except Exception as sync_err:
                            if attempt == 0:
                                logger.warning(f"Workspace sync failed for tenant {a.tenant_id}, retrying: {sync_err}")
                                await asyncio.sleep(1)
                            else:
                                logger.warning(f"Workspace sync failed for tenant {a.tenant_id} after retry: {sync_err}")

            # Pre-load tenants for timezone resolution
            tenant_ids = {a.tenant_id for a in agents if a.tenant_id}
            tenants_by_id = {}
            if tenant_ids:
                t_result = await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
                tenants_by_id = {t.id: t for t in t_result.scalars().all()}

            triggered = 0
            skipped_hours = 0
            skipped_interval = 0
            for agent in agents:
                # Resolve timezone
                tenant = tenants_by_id.get(agent.tenant_id)
                tz_name = get_agent_timezone_sync(agent, tenant)

                # Check active hours (in agent's timezone)
                if not _is_in_active_hours(agent.heartbeat_active_hours or "09:00-18:00", tz_name):
                    skipped_hours += 1
                    continue

                # Check interval
                interval = timedelta(minutes=agent.heartbeat_interval_minutes or 30)
                if agent.last_heartbeat_at and (now - agent.last_heartbeat_at) < interval:
                    skipped_interval += 1
                    continue

                # Fire heartbeat
                logger.info(f"💓 Triggering heartbeat for {agent.name}")
                await write_audit_log("heartbeat_fire", {"agent_name": agent.name}, agent_id=agent.id)
                asyncio.create_task(_execute_heartbeat(agent.id))
                triggered += 1

            logger.info(
                "[Heartbeat] tick: eligible=%d, triggered=%d, skipped_hours=%d, skipped_interval=%d",
                len(agents), triggered, skipped_hours, skipped_interval,
            )

    except Exception as e:
        logger.error(f"Heartbeat tick error: {e}", exc_info=True)
        await write_audit_log("heartbeat_error", {"error": str(e)[:300]})


async def start_heartbeat():
    """Start the background heartbeat loop. Call from FastAPI startup."""
    logger.info("💓 Agent heartbeat service started (60s tick)")
    while True:
        await _heartbeat_tick()
        await asyncio.sleep(60)
