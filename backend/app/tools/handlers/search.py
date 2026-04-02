"""Search tools — web search, Jina search/read, resource discovery."""

from __future__ import annotations

from app.tools.decorator import ToolMeta, tool

# ── web_search ───────────────────────────────────────────────────────

@tool(ToolMeta(
    name="web_search",
    description=(
        "Search the internet via DuckDuckGo for public information.\n\n"
        "Usage:\n"
        "- Use specific, well-formed search queries — not full sentences. Good: 'Python pandas groupby multiple columns'. Bad: 'How do I group by multiple columns in pandas?'\n"
        "- Results include titles, URLs, and snippets. To read full page content, follow up with `jina_read`.\n"
        "- May be unavailable on some networks. If search fails, try `jina_search` as an alternative.\n"
        "- Do NOT search for information already available in your workspace files or loaded skills."
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
        "Search the internet using Jina AI Search (s.jina.ai).\n\n"
        "Usage:\n"
        "- Use this for research, news, technical docs, and other real-time lookups when you need richer results than standard search snippets.\n"
        "- Use focused search queries instead of full questions.\n"
        "- Results may already include substantial content; follow up with `jina_read` only for the specific pages you need in full.\n"
        "- Do NOT use when you already have a specific URL — call `jina_read` directly.\n"
        "- Do NOT use for information already available in your workspace or loaded skills."
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
        "Read and extract the full content from a web page URL using Jina AI Reader (r.jina.ai).\n\n"
        "Usage:\n"
        "- Use this when you already have a specific URL and need the full article or page content.\n"
        "- Prefer this after `web_search` or `jina_search` identifies the right page.\n"
        "- The output is clean markdown with article text, tables, and key information.\n"
        "- If the page is too long, set `max_chars` and read only what you need first.\n"
        "- Do NOT use this as a search tool; if you do not have a URL yet, search first."
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
        "Search public MCP registries (Smithery + ModelScope) for tools and capabilities that can extend your abilities.\n\n"
        "Usage:\n"
        "- Use this when your current toolset cannot perform the required operation.\n"
        "- Describe the capability you need, not a vendor name unless that vendor is required.\n"
        "- Review discovered capabilities before importing them into your runtime.\n"
        "- Do NOT use this if an existing builtin tool, loaded skill, or active pack already solves the task."
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
    config={"smithery_api_key": "", "modelscope_api_token": ""},
    config_schema={"fields": [
        {"key": "smithery_api_key", "label": "Smithery API Key", "type": "password", "default": "", "placeholder": "从 smithery.ai/account/api-keys 获取"},
        {"key": "modelscope_api_token", "label": "ModelScope API Token", "type": "password", "default": "", "placeholder": "从 modelscope.cn 获取"},
    ]},
))
async def discover_resources(arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _discover_resources
    return await _discover_resources(arguments)


# ── search_clawhub ──────────────────────────────────────────────────

@tool(ToolMeta(
    name="search_clawhub",
    description=(
        "Search the ClawHub skill marketplace for agent skills.\n\n"
        "Usage:\n"
        "- Return skill slugs that can be passed to `create_digital_employee(clawhub_slugs=[...])`.\n"
        "- Use this when hiring a new agent and you need installable marketplace skills.\n"
        "- Search with concise domain keywords rather than long natural-language requests.\n"
        "- Do NOT use this for local workspace skills — inspect the local skill catalog instead."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords in English, e.g. 'market research', 'web3 crypto', 'competitor analysis'",
            },
        },
        "required": ["query"],
    },
    category="search",
    display_name="Search ClawHub",
    icon="\U0001f3aa",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    adapter="args_only",
))
async def search_clawhub(arguments: dict) -> str:
    import httpx

    query = arguments.get("query", "").strip()
    if not query:
        return "❌ Please provide search keywords"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://clawhub.ai/api/search",
                params={"q": query},
            )
            if resp.status_code != 200:
                return f"❌ ClawHub search failed: HTTP {resp.status_code}"
            data = resp.json()

        results = data.get("results", [])
        if not results:
            return f'🔍 No ClawHub skills found for "{query}"'

        lines = [f'🔍 ClawHub skills for "{query}" ({len(results)} results):\n']
        for r in results[:8]:
            slug = r.get("slug", "?")
            name = r.get("displayName", slug)
            summary = r.get("summary", "")[:100]
            lines.append(f"**{name}** (slug: `{slug}`)\n{summary}\n")

        lines.append("\n💡 Pass the `slug` values to `create_digital_employee(clawhub_slugs=[...])` to install.")
        return "\n".join(lines)
    except Exception as e:
        return f"❌ ClawHub search error: {str(e)[:200]}"
