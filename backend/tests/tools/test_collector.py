"""Tests for the tool collector — auto-discovery and data structure building."""

from __future__ import annotations

from app.tools.decorator import ToolMeta, clear_registry, tool
from app.tools.collector import collect_tools


def setup_function():
    clear_registry()


def _register_sample_tools():
    """Register a few sample tools for testing."""

    @tool(ToolMeta(
        name="web_search",
        description="Search the web",
        parameters={"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
        category="search",
        display_name="Web Search",
        icon="\U0001f50d",
        read_only=True,
        parallel_safe=True,
        governance="safe",
        pack="web_pack",
        adapter="args_only",
    ))
    async def web_search(arguments: dict) -> str:
        return f"results for {arguments['q']}"

    @tool(ToolMeta(
        name="write_file",
        description="Write a file",
        parameters={"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}},
        category="file",
        display_name="Write File",
        governance="sensitive",
        adapter="workspace_args",
    ))
    async def write_file(workspace, arguments, tenant_id=None) -> str:
        return "written"

    @tool(ToolMeta(
        name="jina_search",
        description="Search via Jina",
        parameters={"type": "object", "properties": {"q": {"type": "string"}}},
        category="search",
        display_name="Jina Search",
        read_only=True,
        parallel_safe=True,
        governance="safe",
        pack="web_pack",
        aliases=("bing_search",),
        adapter="args_only",
    ))
    async def jina_search(arguments: dict) -> str:
        return "jina results"


def test_collect_builds_openai_tools():
    _register_sample_tools()
    collected = collect_tools()

    names = {t["function"]["name"] for t in collected.openai_tools}
    assert "web_search" in names
    assert "write_file" in names
    assert "jina_search" in names
    # Aliases should NOT appear as separate OpenAI tools
    assert "bing_search" not in names


def test_collect_builds_seed_list():
    _register_sample_tools()
    collected = collect_tools()

    seed_names = {s["name"] for s in collected.seed_list}
    assert "web_search" in seed_names
    assert seed_names == {"web_search", "write_file", "jina_search"}

    web_seed = next(s for s in collected.seed_list if s["name"] == "web_search")
    assert web_seed["display_name"] == "Web Search"
    assert web_seed["category"] == "search"
    assert web_seed["icon"] == "\U0001f50d"
    assert web_seed["parameters_schema"] == {
        "type": "object",
        "properties": {"q": {"type": "string"}},
        "required": ["q"],
    }


def test_collect_builds_governance_sets():
    _register_sample_tools()
    collected = collect_tools()

    assert "web_search" in collected.safe_tools
    assert "jina_search" in collected.safe_tools
    assert "bing_search" in collected.safe_tools  # alias inherits governance
    assert "write_file" in collected.sensitive_tools
    assert "write_file" not in collected.safe_tools


def test_collect_builds_read_only_and_parallel_safe():
    _register_sample_tools()
    collected = collect_tools()

    assert "web_search" in collected.read_only_names
    assert "jina_search" in collected.read_only_names
    assert "write_file" not in collected.read_only_names

    assert "web_search" in collected.parallel_safe_names
    assert "write_file" not in collected.parallel_safe_names


def test_collect_builds_pack_groups():
    _register_sample_tools()
    collected = collect_tools()

    assert "web_pack" in collected.pack_tool_groups
    assert set(collected.pack_tool_groups["web_pack"]) == {"web_search", "jina_search"}
    # write_file has no pack
    assert "write_file" not in [t for tools in collected.pack_tool_groups.values() for t in tools]


def test_collect_registers_executors():
    _register_sample_tools()
    collected = collect_tools()

    # Canonical names registered
    assert collected.exec_registry._executors.get("web_search") is not None
    assert collected.exec_registry._executors.get("jina_search") is not None
    assert collected.exec_registry._executors.get("write_file") is not None
    # Alias registered
    assert collected.exec_registry._executors.get("bing_search") is not None


def test_collect_empty_registry():
    collected = collect_tools()
    assert collected.openai_tools == []
    assert collected.seed_list == []
    assert collected.safe_tools == frozenset()
    assert collected.pack_tool_groups == {}
