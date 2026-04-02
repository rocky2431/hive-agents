from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: self._value or [])


class _FakeSession:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _query):
        if not self._execute_values:
            return _FakeScalarResult(None)
        return _FakeScalarResult(self._execute_values.pop(0))


@pytest.mark.asyncio
async def test_agent_context_exposes_identity_contract_and_context_layers(monkeypatch, tmp_path):
    from app.services.agent_context import build_agent_context

    agent_id = uuid4()
    sessions = [_FakeSession([[]]), _FakeSession([None])]

    monkeypatch.setattr("app.database.async_session", lambda: sessions.pop(0))
    monkeypatch.setattr("app.services.agent_context.TOOL_WORKSPACE", tmp_path)
    monkeypatch.setattr("app.services.agent_context.PERSISTENT_DATA", tmp_path)
    monkeypatch.setattr("app.services.agent_context._load_skills_index", lambda *_args, **_kwargs: "")

    prompt = await build_agent_context(
        agent_id,
        "Ops Agent",
        role_description="Keep systems healthy",
        include_runtime_metadata=False,
        include_focus=False,
        execution_mode="conversation",
    )

    assert "## Identity & Mission" in prompt
    assert "## Operating Contract" in prompt
    assert "## Context Material" in prompt
    assert prompt.index("## Identity & Mission") < prompt.index("## Operating Contract") < prompt.index("## Context Material")


def test_task_execution_addendum_defines_reporting_protocol() -> None:
    from app.services.task_executor import TASK_EXECUTION_ADDENDUM

    assert "### Final Report Format" in TASK_EXECUTION_ADDENDUM
    assert "Outcome:" in TASK_EXECUTION_ADDENDUM
    assert "Evidence:" in TASK_EXECUTION_ADDENDUM
    assert "Blockers:" in TASK_EXECUTION_ADDENDUM


def test_a2a_prompt_defines_status_and_result_contract() -> None:
    from app.services.agent_tool_domains.messaging import A2A_SYSTEM_PROMPT_SUFFIX

    assert "If you are still working" in A2A_SYSTEM_PROMPT_SUFFIX
    assert "If you completed the request" in A2A_SYSTEM_PROMPT_SUFFIX
    assert "file path" in A2A_SYSTEM_PROMPT_SUFFIX
    assert "Do NOT delegate" in A2A_SYSTEM_PROMPT_SUFFIX


def test_core_tool_descriptions_define_when_not_to_use_and_fallbacks() -> None:
    from app.services.agent_tools import get_combined_openai_tools

    tools = {tool["function"]["name"]: tool["function"]["description"] for tool in get_combined_openai_tools()}

    assert "Do NOT use this for long-running delegated work" in tools["send_message_to_agent"]
    assert "check back later with `check_async_task`" in tools["delegate_to_agent"]
    assert "follow up with `web_fetch`" in tools["web_search"]
    assert "Do NOT use when you already have a specific URL" in tools["jina_search"]
    assert "call `web_fetch` directly" in tools["jina_search"]
    assert "If the page is too long" in tools["jina_read"]
    assert "Prefer this after `web_search` identifies the right page" in tools["web_fetch"]
    assert "If you need to wait for a reply later, pair the message with an `on_message` trigger" in tools["send_feishu_message"]
    assert "Do NOT use this for agent-to-agent collaboration" in tools["send_web_message"]
    assert "Describe the capability you need, not a vendor name" in tools["discover_resources"]
    assert "Only use this after builtin tools, loaded skills, and direct web/file tools still cannot complete the task" in tools["discover_resources"]
    assert "Use this to schedule future work" in tools["set_trigger"]
    assert "Do NOT create a trigger without a clear reason" in tools["set_trigger"]
    assert "Do NOT load a skill speculatively" in tools["load_skill"]
    assert "This only returns summaries" in tools["tool_search"]
    assert "Do NOT use this as a general way to browse admin-only MCP extensions" in tools["tool_search"]
    assert "Return skill slugs" in tools["search_clawhub"]


def test_skill_catalog_footer_discourages_speculative_loading() -> None:
    from app.skills.registry import SkillRegistry
    from app.skills.types import ParsedSkill, SkillMetadata

    registry = SkillRegistry()
    registry.register(
        ParsedSkill(
            metadata=SkillMetadata(name="Writing", description="Draft polished content"),
            body="# Writing",
            file_path=Path("skills/Writing.md"),
            relative_path="skills/Writing.md",
        )
    )

    rendered = registry.render_catalog()

    assert "Load only the skill that matches the current task" in rendered
    assert "Do NOT speculatively load multiple skills" in rendered


def test_summarizer_prompt_distinguishes_session_state_from_durable_memory() -> None:
    from app.services.conversation_summarizer import _SUMMARIZE_SYSTEM_PROMPT

    assert "Session summaries preserve working state" in _SUMMARIZE_SYSTEM_PROMPT
    assert "Do NOT rewrite this summary as long-term memory or policy" in _SUMMARIZE_SYSTEM_PROMPT
    assert "Stable preferences, lessons, and policies can be extracted later" in _SUMMARIZE_SYSTEM_PROMPT


def test_memory_extraction_prompt_distinguishes_facts_and_policy_layers() -> None:
    from app.services.memory_service import (
        _MEMORY_EXTRACTION_SYSTEM_PROMPT,
        _build_memory_extraction_prompt,
    )

    prompt = _build_memory_extraction_prompt("user: remember this")

    assert "long-term memory facts" in _MEMORY_EXTRACTION_SYSTEM_PROMPT
    assert "Do NOT extract transient session state" in _MEMORY_EXTRACTION_SYSTEM_PROMPT
    assert "Store durable reusable facts here" in _MEMORY_EXTRACTION_SYSTEM_PROMPT
    assert "Session text:" in prompt
    assert "policy-level evolution" in prompt


def test_auto_dream_prompt_distinguishes_memory_from_evolution_policy() -> None:
    from app.services.auto_dream import (
        _AUTO_DREAM_SYSTEM_PROMPT,
        _build_dream_consolidation_prompt,
    )

    prompt = _build_dream_consolidation_prompt(
        facts=[{"content": "Use A", "category": "strategy"}],
        summaries=["summary text"],
    )

    assert "deduplicated fact list" in _AUTO_DREAM_SYSTEM_PROMPT
    assert "Do NOT preserve transient task state" in _AUTO_DREAM_SYSTEM_PROMPT
    assert "Promote durable successful approaches to strategy" in prompt
    assert "Promote repeated failed approaches to blocked_pattern" in prompt
    assert "evolution files remain the home for active policy iteration" in prompt
