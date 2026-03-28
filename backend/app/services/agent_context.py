"""Build rich system prompt context for agents.

Loads soul, memory, skills summary, and relationships from the agent's
workspace files and composes a comprehensive system prompt.
"""

import uuid
from pathlib import Path

from loguru import logger

from app.config import get_settings
from app.skills import SkillRegistry, WorkspaceSkillLoader

settings = get_settings()

# Two workspace roots exist — tool workspace and persistent data
TOOL_WORKSPACE = Path("/tmp/hive_workspaces")
PERSISTENT_DATA = Path(settings.AGENT_DATA_DIR)


def _read_file_safe(path: Path, max_chars: int = 3000) -> str:
    """Read a file, return empty string if missing. Truncate if too long."""
    if not path.exists():
        return ""
    try:
        content = path.read_text(encoding="utf-8", errors="replace").strip()
        if len(content) > max_chars:
            content = content[:max_chars] + "\n...(truncated)"
        return content
    except Exception:
        return ""


def _parse_skill_frontmatter(content: str, filename: str) -> tuple[str, str]:
    """Parse YAML frontmatter from a skill .md file.

    Returns (name, description).
    If no frontmatter, falls back to filename-based name and first-line description.
    """
    name = filename.replace("_", " ").replace("-", " ")
    description = ""

    stripped = content.strip()
    if stripped.startswith("---"):
        end = stripped.find("---", 3)
        if end != -1:
            frontmatter = stripped[3:end].strip()
            for line in frontmatter.split("\n"):
                line = line.strip()
                if line.lower().startswith("name:"):
                    val = line[5:].strip().strip('"').strip("'")
                    if val:
                        name = val
                elif line.lower().startswith("description:"):
                    val = line[12:].strip().strip('"').strip("'")
                    if val:
                        description = val[:200]
            if description:
                return name, description

    # Fallback: use first non-empty, non-heading line as description
    for line in stripped.split("\n"):
        line = line.strip()
        # Skip frontmatter delimiters and YAML lines
        if line in ("---",) or line.startswith("name:") or line.startswith("description:"):
            continue
        if line and not line.startswith("#"):
            description = line[:200]
            break
    if not description:
        lines = stripped.split("\n")
        if lines:
            description = lines[0].strip().lstrip("# ")[:200]

    return name, description


def _load_skills_index(agent_id: uuid.UUID) -> str:
    """Load skill index (name + description) from skills/ directory.

    Supports two formats:
    - Flat file:   skills/my-skill.md
    - Folder:      skills/my-skill/SKILL.md  (Claude-style, with optional scripts/, references/)

    Uses progressive disclosure: only name+description go into the system
    prompt. The model is instructed to call read_file to load full content
    when a skill is relevant.
    """
    loader = WorkspaceSkillLoader()
    registry = SkillRegistry()

    for ws_root in [TOOL_WORKSPACE / str(agent_id), PERSISTENT_DATA / str(agent_id)]:
        registry.register_many(loader.load_from_workspace(ws_root))

    return registry.render_catalog()


async def build_agent_context(agent_id: uuid.UUID, agent_name: str, role_description: str = "", current_user_name: str = None) -> str:
    """Build a rich system prompt incorporating agent's full context.

    Reads from workspace files:
    - soul.md → personality
    - memory.md → long-term memory
    - skills/ → skill names + summaries
    - relationships.md → relationship descriptions
    """
    tool_ws = TOOL_WORKSPACE / str(agent_id)
    data_ws = PERSISTENT_DATA / str(agent_id)

    # --- Soul ---
    soul = _read_file_safe(tool_ws / "soul.md", 8000) or _read_file_safe(data_ws / "soul.md", 8000)
    # Strip markdown heading if present
    if soul.startswith("# "):
        soul = "\n".join(soul.split("\n")[1:]).strip()

    # --- Memory ---
    memory = _read_file_safe(tool_ws / "memory" / "memory.md", 2000) or _read_file_safe(tool_ws / "memory.md", 2000)
    if memory.startswith("# "):
        memory = "\n".join(memory.split("\n")[1:]).strip()

    # --- Skills index (progressive disclosure) ---
    skills_text = _load_skills_index(agent_id)

    # --- Relationships ---
    relationships = _read_file_safe(data_ws / "relationships.md", 2000)
    if relationships.startswith("# "):
        relationships = "\n".join(relationships.split("\n")[1:]).strip()

    # --- Compose system prompt ---
    from datetime import datetime, timezone as _tz
    from app.services.timezone_utils import get_agent_timezone, now_in_timezone
    agent_tz_name = await get_agent_timezone(agent_id)
    agent_local_now = now_in_timezone(agent_tz_name)
    now_str = agent_local_now.strftime(f"%Y-%m-%d %H:%M:%S ({agent_tz_name})")
    parts = [f"You are {agent_name}, an enterprise digital employee."]
    parts.append(f"\n## Current Time\n{now_str}")
    parts.append(f"Your timezone is **{agent_tz_name}**. When setting cron triggers, use this timezone for time references.")

    if role_description:
        parts.append(f"\n## Role\n{role_description}")

    # --- Channel integration skills (agent reads on demand from skills/ directory) ---
    _configured_channels = []
    try:
        from app.models.channel_config import ChannelConfig
        from app.database import async_session as _ctx_session
        from sqlalchemy import select as sa_select
        async with _ctx_session() as _ctx_db:
            _cfgs = await _ctx_db.execute(
                sa_select(ChannelConfig).where(
                    ChannelConfig.agent_id == agent_id,
                    ChannelConfig.is_configured == True,
                )
            )
            _configured_channels = [c.channel_type for c in _cfgs.scalars().all()]
    except Exception as exc:
        logger.debug("Failed to query channel configs for agent {}: {}", agent_id, exc)

    if _configured_channels:
        channel_names = ", ".join(_configured_channels)
        parts.append(f"\n## Channel Integrations\nYou have {channel_names} channel(s) configured. Read your skills/ directory for integration guides before using channel-specific tools.")

    # --- Company Intro (from system settings) ---
    try:
        from app.database import async_session
        from app.models.agent import Agent as _AgentModel
        from app.models.system_settings import SystemSetting
        from sqlalchemy import select as sa_select
        async with async_session() as db:
            # Resolve agent's tenant_id
            _ag_r = await db.execute(sa_select(_AgentModel.tenant_id).where(_AgentModel.id == agent_id))
            _agent_tenant_id = _ag_r.scalar_one_or_none()

            company_intro = ""

            # Priority 1: tenant_settings table (new)
            if _agent_tenant_id:
                try:
                    from app.models.tenant_setting import TenantSetting
                    result = await db.execute(
                        sa_select(TenantSetting).where(
                            TenantSetting.tenant_id == _agent_tenant_id,
                            TenantSetting.key == "company_intro",
                        )
                    )
                    ts = result.scalar_one_or_none()
                    if ts and ts.value and ts.value.get("content"):
                        company_intro = ts.value["content"].strip()
                except Exception as exc:
                    logger.debug("Failed to load tenant_settings company_intro for agent {}: {}", agent_id, exc)

            # Priority 2: system_settings with tenant-scoped key (backward compat)
            if not company_intro and _agent_tenant_id:
                tenant_key = f"company_intro_{_agent_tenant_id}"
                result = await db.execute(
                    sa_select(SystemSetting).where(SystemSetting.key == tenant_key)
                )
                setting = result.scalar_one_or_none()
                if setting and setting.value and setting.value.get("content"):
                    company_intro = setting.value["content"].strip()

            # Priority 3: global system_settings fallback
            if not company_intro:
                result = await db.execute(
                    sa_select(SystemSetting).where(SystemSetting.key == "company_intro")
                )
                setting = result.scalar_one_or_none()
                if setting and setting.value and setting.value.get("content"):
                    company_intro = setting.value["content"].strip()

            if company_intro:
                parts.append(f"\n## Company Information\n{company_intro}")
    except Exception as exc:
        logger.debug("Failed to load company intro for agent {}: {}", agent_id, exc)

    if soul and soul not in ("_描述你的角色和职责。_", "_Describe your role and responsibilities._"):
        parts.append(f"\n## Personality\n{soul}")

    if memory and memory not in ("_这里记录重要的信息和学到的知识。_", "_Record important information and knowledge here._"):
        parts.append(f"\n## Memory\n{memory}")

    if skills_text:
        parts.append(f"\n## Skills\n{skills_text}")

    if relationships and "暂无" not in relationships and "None yet" not in relationships:
        parts.append(f"\n## Relationships\n{relationships}")

    # --- Focus (working memory) ---
    focus = (
        _read_file_safe(tool_ws / "focus.md", 3000)
        or _read_file_safe(data_ws / "focus.md", 3000)
        # Backward compat: also check old name
        or _read_file_safe(tool_ws / "agenda.md", 3000)
        or _read_file_safe(data_ws / "agenda.md", 3000)
    )
    if focus and focus.strip() not in ("# Focus", "# Agenda", "（暂无）"):
        if focus.startswith("# "):
            focus = "\n".join(focus.split("\n")[1:]).strip()
        parts.append(f"\n## Focus\n{focus}")

    # --- Active Triggers ---
    try:
        from app.database import async_session
        from app.models.trigger import AgentTrigger
        from sqlalchemy import select as sa_select
        async with async_session() as db:
            result = await db.execute(
                sa_select(AgentTrigger).where(
                    AgentTrigger.agent_id == agent_id,
                    AgentTrigger.is_enabled == True,
                )
            )
            triggers = result.scalars().all()
            if triggers:
                lines = ["You have the following active triggers:"]
                for t in triggers:
                    config_str = str(t.config)[:80]
                    reason_str = (t.reason or "")[:500]
                    ref_str = f" (focus: {t.focus_ref})" if t.focus_ref else ""
                    lines.append(f"\n- **{t.name}** [{t.type}]{ref_str}\n  Config: `{config_str}`\n  Reason: {reason_str}")
                parts.append("\n## Active Triggers\n" + "\n".join(lines))
    except Exception as exc:
        logger.debug("Failed to load active triggers for agent {}: {}", agent_id, exc)

    parts.append("""
## Core Rules

1. **ALWAYS call tools for file operations -- NEVER pretend or fabricate results.**
2. **NEVER claim you completed an action without calling the tool.**
3. **Reply in the same language the user uses.**
4. **You have skills in your skills/ directory.** Use `load_skill` when you need specific capabilities (workspace management, trigger setup, web research, etc.).
5. **Use `write_file` to update focus.md** with your current focus items using checklist format: `- [ ] item_name: description`
6. **Write-before-reply (WAL)**: On corrections, decisions, or critical info — write to focus.md or memory/memory.md BEFORE responding.
7. **Self-improve on failure**: When operations fail or user corrects you, log to memory/learnings/ (load_skill Self-Improving Agent for format).
8. **Vet before installing**: Before installing any third-party skill, load_skill Skill Vetter and complete the security review.
9. **Messaging**: To notify a human user, use `send_web_message`. To communicate with another digital employee (agent), use `send_message_to_agent`. Never confuse the two.""")



    # Inject current user identity
    if current_user_name:
        parts.append(f"\n## Current Conversation\nYou are currently chatting with **{current_user_name}**. Address them by name when appropriate.")

    return "\n".join(parts)
