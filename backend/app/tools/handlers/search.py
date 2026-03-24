"""Search tools — web search, Jina search/read, resource discovery."""

from __future__ import annotations

from app.tools.decorator import ToolMeta, tool

# ── web_search ───────────────────────────────────────────────────────

@tool(ToolMeta(
    name="web_search",
    description=(
        "Search the internet via DuckDuckGo. May be unavailable on some networks. "
        "Use this as a general web search tool when you need public information and "
        "do not specifically need Jina full-page retrieval."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords",
            },
            "max_results": {
                "type": "integer",
                "description": "Number of results to return",
            },
        },
        "required": ["query"],
    },
    category="search",
    display_name="DuckDuckGo Search",
    icon="\U0001f986",
    is_default=True,
    read_only=True,
    parallel_safe=True,
    governance="safe",
    pack="web_pack",
    adapter="args_only",
    config={
        "search_engine": "duckduckgo",
        "max_results": 5,
        "language": "en",
        "api_key": "",
    },
    config_schema={
        "fields": [
            {
                "key": "search_engine",
                "label": "Search Engine",
                "type": "select",
                "options": [
                    {"value": "duckduckgo", "label": "DuckDuckGo (free, no API key)"},
                    {"value": "tavily", "label": "Tavily (AI search, needs API key)"},
                    {"value": "google", "label": "Google Custom Search (needs API key)"},
                    {"value": "bing", "label": "Bing Search API (needs API key)"},
                ],
                "default": "duckduckgo",
            },
            {
                "key": "api_key",
                "label": "API Key",
                "type": "password",
                "default": "",
                "placeholder": "Required for engines that need an API key",
                "depends_on": {"search_engine": ["tavily", "google", "bing"]},
            },
            {
                "key": "max_results",
                "label": "Default results count",
                "type": "number",
                "default": 5,
                "min": 1,
                "max": 20,
            },
            {
                "key": "language",
                "label": "Search language",
                "type": "select",
                "options": [
                    {"value": "en", "label": "English"},
                    {"value": "zh-CN", "label": "中文"},
                    {"value": "ja", "label": "日本語"},
                ],
                "default": "en",
            },
        ]
    },
))
async def web_search(arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _web_search
    return await _web_search(arguments)


# ── jina_search ──────────────────────────────────────────────────────

@tool(ToolMeta(
    name="jina_search",
    description=(
        "Search the internet using Jina AI Search (s.jina.ai). Returns high-quality "
        "search results with full page content, not just snippets. Ideal for research, "
        "news, technical docs, and any real-time information lookup."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query, e.g. 'Python asyncio best practices' or '苏州通道人工智能科技有限公司'",
            },
            "max_results": {
                "type": "integer",
                "description": "Number of results to return, default 5, max 10",
            },
        },
        "required": ["query"],
    },
    category="search",
    display_name="Jina Search",
    icon="\U0001f50e",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    pack="web_pack",
    aliases=("bing_search",),
    adapter="args_only",
    config_schema={"fields": [{"key": "api_key", "label": "Jina AI API Key", "type": "password", "default": "", "placeholder": "jina_xxx"}]},
))
async def jina_search(arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _jina_search
    return await _jina_search(arguments)


# ── jina_read ────────────────────────────────────────────────────────

@tool(ToolMeta(
    name="jina_read",
    description=(
        "Read and extract the full content from a web page URL using Jina AI Reader "
        "(r.jina.ai). Returns clean, well-structured markdown including article text, "
        "tables, and key information. Better than jina_search when you already have a "
        "specific URL to read."
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The full URL of the web page to read, e.g. 'https://example.com/article'",
            },
            "max_chars": {
                "type": "integer",
                "description": "Max characters to return (default 8000, max 20000)",
            },
        },
        "required": ["url"],
    },
    category="search",
    display_name="Jina Read",
    icon="\U0001f4d6",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    pack="web_pack",
    aliases=("read_webpage",),
    adapter="args_only",
    config_schema={"fields": [{"key": "api_key", "label": "Jina AI API Key", "type": "password", "default": "", "placeholder": "jina_xxx"}]},
))
async def jina_read(arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _jina_read
    return await _jina_read(arguments)


# ── discover_resources ───────────────────────────────────────────────

@tool(ToolMeta(
    name="discover_resources",
    description=(
        "Search public MCP registries (Smithery) for tools and capabilities that can "
        "extend your abilities. Use this when you encounter a task you cannot handle "
        "with your current tools."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Semantic description of the capability needed, e.g. 'send email', 'query SQL database', 'generate images'",
            },
            "max_results": {
                "type": "integer",
                "description": "Max results to return (default 5, max 10)",
            },
        },
        "required": ["query"],
    },
    category="mcp",
    display_name="Discover Resources",
    icon="\U0001f50d",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    pack="mcp_admin_pack",
    adapter="args_only",
))
async def discover_resources(arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _discover_resources
    return await _discover_resources(arguments)
