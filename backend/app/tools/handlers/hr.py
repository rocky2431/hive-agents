"""HR tools — create digital employees through conversational guidance."""

from __future__ import annotations

import logging
import uuid

from app.tools.decorator import ToolMeta, tool
from app.tools.runtime import ToolExecutionRequest

logger = logging.getLogger(__name__)


@tool(ToolMeta(
    name="create_digital_employee",
    description=(
        "Create a new digital employee with the given configuration. "
        "Use this ONLY after confirming the full plan with the user. "
        "Includes heartbeat schedule and custom heartbeat instructions. "
        "Returns the new employee's name and ID on success."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name for the new digital employee (2-100 characters)",
            },
            "role_description": {
                "type": "string",
                "description": "What this employee does — their core job responsibilities",
            },
            "personality": {
                "type": "string",
                "description": "Personality traits, one per line",
            },
            "boundaries": {
                "type": "string",
                "description": "Behavioral boundaries, one per line",
            },
            "skill_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "EXTRA skill folder_names beyond defaults (e.g. ['feishu-integration', 'dingtalk-integration']). 14 default skills are auto-installed — only list non-default ones here.",
            },
            "mcp_server_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Smithery MCP server IDs to install (e.g. ['LinkupPlatform/linkup-mcp-server']). Found via discover_resources.",
            },
            "clawhub_slugs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "ClawHub skill slugs to install (e.g. ['market-research-agent', 'competitor-analyst']). Found via web_search on clawhub.ai.",
            },
            "permission_scope": {
                "type": "string",
                "enum": ["company", "self"],
                "description": "'company' (everyone) or 'self' (creator only). Default: 'company'.",
            },
            "heartbeat_enabled": {
                "type": "boolean",
                "description": "Enable heartbeat (self-evolution cycle: observe performance, act on priorities, learn from outcomes). Default: true.",
            },
            "heartbeat_interval_minutes": {
                "type": "integer",
                "description": "Heartbeat interval in minutes. Default: 120.",
            },
            "heartbeat_active_hours": {
                "type": "string",
                "description": "Heartbeat active hours (e.g. '09:00-18:00'). Default: '09:00-18:00'.",
            },
            "triggers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Trigger name (e.g. 'daily_news_report')"},
                        "type": {"type": "string", "enum": ["cron", "interval"], "description": "cron or interval"},
                        "config": {"type": "object", "description": "For cron: {\"expr\": \"0 9 * * *\"}. For interval: {\"minutes\": 30}"},
                        "reason": {"type": "string", "description": "What the agent should do when triggered (the instruction)"},
                    },
                    "required": ["name", "type", "config", "reason"],
                },
                "description": "Scheduled tasks. Use cron for fixed times, interval for recurring.",
            },
            "welcome_message": {
                "type": "string",
                "description": "Greeting shown when someone first chats with this agent. Should introduce the agent's role and capabilities.",
            },
            "focus_content": {
                "type": "string",
                "description": "Initial focus.md content — what should the agent work on first? Written as a task list or agenda in markdown.",
            },
            "heartbeat_topics": {
                "type": "string",
                "description": "Role-specific exploration topics, written to focus.md as initial directions. E.g. 'Focus on AI/VC funding news, semiconductor breakthroughs, and founder movements.'",
            },
        },
        "required": ["name"],
    },
    category="hr",
    display_name="Create Digital Employee",
    icon="\U0001f464",
    governance="",
    adapter="request",
))
async def create_digital_employee(request: ToolExecutionRequest) -> str:
    args = request.arguments
    user_id = request.context.user_id
    tenant_id = request.context.tenant_id

    name = (args.get("name") or "").strip()
    if not name or len(name) < 2:
        return "Error: name is required and must be at least 2 characters."
    if len(name) > 100:
        return "Error: name must be 100 characters or less."

    role_description = args.get("role_description", "")
    personality = args.get("personality", "")
    boundaries = args.get("boundaries", "")

    # LLM often passes arrays as JSON strings — parse all array params defensively
    def _parse_list(val) -> list:
        if isinstance(val, list):
            return val
        if isinstance(val, str):
            val = val.strip()
            if val.startswith("["):
                try:
                    import json as _j
                    parsed = _j.loads(val)
                    if isinstance(parsed, list):
                        return parsed
                except (ValueError, TypeError):
                    logger.debug("[HR] Failed to parse JSON string array: %s", val[:50])
        return []

    skill_names = [s for s in _parse_list(args.get("skill_names")) if isinstance(s, str)]
    mcp_server_ids = [s for s in _parse_list(args.get("mcp_server_ids")) if isinstance(s, str)]
    clawhub_slugs = [s for s in _parse_list(args.get("clawhub_slugs")) if isinstance(s, str) and s.strip()]
    permission_scope = args.get("permission_scope", "company")

    # Heartbeat config (self-awareness cycle) — LLM may pass strings for numeric fields
    heartbeat_enabled = args.get("heartbeat_enabled", True)
    try:
        heartbeat_interval = int(args.get("heartbeat_interval_minutes", 120))
    except (ValueError, TypeError):
        heartbeat_interval = 120
    raw_hours = str(args.get("heartbeat_active_hours", "09:00-18:00"))
    # Normalize common LLM responses: "24/7" → "00:00-23:59", strip whitespace
    if "24" in raw_hours and "7" in raw_hours:
        heartbeat_active_hours = "00:00-23:59"
    elif "-" in raw_hours and ":" in raw_hours:
        heartbeat_active_hours = raw_hours.strip()
    else:
        heartbeat_active_hours = "09:00-18:00"
    # Triggers (scheduled tasks) — LLM may pass string or malformed data
    raw_triggers = args.get("triggers") or []
    if isinstance(raw_triggers, str):
        try:
            import json as _json
            raw_triggers = _json.loads(raw_triggers)
        except (ValueError, TypeError):
            raw_triggers = []
    triggers = [t for t in raw_triggers if isinstance(t, dict)]
    # New customization params
    welcome_message = args.get("welcome_message", "")
    focus_content = args.get("focus_content", "")
    heartbeat_topics = args.get("heartbeat_topics", "")

    from sqlalchemy import select

    from app.database import async_session
    from app.models.agent import Agent, AgentPermission
    from app.models.participant import Participant
    from app.models.skill import Skill
    from app.models.user import User
    from app.services.agent_manager import agent_manager

    try:
        async with async_session() as db:
            # Look up the calling user
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if not user:
                return "Error: could not identify the requesting user."

            effective_tenant_id = uuid.UUID(tenant_id) if tenant_id else user.tenant_id

            # Resolve default model for this tenant (TenantSetting → fallback to first enabled)
            primary_model_id = None
            from app.models.llm import LLMModel
            from app.models.tenant_setting import TenantSetting
            ts_r = await db.execute(
                select(TenantSetting.value).where(
                    TenantSetting.tenant_id == effective_tenant_id,
                    TenantSetting.key == "default_model_id",
                )
            )
            ts_val = ts_r.scalar_one_or_none()
            if isinstance(ts_val, dict) and ts_val.get("model_id"):
                primary_model_id = uuid.UUID(ts_val["model_id"])
            if not primary_model_id:
                model_result = await db.execute(
                    select(LLMModel)
                    .where(LLMModel.tenant_id == effective_tenant_id, LLMModel.enabled.is_(True))
                    .order_by(LLMModel.created_at)
                    .limit(1)
                )
                default_model = model_result.scalar_one_or_none()
                if default_model:
                    primary_model_id = default_model.id

            # Resolve tenant defaults
            default_max_triggers = 20
            default_min_poll = 5
            default_webhook_rate = 5
            if effective_tenant_id:
                from app.models.tenant import Tenant
                tenant_result = await db.execute(select(Tenant).where(Tenant.id == effective_tenant_id))
                tenant_obj = tenant_result.scalar_one_or_none()
                if tenant_obj:
                    default_max_triggers = tenant_obj.default_max_triggers or 20
                    default_min_poll = tenant_obj.min_poll_interval_floor or 5
                    default_webhook_rate = tenant_obj.max_webhook_rate_ceiling or 5

            # Create the agent — set last_heartbeat_at to now so the first
            # heartbeat fires after a full interval, giving MCP/workspace init time.
            from datetime import datetime as _dt, timezone as _tz
            agent = Agent(
                name=name,
                role_description=role_description,
                welcome_message=welcome_message or None,
                creator_id=user.id,
                owner_user_id=user.id,
                tenant_id=effective_tenant_id,
                agent_type="native",
                agent_class="internal_tenant",
                security_zone="standard",
                primary_model_id=primary_model_id,
                status="creating",
                max_triggers=default_max_triggers,
                min_poll_interval_min=default_min_poll,
                webhook_rate_limit=default_webhook_rate,
                heartbeat_enabled=heartbeat_enabled,
                heartbeat_interval_minutes=heartbeat_interval,
                heartbeat_active_hours=heartbeat_active_hours,
                last_heartbeat_at=_dt.now(_tz.utc),
            )
            db.add(agent)
            await db.flush()

            # Participant identity
            db.add(Participant(
                type="agent", ref_id=agent.id,
                display_name=agent.name, avatar_url=None,
            ))
            await db.flush()

            # Permissions
            if permission_scope == "self":
                db.add(AgentPermission(
                    agent_id=agent.id, scope_type="user",
                    scope_id=user.id, access_level="manage",
                ))
            else:
                db.add(AgentPermission(
                    agent_id=agent.id, scope_type="company",
                    access_level="use",
                ))
            await db.flush()

            # Assign default platform tools
            from app.services.tool_seeder import assign_default_tools_to_agent
            await assign_default_tools_to_agent(db, agent.id)
            await db.flush()

            # Initialize agent file system (standard template)
            await agent_manager.initialize_agent_files(
                db, agent,
                personality=personality,
                boundaries=boundaries,
            )

            agent_dir = agent_manager._agent_dir(agent.id)

            # Write focus.md (initial working agenda + exploration topics)
            focus_parts = ["# Focus\n"]
            if focus_content:
                focus_parts.append(focus_content)
            if heartbeat_topics:
                focus_parts.append(f"\n## Exploration Directions\n{heartbeat_topics}")
            if len(focus_parts) > 1:
                (agent_dir / "focus.md").write_text("\n".join(focus_parts), encoding="utf-8")

            # Create triggers (scheduled tasks)
            if triggers:
                from app.models.trigger import AgentTrigger
                for trig in triggers:
                    raw_config = trig.get("config", {})
                    trig_type = trig.get("type", "cron")
                    # LLM may pass config as cron string instead of {"expr": "..."}
                    if isinstance(raw_config, str):
                        raw_config = {"expr": raw_config}
                    elif isinstance(raw_config, dict) and "expr" not in raw_config and "minutes" not in raw_config:
                        # Try to find cron-like value in the dict
                        for v in raw_config.values():
                            if isinstance(v, str) and v.count(" ") >= 3:
                                raw_config = {"expr": v}
                                break
                    # Infer cron expr from trigger name if LLM omitted it
                    if trig_type == "cron" and not raw_config.get("expr"):
                        trig_name = (trig.get("name") or "").lower()
                        inferred = None
                        if "every_2h" in trig_name or "2h" in trig_name:
                            inferred = "0 */2 * * *"
                        elif "every_4h" in trig_name or "4h" in trig_name:
                            inferred = "0 */4 * * *"
                        elif "hourly" in trig_name or "every_hour" in trig_name:
                            inferred = "0 * * * *"
                        elif "weekly" in trig_name:
                            inferred = "0 9 * * 1"
                        elif "daily" in trig_name:
                            inferred = "0 9 * * *"
                        if inferred:
                            raw_config = {"expr": inferred}
                            logger.info("Inferred cron expr '%s' for trigger '%s' from name", inferred, trig_name)
                        else:
                            logger.warning("Skipping cron trigger '%s' — no expr in config and cannot infer", trig.get("name"))
                            continue
                    db.add(AgentTrigger(
                        agent_id=agent.id,
                        name=trig.get("name", "task"),
                        type=trig_type,
                        config=raw_config,
                        reason=trig.get("reason", ""),
                    ))
                await db.flush()

            # Copy default skills + requested skills
            from sqlalchemy.orm import selectinload

            default_skill_result = await db.execute(
                select(Skill).where(Skill.is_default).options(selectinload(Skill.files))
            )
            all_skills_to_copy: list[Skill] = list(default_skill_result.scalars().all())

            if skill_names:
                from sqlalchemy import or_
                for sname in skill_names:
                    sr = await db.execute(
                        select(Skill)
                        .where(
                            Skill.folder_name == sname,
                            or_(
                                Skill.tenant_id == effective_tenant_id,
                                Skill.tenant_id.is_(None),
                            ),
                        )
                        .options(selectinload(Skill.files))
                    )
                    skill = sr.scalar_one_or_none()
                    if skill and skill not in all_skills_to_copy:
                        all_skills_to_copy.append(skill)

            skills_dir = agent_dir / "skills"
            skills_dir.mkdir(parents=True, exist_ok=True)

            for skill in all_skills_to_copy:
                skill_folder = skills_dir / skill.folder_name
                skill_folder.mkdir(parents=True, exist_ok=True)
                for sf in skill.files:
                    file_path = skill_folder / sf.path
                    file_path.parent.mkdir(parents=True, exist_ok=True)
                    file_path.write_text(sf.content)

            # Start container
            await agent_manager.start_container(db, agent)
            await db.flush()

            # Audit
            try:
                from app.core.policy import write_audit_event
                await write_audit_event(
                    db, event_type="agent.created", severity="info",
                    actor_type="user", actor_id=user.id,
                    tenant_id=effective_tenant_id or user.tenant_id or uuid.UUID(int=0),
                    action="create_agent", resource_type="agent", resource_id=agent.id,
                    details={"name": agent.name, "created_via": "hr_agent"},
                )
            except Exception:
                logger.warning("Audit write failed for hr agent.created", exc_info=True)

            await db.commit()

            # Install MCP servers (after commit, so agent exists in DB)
            logger.info(f"[HR] Post-commit install phase: mcp={mcp_server_ids}, clawhub={clawhub_slugs}")
            mcp_results = []
            if mcp_server_ids:
                from app.services.resource_discovery import import_mcp_from_smithery, _get_smithery_api_key
                # Pre-fetch API key from global config (not from the new agent which has empty config)
                _smithery_key = await _get_smithery_api_key(None)
                for server_id in mcp_server_ids:
                    try:
                        _mcp_config = {"smithery_api_key": _smithery_key} if _smithery_key else None
                        result = await import_mcp_from_smithery(server_id, agent.id, config=_mcp_config)
                        if isinstance(result, str) and "❌" in result:
                            mcp_results.append(f"⚠️ {server_id}: {result[:100]}")
                            logger.warning(f"[HR] MCP install rejected for {server_id}: {result[:100]}")
                        elif isinstance(result, dict) and result.get("error"):
                            mcp_results.append(f"⚠️ {server_id}: {result['error'][:100]}")
                            logger.warning(f"[HR] MCP install error for {server_id}: {result['error'][:100]}")
                        else:
                            mcp_results.append(f"✅ {server_id}")
                            logger.info(f"[HR] Installed MCP {server_id} for agent {agent.id}")
                    except Exception as mcp_err:
                        mcp_results.append(f"⚠️ {server_id}: {mcp_err}")
                        logger.warning(f"[HR] MCP install failed for {server_id}: {mcp_err}")

            # Install ClawHub skills (after commit, so agent exists on disk)
            logger.info(f"[HR] ClawHub install phase: {len(clawhub_slugs)} slugs to install: {clawhub_slugs}")
            clawhub_results = []
            if clawhub_slugs:
                import httpx
                from pathlib import Path as _Path
                from app.api.skills import CLAWHUB_BASE, _fetch_github_directory, _get_github_token
                from app.config import get_settings as _get_settings

                agent_dir = _Path(_get_settings().AGENT_DATA_DIR) / str(agent.id)
                ch_tenant = str(effective_tenant_id) if effective_tenant_id else None
                ch_token = await _get_github_token(ch_tenant)
                for slug in clawhub_slugs:
                    try:
                        async with httpx.AsyncClient(timeout=15) as client:
                            resp = await client.get(f"{CLAWHUB_BASE}/v1/skills/{slug}")
                            if resp.status_code == 429:
                                import asyncio as _asyncio
                                await _asyncio.sleep(2)
                                resp = await client.get(f"{CLAWHUB_BASE}/v1/skills/{slug}")
                            if resp.status_code != 200:
                                clawhub_results.append(f"⚠️ {slug}: ClawHub HTTP {resp.status_code}")
                                logger.warning(f"[HR] ClawHub API returned {resp.status_code} for {slug}")
                                continue
                            try:
                                meta = resp.json()
                            except Exception:
                                clawhub_results.append(f"⚠️ {slug}: invalid ClawHub response")
                                continue
                        handle = meta.get("owner", {}).get("handle", "").lower()
                        if not handle:
                            clawhub_results.append(f"⚠️ {slug}: no owner handle")
                            continue
                        github_path = f"skills/{handle}/{slug}"
                        files = await _fetch_github_directory("openclaw", "skills", github_path, "main", ch_token)
                        skill_dir = agent_dir / "skills" / slug
                        skill_dir.mkdir(parents=True, exist_ok=True)
                        for f in files:
                            fp = (skill_dir / f["path"]).resolve()
                            if not str(fp).startswith(str(agent_dir.resolve())):
                                continue
                            fp.parent.mkdir(parents=True, exist_ok=True)
                            fp.write_text(f["content"], encoding="utf-8")
                        clawhub_results.append(f"✅ {slug}")
                        logger.info(f"[HR] Installed ClawHub skill {slug} for agent {agent.id}")
                    except Exception as ch_err:
                        clawhub_results.append(f"⚠️ {slug}: {ch_err}")
                        logger.warning(f"[HR] ClawHub install failed for {slug}: {ch_err}")

            # Build response
            features = [f"name='{agent.name}'"]
            if heartbeat_enabled:
                features.append(f"heartbeat={heartbeat_active_hours} every {heartbeat_interval}min")
            if triggers:
                trigger_names = [t.get("name", "?") for t in triggers]
                features.append(f"triggers={trigger_names}")
            if skill_names:
                features.append(f"extra_skills={skill_names}")
            if mcp_results:
                features.append(f"mcp={mcp_results}")
            if clawhub_results:
                features.append(f"clawhub={clawhub_results}")

            return (
                f"Successfully created digital employee '{agent.name}' (ID: {agent.id}). "
                f"Config: {', '.join(features)}. "
                f"14 default skills auto-installed. "
                f"Skills directory: {agent_dir / 'skills'}. "
                f"The employee is now being initialized and will be ready shortly."
            )

    except Exception as e:
        logger.error(f"[HR] create_digital_employee failed: {e}", exc_info=True)
        return "Error: failed to create the digital employee. Please try again or contact support."
