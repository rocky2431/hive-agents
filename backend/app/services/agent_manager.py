"""Agent lifecycle manager — Docker container management for OpenClaw Gateway instances."""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import docker
from docker.errors import DockerException, NotFound
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.agent import Agent
from app.models.llm import LLMModel

settings = get_settings()


def _clean_contract_line(value: str) -> str:
    return value.strip().lstrip("-*•").strip()


def _lines_from_text(value: str | None) -> list[str]:
    if not value:
        return []
    return [line for line in (_clean_contract_line(item) for item in value.splitlines()) if line]


def _markdown_bullets(lines: list[str], fallback: list[str] | None = None) -> str:
    items = lines or (fallback or [])
    if not items:
        return "- None specified"
    return "\n".join(f"- {item}" for item in items)


def _render_agent_soul_from_blueprint(
    *,
    agent_name: str,
    role_description: str,
    creator_name: str,
    created_at: str,
    personality: str = "",
    boundaries: str = "",
    blueprint: dict | None = None,
) -> str:
    """Render a richer soul contract from blueprint-like inputs."""
    blueprint = blueprint or {}
    personality_lines = _lines_from_text(personality)
    boundary_lines = _lines_from_text(boundaries)
    focus_lines = _lines_from_text(str(blueprint.get("focus_content", "")))
    heartbeat_lines = _lines_from_text(str(blueprint.get("heartbeat_topics", "")))
    skill_names = [str(item) for item in blueprint.get("skill_names", []) if str(item).strip()]
    mcp_server_ids = [str(item) for item in blueprint.get("mcp_server_ids", []) if str(item).strip()]

    mission = role_description.strip() or "执行明确业务任务并持续维护高质量工作产出"
    operating_style = personality_lines or [
        "Work in a structured, detail-oriented way.",
        "State assumptions and risks explicitly when information is incomplete.",
        "Keep updates concise and action-oriented.",
    ]
    tool_preferences = [
        "Start with builtin tools, workspace context, and installed default skills.",
        "Use extra skills only when they clearly match the task.",
        "Escalate to MCP or marketplace installs only when builtin paths are insufficient.",
    ]
    if skill_names:
        tool_preferences.append(f"Installed extra platform skills: {', '.join(skill_names)}.")
    if mcp_server_ids:
        tool_preferences.append(f"Requested MCP extensions: {', '.join(mcp_server_ids)}.")

    parts = [
        f"# Soul — {agent_name}",
        "",
        "## Identity & Mission",
        f"- **Name**: {agent_name}",
        f"- **Role**: {mission}",
        f"- **Creator**: {creator_name}",
        f"- **Created**: {created_at}",
        "",
        "## What Good Looks Like",
        _markdown_bullets([
            f"Produce outputs that directly support this mission: {mission}.",
            "Keep artifacts, findings, and next actions explicit enough for fast review.",
            "Do not present half-configured capabilities as ready-to-use.",
        ]),
        "",
        "## Operating Style",
        _markdown_bullets(operating_style),
        "",
        "## Decision Rules",
        _markdown_bullets([
            "Prefer builtin tools and installed skills before requesting new extensions.",
            "If an external install is required, explain why the builtin path is insufficient.",
            "When blocked, state the blocker, impact, and next best action instead of improvising.",
        ]),
        "",
        "## Tool Preferences",
        _markdown_bullets(tool_preferences),
        "",
        "## Communication Contract",
        _markdown_bullets([
            "Summaries should be concise, concrete, and traceable to artifacts.",
            "Highlight warnings, missing setup, and follow-up actions explicitly.",
            "Do not claim success until the current environment has validated the path.",
        ]),
        "",
        "## Boundaries & Red Lines",
        _markdown_bullets(
            boundary_lines,
            fallback=[
                "Do not fabricate sources, facts, or completion status.",
                "Flag sensitive or external side effects before proceeding when approval is required.",
                "Treat unavailable integrations as blocked until verified.",
            ],
        ),
        "",
        "## Early Focus",
        _markdown_bullets(
            focus_lines + heartbeat_lines,
            fallback=["Review focus.md, verify installed capabilities, and deliver the first visible win."],
        ),
    ]
    return "\n".join(parts).rstrip() + "\n"


def _render_focus_from_blueprint(
    *,
    focus_content: str = "",
    heartbeat_topics: str = "",
    ready_now: list[str] | None = None,
    manual_steps: list[str] | None = None,
) -> str:
    """Render onboarding focus.md from structured creation inputs."""
    focus_lines = _lines_from_text(focus_content)
    heartbeat_lines = _lines_from_text(heartbeat_topics)
    pending_steps = manual_steps or []
    parts = [
        "# Focus",
        "",
        "## Initial Mission",
        (focus_lines[0] if focus_lines else "Understand the mission, verify capabilities, and deliver a first visible outcome."),
        "",
        "## First 3 Tasks",
        _markdown_bullets(
            focus_lines[:3],
            fallback=[
                "Read soul.md and confirm the mission and decision rules.",
                "Verify the currently available capabilities end-to-end.",
                "Produce one concrete deliverable that proves the agent is operational.",
            ],
        ),
        "",
        "## Required Capabilities Already Installed",
        _markdown_bullets(ready_now or ["builtin tools + 14 default skills"]),
        "",
        "## Capabilities Still Needing Human Setup",
        (_markdown_bullets(pending_steps) if pending_steps else "- None currently."),
        "",
        "## Heartbeat Exploration Topics",
        _markdown_bullets(
            heartbeat_lines,
            fallback=["Review recent work, refine priorities, and surface the next best opportunity."],
        ),
        "",
        "## First Success Check",
        "- Confirm the first task can be completed end-to-end using currently available capabilities.",
    ]
    return "\n".join(parts).rstrip() + "\n"


class AgentManager:
    """Manage OpenClaw Gateway Docker containers for digital employees."""

    def __init__(self):
        try:
            self.docker_client = docker.from_env()
        except DockerException:
            logger.info("Docker not available — OpenClaw containers will not be managed")
            self.docker_client = None

    def _agent_dir(self, agent_id: uuid.UUID) -> Path:
        return Path(settings.AGENT_DATA_DIR) / str(agent_id)

    def _template_dir(self) -> Path:
        return Path(settings.AGENT_TEMPLATE_DIR)

    @staticmethod
    def _uses_openclaw_container(agent: Agent) -> bool:
        return getattr(agent, "agent_type", "native") == "openclaw"

    async def initialize_agent_files(
        self,
        db: AsyncSession,
        agent: Agent,
        personality: str = "",
        boundaries: str = "",
        blueprint: dict | None = None,
    ) -> None:
        """Copy template files and customize for this agent."""
        agent_dir = self._agent_dir(agent.id)
        template_dir = self._template_dir()

        if agent_dir.exists():
            logger.warning(f"Agent dir already exists: {agent_dir}")
            return

        if template_dir.exists():
            # Copy template
            shutil.copytree(str(template_dir), str(agent_dir))
            # Ensure required dirs exist even if template was incomplete
            for d in ["memory", "memory/learnings", "skills", "evolution", "workspace"]:
                (agent_dir / d).mkdir(parents=True, exist_ok=True)
        else:
            # No template dir (local dev) — create minimal workspace structure
            logger.info(f"Template dir not found ({template_dir}), creating minimal workspace")
            agent_dir.mkdir(parents=True, exist_ok=True)
            (agent_dir / "workspace").mkdir(exist_ok=True)
            (agent_dir / "workspace" / "knowledge_base").mkdir(exist_ok=True)
            (agent_dir / "memory").mkdir(exist_ok=True)
            (agent_dir / "memory" / "learnings").mkdir(exist_ok=True)
            (agent_dir / "skills").mkdir(exist_ok=True)
            (agent_dir / "evolution").mkdir(exist_ok=True)
            (agent_dir / "tasks.json").write_text("[]", encoding="utf-8")

        # Customize soul.md
        soul_path = agent_dir / "soul.md"
        # Get creator name
        from app.models.user import User
        result = await db.execute(select(User).where(User.id == agent.creator_id))
        creator = result.scalar_one_or_none()
        creator_name = creator.display_name if creator else "Unknown"

        soul_content = _render_agent_soul_from_blueprint(
            agent_name=agent.name,
            role_description=agent.role_description or "通用助手",
            creator_name=creator_name,
            created_at=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            personality=personality,
            boundaries=boundaries,
            blueprint=blueprint,
        )
        soul_path.write_text(soul_content, encoding="utf-8")

        # Ensure memory.md exists
        mem_path = agent_dir / "memory" / "memory.md"
        if not mem_path.exists():
            mem_path.write_text("# Memory\n\n_Record important information and knowledge here._\n", encoding="utf-8")

        # Ensure HEARTBEAT.md exists — copy from central template
        hb_path = agent_dir / "HEARTBEAT.md"
        if not hb_path.exists():
            hb_template = Path(__file__).parent.parent / "templates" / "HEARTBEAT.md"
            hb_content = hb_template.read_text(encoding="utf-8") if hb_template.exists() else "# Heartbeat Instructions\n"
            hb_path.write_text(hb_content, encoding="utf-8")

        # Bootstrap evolution directory for self-evolution heartbeat engine
        from app.tools.workspace import _bootstrap_evolution_files
        _bootstrap_evolution_files(agent_dir)

        # Ensure relationships.md exists — format aligned with workspace_sync.py
        rel_path = agent_dir / "relationships.md"
        if not rel_path.exists():
            rel_lines = ["# 关系", ""]
            try:
                other_agents = await db.execute(
                    select(Agent.name, Agent.role_description).where(
                        Agent.tenant_id == agent.tenant_id,
                        Agent.id != agent.id,
                    )
                )
                peers = other_agents.all()
                if peers:
                    rel_lines.append("## 同事")
                    for name, role in peers:
                        rel_lines.append(f"- **{name}**: {role or '无描述'}")
                    rel_lines.append("")
                else:
                    rel_lines.append("_暂无关系信息。_")
            except Exception:
                rel_lines.append("_暂无关系信息。_")
            rel_path.write_text("\n".join(rel_lines), encoding="utf-8")

        if blueprint:
            focus_path = agent_dir / "focus.md"
            focus_path.write_text(
                _render_focus_from_blueprint(
                    focus_content=str(blueprint.get("focus_content", "")),
                    heartbeat_topics=str(blueprint.get("heartbeat_topics", "")),
                    ready_now=[str(item) for item in blueprint.get("ready_now", []) if str(item).strip()],
                    manual_steps=[str(item) for item in blueprint.get("manual_steps", []) if str(item).strip()],
                ),
                encoding="utf-8",
            )

        # Customize state.json
        state_path = agent_dir / "state.json"
        if state_path.exists():
            state = json.loads(state_path.read_text())
            state["agent_id"] = str(agent.id)
            state["name"] = agent.name
            state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        logger.info(f"Initialized agent files at {agent_dir}")

    def _generate_openclaw_config(self, agent: Agent, model: LLMModel | None) -> dict:
        """Generate openclaw.json config for the agent container."""
        config = {
            "agent": {
                "model": f"{model.provider}/{model.model}" if model else "anthropic/claude-sonnet-4-5",
            },
            "agents": {
                "defaults": {
                    "workspace": "/home/node/.openclaw/workspace",
                },
            },
        }

        if model and model.api_key_encrypted:
            config["env"] = {
                f"{model.provider.upper()}_API_KEY": model.api_key,
            }

        return config

    async def start_container(self, db: AsyncSession, agent: Agent) -> str | None:
        """Start an OpenClaw Gateway Docker container for the agent.

        Returns container_id or None if Docker not available.
        """
        if not self._uses_openclaw_container(agent):
            logger.info("Agent %s is native; skipping OpenClaw container start", agent.name)
            agent.status = "idle"
            agent.last_active_at = datetime.now(timezone.utc)
            return None

        if not self.docker_client:
            logger.info("Docker not available, skipping container start")
            agent.status = "idle"
            agent.last_active_at = datetime.now(timezone.utc)
            return None

        agent_dir = self._agent_dir(agent.id)

        # Get model config
        model = None
        if agent.primary_model_id:
            result = await db.execute(
                select(LLMModel).where(LLMModel.id == agent.primary_model_id, LLMModel.tenant_id == agent.tenant_id)
            )
            model = result.scalar_one_or_none()

        # Generate OpenClaw config
        config = self._generate_openclaw_config(agent, model)
        config_dir = agent_dir / ".openclaw"
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / "openclaw.json").write_text(json.dumps(config, indent=2))

        # Create workspace symlink
        workspace_dir = config_dir / "workspace"
        if not workspace_dir.exists():
            workspace_dir.symlink_to(agent_dir / "workspace")

        # Assign a unique port
        container_port = 18789 + hash(str(agent.id)) % 10000

        try:
            container = self.docker_client.containers.run(
                settings.OPENCLAW_IMAGE,
                detach=True,
                name=f"hive-agent-{str(agent.id)[:8]}",
                network=settings.DOCKER_NETWORK,
                ports={f"{settings.OPENCLAW_GATEWAY_PORT}/tcp": container_port},
                volumes={
                    str(agent_dir): {"bind": "/home/node/.openclaw", "mode": "rw"},
                },
                environment={
                    "OPENCLAW_GATEWAY_TOKEN": str(uuid.uuid4()),
                },
                restart_policy={"Name": "unless-stopped"},
                labels={
                    "hive.agent_id": str(agent.id),
                    "hive.agent_name": agent.name,
                },
            )

            agent.container_id = container.id
            agent.container_port = container_port
            agent.status = "running"
            agent.last_active_at = datetime.now(timezone.utc)

            logger.info(f"Started container {container.id[:12]} for agent {agent.name} on port {container_port}")
            return container.id

        except DockerException as e:
            logger.error(f"Failed to start container for agent {agent.name}: {e}")
            agent.status = "error"
            return None

    async def stop_container(self, agent: Agent) -> bool:
        """Stop the agent's Docker container."""
        if not self._uses_openclaw_container(agent):
            logger.info("Agent %s is native; no OpenClaw container to stop", agent.name)
            return True

        if not self.docker_client or not agent.container_id:
            agent.status = "stopped"
            return True

        try:
            container = self.docker_client.containers.get(agent.container_id)
            container.stop(timeout=10)
            agent.status = "stopped"
            logger.info(f"Stopped container {agent.container_id[:12]} for agent {agent.name}")
            return True
        except NotFound:
            agent.status = "stopped"
            agent.container_id = None
            return True
        except DockerException as e:
            logger.error(f"Failed to stop container: {e}")
            return False

    async def remove_container(self, agent: Agent) -> bool:
        """Stop and remove the agent's Docker container."""
        if not self._uses_openclaw_container(agent):
            logger.info("Agent %s is native; no OpenClaw container to remove", agent.name)
            return True

        if not self.docker_client or not agent.container_id:
            return True

        try:
            container = self.docker_client.containers.get(agent.container_id)
            container.stop(timeout=10)
            container.remove()
            agent.container_id = None
            agent.container_port = None
            logger.info(f"Removed container for agent {agent.name}")
            return True
        except NotFound:
            agent.container_id = None
            return True
        except DockerException as e:
            logger.error(f"Failed to remove container: {e}")
            return False

    async def archive_agent_files(self, agent_id: uuid.UUID) -> None:
        """Archive (move) agent files to a backup location."""
        agent_dir = self._agent_dir(agent_id)
        if agent_dir.exists():
            archive_dir = Path(settings.AGENT_DATA_DIR) / "_archived"
            archive_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            dest = archive_dir / f"{agent_id}_{timestamp}"
            shutil.move(str(agent_dir), str(dest))
            logger.info(f"Archived agent files to {dest}")

    def get_container_status(self, agent: Agent) -> dict:
        """Get real-time container status."""
        if not self.docker_client or not agent.container_id:
            return {"running": False, "status": agent.status}

        try:
            container = self.docker_client.containers.get(agent.container_id)
            return {
                "running": container.status == "running",
                "status": container.status,
                "ports": container.ports,
                "created": container.attrs.get("Created", ""),
            }
        except NotFound:
            return {"running": False, "status": "not_found"}
        except DockerException:
            return {"running": False, "status": "error"}


agent_manager = AgentManager()
