"""Build rich system prompt context for agents.

Loads soul, memory, skills summary, and relationships from the agent's
workspace files and composes a comprehensive system prompt.
"""

import uuid
from pathlib import Path

from loguru import logger

from app.config import get_settings
from app.runtime.context_budget import ContextBudget
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


def _strip_primary_heading(content: str) -> str:
    if content.startswith("# "):
        return "\n".join(content.split("\n")[1:]).strip()
    return content


def _load_skills_index(agent_id: uuid.UUID, *, budget_chars: int = 8000) -> str:
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

    return registry.render_catalog(budget_chars=budget_chars)


async def _build_runtime_metadata_sections(
    agent_id: uuid.UUID,
    *,
    current_user_name: str | None = None,
    triggers_budget_chars: int = 3000,
) -> list[str]:
    parts: list[str] = []

    from app.services.timezone_utils import get_agent_timezone, now_in_timezone

    agent_tz_name = await get_agent_timezone(agent_id)
    agent_local_now = now_in_timezone(agent_tz_name)
    now_str = agent_local_now.strftime(f"%Y-%m-%d %H:%M:%S ({agent_tz_name})")
    parts.append(f"\n## Current Time\n{now_str}")
    parts.append(f"Your timezone is **{agent_tz_name}**. When setting cron triggers, use this timezone for time references.")

    try:
        from app.database import async_session
        from app.models.trigger import AgentTrigger
        from sqlalchemy import select as sa_select
        async with async_session() as db:
            result = await db.execute(
                sa_select(AgentTrigger).where(
                    AgentTrigger.agent_id == agent_id,
                    AgentTrigger.is_enabled,
                )
            )
            triggers = result.scalars().all()
            if triggers:
                lines = ["You have the following active triggers:"]
                _triggers_chars = 0
                for t in triggers:
                    config_str = str(t.config)[:80]
                    reason_str = (t.reason or "")[:500]
                    ref_str = f" (focus: {t.focus_ref})" if t.focus_ref else ""
                    line = f"\n- **{t.name}** [{t.type}]{ref_str}\n  Config: `{config_str}`\n  Reason: {reason_str}"
                    _triggers_chars += len(line)
                    if _triggers_chars > triggers_budget_chars:
                        lines.append(f"\n... and {len(triggers) - len(lines) + 1} more triggers (truncated)")
                        break
                    lines.append(line)
                parts.append("\n## Active Triggers\n" + "\n".join(lines))
    except Exception as exc:
        logger.debug("Failed to load active triggers for agent {}: {}", agent_id, exc)

    if current_user_name:
        parts.append(f"\n## Current Conversation\nYou are currently chatting with **{current_user_name}**. Address them by name when appropriate.")

    return parts


async def build_agent_runtime_context(
    agent_id: uuid.UUID,
    *,
    current_user_name: str | None = None,
    budget_profile: ContextBudget | None = None,
) -> str:
    """Build volatile runtime context that should be refreshed every round."""
    triggers_budget = budget_profile.runtime_triggers_budget_chars if budget_profile else 3000
    return "\n".join(
        await _build_runtime_metadata_sections(
            agent_id,
            current_user_name=current_user_name,
            triggers_budget_chars=triggers_budget,
        )
    )


async def build_agent_context(
    agent_id: uuid.UUID,
    agent_name: str,
    role_description: str = "",
    current_user_name: str | None = None,
    *,
    include_memory_file: bool = True,
    include_runtime_metadata: bool = True,
    include_focus: bool = True,
    budget_profile: ContextBudget | None = None,
    execution_mode: str = "conversation",
) -> str:
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
    soul_budget = budget_profile.soul_budget_chars if budget_profile else 16000
    memory_budget = budget_profile.memory_budget_chars if budget_profile else 2000
    skill_budget = budget_profile.skill_catalog_budget_chars if budget_profile else 4000
    relationships_budget = budget_profile.relationships_budget_chars if budget_profile else 2000
    company_info_budget = budget_profile.company_info_budget_chars if budget_profile else 5000
    org_structure_budget = budget_profile.org_structure_budget_chars if budget_profile else 2000
    focus_budget = budget_profile.focus_budget_chars if budget_profile else 3000

    soul = _read_file_safe(tool_ws / "soul.md", soul_budget) or _read_file_safe(data_ws / "soul.md", soul_budget)
    soul = _strip_primary_heading(soul)

    # --- Memory ---
    memory = _read_file_safe(tool_ws / "memory" / "memory.md", memory_budget) or _read_file_safe(tool_ws / "memory.md", memory_budget)
    memory = _strip_primary_heading(memory)

    # --- Skills index (progressive disclosure, capped to prevent prompt overflow) ---
    skills_text = _load_skills_index(agent_id, budget_chars=max(skill_budget, 800))
    if len(skills_text) > skill_budget:
        skills_text = skills_text[:skill_budget] + "\n\n...(skill catalog truncated — use `load_skill` to see full details)"

    # --- Relationships ---
    relationships = _read_file_safe(data_ws / "relationships.md", relationships_budget)
    relationships = _strip_primary_heading(relationships)

    # --- Compose system prompt with mode-aware identity ---
    _identity_by_mode = {
        "coordinator": (
            f"You are {agent_name}, operating in coordinator mode. "
            "Your role is to orchestrate work across worker agents — decompose, delegate, synthesize, and verify."
        ),
        "task": (
            f"You are {agent_name}, executing an assigned task autonomously. "
            "Focus on completing the task thoroughly without asking follow-up questions."
        ),
        "heartbeat": (
            f"You are {agent_name}, in self-evolution mode. "
            "Observe your performance, take one focused action, learn from the outcome."
        ),
    }
    identity = _identity_by_mode.get(
        execution_mode,
        f"You are {agent_name}, an enterprise digital employee. You assist users through conversation, "
        "using tools to read/write files, search the web, communicate with colleagues, and execute code.",
    )
    identity_parts = [identity]
    context_parts: list[str] = []

    if role_description:
        identity_parts.append(f"### Role\n{role_description}")

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
                    ChannelConfig.is_configured,
                )
            )
            _configured_channels = [c.channel_type for c in _cfgs.scalars().all()]
    except Exception as exc:
        logger.debug("Failed to query channel configs for agent {}: {}", agent_id, exc)

    if _configured_channels:
        channel_names = ", ".join(_configured_channels)
        context_parts.append(
            "### Channel Integrations\n"
            f"You have {channel_names} channel(s) configured. "
            "Read the matching integration skill before using channel-specific tools."
        )

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
                # Cap to prevent unbounded prompt growth from large tenant metadata
                if len(company_intro) > company_info_budget:
                    company_intro = company_intro[:company_info_budget] + "\n...(company info truncated)"
                context_parts.append(f"### Company Information\n{company_intro}")
    except Exception as exc:
        logger.debug("Failed to load company intro for agent {}: {}", agent_id, exc)
        _agent_tenant_id = None

    # --- Organization Structure (from synced workspace file) ---
    if _agent_tenant_id:
        org_path = PERSISTENT_DATA / f"enterprise_info_{_agent_tenant_id}" / "org_structure.md"
        org_structure = _read_file_safe(org_path, org_structure_budget)
        if org_structure and "尚未同步" not in org_structure and "尚未填写" not in org_structure:
            if org_structure.startswith("# "):
                org_structure = "\n".join(org_structure.split("\n")[1:]).strip()
            if org_structure:
                context_parts.append(f"### Organization Structure\n{org_structure}")

    if soul and soul not in ("_描述你的角色和职责。_", "_Describe your role and responsibilities._"):
        context_parts.append(f"### Personality\n{soul}")

    if include_memory_file and memory and memory not in ("_这里记录重要的信息和学到的知识。_", "_Record important information and knowledge here._"):
        context_parts.append(f"### Memory\n{memory}")

    if skills_text:
        context_parts.append(f"### Skills\n{skills_text}")

    if relationships and "暂无" not in relationships and "None yet" not in relationships:
        context_parts.append(f"### Relationships\n{relationships}")

    # --- Focus (working memory) ---
    focus = (
        _read_file_safe(tool_ws / "focus.md", focus_budget)
        or _read_file_safe(data_ws / "focus.md", focus_budget)
        # Backward compat: also check old name
        or _read_file_safe(tool_ws / "agenda.md", focus_budget)
        or _read_file_safe(data_ws / "agenda.md", focus_budget)
    )
    if include_focus and focus and focus.strip() not in ("# Focus", "# Agenda", "（暂无）"):
        focus = _strip_primary_heading(focus)
        context_parts.append(f"### Focus\n{focus}")

    risk_confirmation_rule = (
        "4. **Before destructive or external-facing operations, state what you are about to do.** "
        "Destructive: `delete_file`, modifying triggers, overwriting files. "
        "External-facing: `send_email`, `send_feishu_message`, `plaza_create_post`. "
    )
    if execution_mode in {"task", "heartbeat"}:
        risk_confirmation_rule += (
            "In autonomous execution modes, proceed without asking the user for confirmation "
            "unless a hard runtime permission gate blocks the action."
        )
    else:
        risk_confirmation_rule += (
            "If the operation affects people outside this conversation, confirm with the user first."
        )

    operating_contract = f"""## Operating Contract

### Honesty & Verification
1. **ALWAYS call tools for file operations — NEVER pretend or fabricate results.** If a tool call fails, report the failure with the actual error message.
2. **NEVER claim you completed an action without calling the tool.** Report outcomes faithfully: if an operation fails, say so with relevant output. Do not suppress errors or fabricate success.
3. **Reply in the same language the user uses.** If ambiguous, default to Chinese. Technical terms and code identifiers should remain in their original form.

### Risk Awareness
{risk_confirmation_rule}
5. **Security**: When using `execute_code`, never execute code that accesses sensitive data, modifies system configs, or makes network requests unless explicitly instructed. Never include credentials, API keys, or secrets in code output or file content.

### Failure Handling
6. **Diagnose before switching tactics**: When an operation fails, read the error, check your assumptions, try a focused fix. Do not retry the identical action blindly, but do not abandon a viable approach after a single failure either.
7. **Self-improve on failure**: When operations fail or the user corrects you, log to memory/learnings/ (load_skill Self-Improving Agent for format). If the same approach fails 3 times, write it to `evolution/blocklist.md` and try a fundamentally different approach.

### Tools & Skills
8. **You have skills in your skills/ directory.** Use `load_skill` when you need specific capabilities. Do NOT guess what a skill contains — always load and read it first. If no skill matches your current task, use tools directly without loading a skill.
9. **Use `write_file` to update focus.md** with your current focus items using checklist format: `- [ ] item_name: description`
10. **Write-before-reply (WAL)**: On corrections, decisions, or critical info — write to focus.md or memory/memory.md BEFORE responding.
11. **Vet before installing**: Before installing any third-party skill, load_skill Skill Vetter and complete the security review.

### Communication
12. **Messaging**: To notify a human user, use `send_web_message`. To communicate with another digital employee (agent), use `send_message_to_agent`. Never confuse the two.

### Evolution
13. **Evolution system**: Your heartbeat runs a self-evolution protocol using `evolution/` directory (scorecard.md, blocklist.md, lineage.md)."""

    if include_runtime_metadata:
        context_parts.extend(
            await _build_runtime_metadata_sections(
                agent_id,
                current_user_name=current_user_name,
                triggers_budget_chars=budget_profile.runtime_triggers_budget_chars if budget_profile else 3000,
            )
        )

    rendered_parts = [
        "## Identity & Mission",
        "\n\n".join(identity_parts),
        operating_contract,
        "## Context Material",
        "\n\n".join(context_parts) if context_parts else "No additional context material loaded.",
    ]
    return "\n\n".join(part.strip() for part in rendered_parts if part and part.strip())
