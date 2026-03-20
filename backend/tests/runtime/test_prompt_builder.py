from __future__ import annotations

from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_prompt_builder_merges_agent_context_knowledge_memory_and_suffix(monkeypatch):
    from app.runtime.context import RuntimeContext
    from app.runtime.prompt_builder import build_runtime_prompt
    from app.runtime.session import SessionContext

    agent_id = uuid4()

    async def fake_build_agent_context(_agent_id, _agent_name, _role_description, current_user_name=None):
        assert current_user_name == "Rocky"
        return "BASE_PROMPT"

    async def fake_fetch_relevant_knowledge(query, tenant_id=None):
        assert query == "latest status"
        assert tenant_id == agent_id
        return "KNOWLEDGE"

    monkeypatch.setattr("app.runtime.prompt_builder.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.prompt_builder.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)

    prompt = await build_runtime_prompt(
        agent_id=agent_id,
        agent_name="Ops Agent",
        role_description="Operations",
        messages=[
            {"role": "assistant", "content": "old"},
            {"role": "user", "content": "latest status"},
        ],
        tenant_id=agent_id,
        current_user_name="Rocky",
        memory_context="MEMORY",
        system_prompt_suffix="SUFFIX",
        runtime_context=RuntimeContext(
            session=SessionContext(session_id="s-1", source="task", channel="task"),
        ),
    )

    assert prompt == "BASE_PROMPT\n\nKNOWLEDGE\n\nMEMORY\n\nSUFFIX"


@pytest.mark.asyncio
async def test_prompt_builder_skips_empty_sections(monkeypatch):
    from app.runtime.prompt_builder import build_runtime_prompt

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    monkeypatch.setattr("app.runtime.prompt_builder.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.prompt_builder.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)

    prompt = await build_runtime_prompt(
        agent_id=None,
        agent_name="Agent",
        role_description="",
        messages=[{"role": "assistant", "content": "noop"}],
        tenant_id=None,
        current_user_name=None,
        memory_context="",
        system_prompt_suffix="",
    )

    assert prompt == "BASE"


@pytest.mark.asyncio
async def test_prompt_builder_includes_active_packs_section(monkeypatch):
    from app.runtime.context import RuntimeContext
    from app.runtime.prompt_builder import build_runtime_prompt
    from app.runtime.session import SessionContext

    async def fake_build_agent_context(*args, **kwargs):
        return "BASE"

    async def fake_fetch_relevant_knowledge(*args, **kwargs):
        return ""

    monkeypatch.setattr("app.runtime.prompt_builder.build_agent_context", fake_build_agent_context)
    monkeypatch.setattr("app.runtime.prompt_builder.fetch_relevant_knowledge", fake_fetch_relevant_knowledge)

    prompt = await build_runtime_prompt(
        agent_id=None,
        agent_name="Agent",
        role_description="",
        messages=[{"role": "assistant", "content": "noop"}],
        tenant_id=None,
        current_user_name=None,
        memory_context="",
        system_prompt_suffix="",
        runtime_context=RuntimeContext(
            session=SessionContext(
                active_packs=[{
                    "name": "web_pack",
                    "summary": "网页搜索与抓取能力",
                    "tools": ["web_search", "jina_read"],
                }]
            )
        ),
    )

    assert "## Active Capability Packs" in prompt
    assert "web_pack" in prompt
    assert "web_search, jina_read" in prompt
