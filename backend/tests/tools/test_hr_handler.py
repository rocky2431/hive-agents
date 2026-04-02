"""Tests for the HR tool handler — create_digital_employee registration and validation."""

from __future__ import annotations


def test_create_digital_employee_is_registered():
    """The create_digital_employee tool must be collected by the tool collector."""
    from app.services.agent_tools import get_combined_openai_tools

    all_tools = get_combined_openai_tools()
    names = [t["function"]["name"] for t in all_tools]
    assert "create_digital_employee" in names
    assert "preview_agent_blueprint" in names


def test_create_digital_employee_schema_has_required_name():
    """The tool schema must require 'name' as the only required field."""
    from app.services.agent_tools import get_combined_openai_tools

    all_tools = get_combined_openai_tools()
    hr_tool = next(t for t in all_tools if t["function"]["name"] == "create_digital_employee")
    params = hr_tool["function"]["parameters"]

    assert params["required"] == ["name"]
    assert "name" in params["properties"]
    assert "role_description" in params["properties"]
    assert "personality" in params["properties"]
    assert "boundaries" in params["properties"]
    assert "skill_names" in params["properties"]
    assert "permission_scope" in params["properties"]


def test_hr_tool_included_in_hr_tools_set():
    """_get_hr_tools should return the create_digital_employee tool."""
    from app.services.agent_tools import _get_hr_tools

    hr_tools = _get_hr_tools()
    names = [t["function"]["name"] for t in hr_tools]
    assert "create_digital_employee" in names
    assert "preview_agent_blueprint" in names
    assert "web_search" in names
    assert "firecrawl_fetch" in names
    assert "xcrawl_scrape" in names
    assert "execute_code" in names
    assert "discover_resources" in names
    assert "search_clawhub" in names
    assert len(hr_tools) == 8


def test_hr_tool_meta_has_correct_attributes():
    """The create_digital_employee tool must have correct category and adapter."""
    import importlib
    import app.tools.handlers.hr as hr_mod
    # Force re-registration in case a prior test called clear_registry()
    importlib.reload(hr_mod)

    from app.tools.decorator import get_all_registered_tools
    all_metas = get_all_registered_tools()
    meta, _fn = all_metas["create_digital_employee"]
    assert meta.governance == "sensitive"  # agent creation requires governance approval
    assert meta.category == "hr"
    assert meta.adapter == "request"

    preview_meta, _preview_fn = all_metas["preview_agent_blueprint"]
    assert preview_meta.governance == "safe"
    assert preview_meta.category == "hr"
    assert preview_meta.adapter == "request"
    assert preview_meta.read_only is True


def test_build_create_employee_result_is_structured_json():
    from app.tools.handlers.hr import _build_create_employee_result

    agent_id = "d20f09de-c0a8-4cc1-a033-0b982dd7a0a3"
    result = _build_create_employee_result(
        agent_id=agent_id,
        agent_name="Strategy Bot",
        features=["heartbeat=09:00-18:00 every 120min"],
        skills_dir="/tmp/agent/skills",
        creation_state="ready_with_warnings",
        warnings=["missing email config"],
        manual_steps=["Configure email before enabling triggers"],
    )

    assert '"status": "success"' in result
    assert f'"agent_id": "{agent_id}"' in result
    assert '"agent_name": "Strategy Bot"' in result
    assert '"creation_state": "ready_with_warnings"' in result
    assert '"warnings": ["missing email config"]' in result
    assert '"manual_steps": ["Configure email before enabling triggers"]' in result
    assert '"message": "Successfully created digital employee' in result


def test_build_blueprint_preview_payload_summarizes_ready_install_and_manual_steps():
    from app.tools.handlers.hr import _build_blueprint_preview_payload

    payload = _build_blueprint_preview_payload(
        {
            "name": "研究助理",
            "role_description": "追踪投融资与行业动态",
            "personality": "严谨\n结论先行",
            "boundaries": "不捏造来源",
            "skill_names": ["feishu-integration", "feishu-integration"],
            "mcp_server_ids": ["smithery/github", "smithery/github"],
            "clawhub_slugs": ["market-research-agent", "market-research-agent"],
            "focus_content": "先完成行业扫描",
            "heartbeat_topics": "AI\n半导体",
            "triggers": [{"name": "daily_report", "type": "cron", "config": {"expr": "0 9 * * *"}, "reason": "日报"}],
        }
    )

    assert payload["status"] == "preview"
    assert payload["blueprint"]["name"] == "研究助理"
    assert payload["blueprint"]["skill_names"] == ["feishu-integration"]
    assert payload["blueprint"]["mcp_server_ids"] == ["smithery/github"]
    assert payload["blueprint"]["clawhub_slugs"] == ["market-research-agent"]
    assert "builtin tools + 14 default skills" in payload["ready_now"]
    assert "extra skill: feishu-integration" in payload["will_install"]
    assert "mcp: smithery/github" in payload["will_install"]
    assert "clawhub skill: market-research-agent" in payload["will_install"]
    assert any("Feishu" in step for step in payload["manual_steps"])
