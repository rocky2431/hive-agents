from __future__ import annotations


def test_render_agent_soul_from_blueprint_includes_operating_contract_sections() -> None:
    from app.services.agent_manager import _render_agent_soul_from_blueprint

    soul = _render_agent_soul_from_blueprint(
        agent_name="研究助理",
        role_description="追踪市场与融资动态",
        creator_name="Rocky",
        created_at="2026-04-02",
        personality="严谨\n结论先行",
        boundaries="不捏造来源\n敏感操作先说明风险",
        blueprint={
            "skill_names": ["feishu-integration"],
            "mcp_server_ids": ["smithery/github"],
            "focus_content": "优先建立日报流程",
            "heartbeat_topics": "AI\n半导体",
        },
    )

    assert "## Identity & Mission" in soul
    assert "## What Good Looks Like" in soul
    assert "## Operating Style" in soul
    assert "## Tool Preferences" in soul
    assert "## Boundaries & Red Lines" in soul
    assert "## Early Focus" in soul
    assert "严谨" in soul
    assert "feishu-integration" in soul
    assert "smithery/github" in soul


def test_render_focus_from_blueprint_includes_ready_and_manual_sections() -> None:
    from app.services.agent_manager import _render_focus_from_blueprint

    focus = _render_focus_from_blueprint(
        focus_content="1. 建日报\n2. 补关键词",
        heartbeat_topics="AI\n半导体",
        ready_now=["builtin tools + 14 default skills"],
        manual_steps=["完成 Feishu CLI 或渠道认证"],
    )

    assert "# Focus" in focus
    assert "## Initial Mission" in focus
    assert "## First 3 Tasks" in focus
    assert "## Required Capabilities Already Installed" in focus
    assert "## Capabilities Still Needing Human Setup" in focus
    assert "## Heartbeat Exploration Topics" in focus
    assert "## First Success Check" in focus
    assert "完成 Feishu CLI 或渠道认证" in focus
