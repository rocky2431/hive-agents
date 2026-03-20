from __future__ import annotations


def test_builtin_tool_seed_list_includes_new_kernel_primitives():
    from app.services.tool_seeder import BUILTIN_TOOLS

    names = {tool["name"] for tool in BUILTIN_TOOLS}

    assert {"edit_file", "glob_search", "grep_search", "tool_search"}.issubset(names)
