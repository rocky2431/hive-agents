"""Phase 2 bridge equivalence test.

Asserts that collected (decorator) + legacy (hardcoded) == original full set.
During migration, tools move from legacy → collected, but the union stays constant.
"""

from __future__ import annotations


def test_combined_openai_tools_equals_original():
    """get_combined_openai_tools() must contain every tool from AGENT_TOOLS."""
    from app.services.agent_tools import AGENT_TOOLS, get_combined_openai_tools

    combined = get_combined_openai_tools()
    original_names = {t["function"]["name"] for t in AGENT_TOOLS}
    combined_names = {t["function"]["name"] for t in combined}

    # Combined must be a superset of original (collected may add new tools)
    assert original_names <= combined_names, (
        f"Missing from combined: {original_names - combined_names}"
    )


def test_combined_has_no_duplicates():
    """No duplicate tool names in the combined list."""
    from app.services.agent_tools import get_combined_openai_tools

    combined = get_combined_openai_tools()
    names = [t["function"]["name"] for t in combined]
    assert len(names) == len(set(names)), f"Duplicates: {[n for n in names if names.count(n) > 1]}"


def test_governance_sets_preserved_after_init():
    """SAFE_TOOLS and SENSITIVE_TOOLS must retain all legacy entries after bridge init."""
    from app.services.agent_tools import _ensure_tool_execution_registry
    from app.tools.governance import SAFE_TOOLS, SENSITIVE_TOOLS

    _ensure_tool_execution_registry()

    assert "list_files" in SAFE_TOOLS
    assert "read_file" in SAFE_TOOLS
    assert "web_search" in SAFE_TOOLS
    assert "send_feishu_message" in SENSITIVE_TOOLS
    assert "delete_file" in SENSITIVE_TOOLS


def test_read_only_and_parallel_safe_preserved_after_init():
    """READ_ONLY and PARALLEL_SAFE sets must retain all legacy entries after bridge init."""
    from app.services.agent_tools import _ensure_tool_execution_registry
    from app.tools.registry import READ_ONLY_TOOL_NAMES, PARALLEL_SAFE_TOOL_NAMES

    _ensure_tool_execution_registry()

    assert "read_file" in READ_ONLY_TOOL_NAMES
    assert "web_search" in READ_ONLY_TOOL_NAMES
    assert "discover_resources" in READ_ONLY_TOOL_NAMES
    assert "read_file" in PARALLEL_SAFE_TOOL_NAMES
    assert "jina_search" in PARALLEL_SAFE_TOOL_NAMES
