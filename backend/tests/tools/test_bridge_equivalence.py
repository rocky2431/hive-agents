"""Tool surface equivalence and metadata propagation tests."""

from __future__ import annotations


def test_combined_openai_tools_matches_canonical_surface():
    """The collected tool surface should expose the canonical builtin tool set."""
    from app.services.agent_tools import get_combined_openai_tools

    combined = get_combined_openai_tools()
    combined_names = {t["function"]["name"] for t in combined}

    assert combined_names == {
        "cancel_trigger",
        "create_digital_employee",
        "delete_file",
        "discover_resources",
        "edit_file",
        "execute_code",
        "feishu_calendar_create",
        "feishu_calendar_delete",
        "feishu_calendar_list",
        "feishu_calendar_update",
        "feishu_doc_append",
        "feishu_doc_create",
        "feishu_doc_read",
        "feishu_doc_share",
        "feishu_user_search",
        "feishu_wiki_list",
        "glob_search",
        "grep_search",
        "import_mcp_server",
        "list_mcp_resources",
        "read_mcp_resource",
        "jina_read",
        "jina_search",
        "list_files",
        "list_triggers",
        "load_skill",
        "plaza_add_comment",
        "plaza_create_post",
        "plaza_get_new_posts",
        "read_document",
        "read_emails",
        "read_file",
        "reply_email",
        "search_clawhub",
        "send_channel_file",
        "send_email",
        "send_feishu_message",
        "send_message_to_agent",
        "send_web_message",
        "set_trigger",
        "tool_search",
        "update_trigger",
        "upload_image",
        "web_search",
        "write_file",
    }


def test_combined_has_no_duplicates():
    """No duplicate tool names in the combined list."""
    from app.services.agent_tools import get_combined_openai_tools

    combined = get_combined_openai_tools()
    names = [t["function"]["name"] for t in combined]
    assert len(names) == len(set(names)), f"Duplicates: {[n for n in names if names.count(n) > 1]}"
    assert "web_search" in names


def test_governance_sets_include_canonical_metadata_without_runtime_init():
    """SAFE_TOOLS and SENSITIVE_TOOLS should reflect the canonical tool metadata."""
    from app.tools.governance import SAFE_TOOLS, SENSITIVE_TOOLS

    assert "list_files" in SAFE_TOOLS
    assert "read_file" in SAFE_TOOLS
    assert "web_search" in SAFE_TOOLS
    assert "send_feishu_message" in SENSITIVE_TOOLS
    assert "delete_file" in SENSITIVE_TOOLS
    assert "create_digital_employee" in SENSITIVE_TOOLS


def test_read_only_and_parallel_safe_sets_include_canonical_metadata_without_runtime_init():
    """READ_ONLY and PARALLEL_SAFE metadata should be available without runtime init."""
    from app.tools.registry import READ_ONLY_TOOL_NAMES, PARALLEL_SAFE_TOOL_NAMES

    assert "read_file" in READ_ONLY_TOOL_NAMES
    assert "web_search" in READ_ONLY_TOOL_NAMES
    assert "discover_resources" in READ_ONLY_TOOL_NAMES
    assert "read_file" in PARALLEL_SAFE_TOOL_NAMES
    assert "jina_search" in PARALLEL_SAFE_TOOL_NAMES


def test_alias_metadata_available_without_runtime_registry_init():
    """Alias read-only/parallel-safe metadata should not depend on runtime init side effects."""
    from app.tools.registry import is_parallel_safe_tool, is_read_only_tool

    assert is_parallel_safe_tool("bing_search")
    assert is_read_only_tool("read_webpage")
