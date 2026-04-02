"""Skill tools — load skill instructions, search packs and skills."""

from __future__ import annotations

from pathlib import Path

from app.tools.decorator import ToolMeta, tool


# -- load_skill ---------------------------------------------------------------

@tool(ToolMeta(
    name="load_skill",
    description=(
        "Load the full instructions for a named skill from the skills/ directory.\n\n"
        "Usage:\n"
        "- Use this when the current task clearly matches a known skill in the catalog.\n"
        "- Load one relevant skill at a time, then follow its instructions.\n"
        "- Do NOT load a skill speculatively if the task does not clearly match it.\n"
        "- If no skill matches, use your builtin tools directly instead of guessing."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Skill name or skill path, e.g. 'web research', 'data-analysis', or 'skills/web-research/SKILL.md'",
            }
        },
        "required": ["name"],
    },
    category="skills",
    display_name="Load Skill",
    icon="\U0001f9e0",
    adapter="workspace_args",
))
def load_skill(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _load_skill
    return _load_skill(workspace, arguments.get("name", ""))


# -- tool_search --------------------------------------------------------------

@tool(ToolMeta(
    name="tool_search",
    description=(
        "Search for delayed capability packs and skills that can be activated on demand.\n\n"
        "Usage:\n"
        "- Use this when you suspect a missing capability but do not yet know the exact skill or pack name.\n"
        "- This only returns summaries and does not auto-load tools.\n"
        "- After reading the summaries, call `load_skill` or the matching activation tool explicitly."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Optional query like 'feishu', 'web research', or 'email'",
            },
        },
    },
    category="skills",
    display_name="Tool Search",
    icon="\U0001f50d",
    read_only=True,
    parallel_safe=False,
    adapter="workspace_args",
))
def tool_search(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _tool_search
    return _tool_search(workspace, arguments.get("query", ""))
