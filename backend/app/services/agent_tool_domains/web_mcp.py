from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from app.database import async_session

logger = logging.getLogger(__name__)


async def _web_search(arguments: dict) -> str:
    query = arguments.get("query", "")
    if not query:
        return "❌ Please provide search keywords"

    config = {}
    try:
        from app.models.tool import Tool

        async with async_session() as db:
            r = await db.execute(select(Tool).where(Tool.name == "web_search"))
            tool = r.scalar_one_or_none()
            if tool and tool.config:
                config = tool.config
    except Exception as e:
        logger.debug("web_search config load failed: %s", e)

    engine = config.get("search_engine", "duckduckgo")
    api_key = config.get("api_key", "")
    max_results = min(arguments.get("max_results", config.get("max_results", 5)), 10)
    language = config.get("language", "zh-CN")

    try:
        if engine == "tavily" and api_key:
            return await _search_tavily(query, api_key, max_results)
        if engine == "google" and api_key:
            return await _search_google(query, api_key, max_results, language)
        if engine == "bing" and api_key:
            return await _search_bing(query, api_key, max_results, language)
        return await _search_duckduckgo(query, max_results)
    except Exception as e:
        return f"❌ Search error ({engine}): {str(e)[:200]}"


async def _search_duckduckgo(query: str, max_results: int) -> str:
    import httpx
    import re

    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
            timeout=10,
        )

    results = []
    blocks = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?'
        r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
        resp.text,
        re.DOTALL,
    )
    for url, title, snippet in blocks[:max_results]:
        title = re.sub(r"<[^>]+>", "", title).strip()
        snippet = re.sub(r"<[^>]+>", "", snippet).strip()
        if "uddg=" in url:
            from urllib.parse import parse_qs, unquote, urlparse

            parsed = parse_qs(urlparse(url).query)
            url = unquote(parsed.get("uddg", [url])[0])
        results.append(f"**{title}**\n{url}\n{snippet}")

    if not results:
        return f'🔍 No results found for "{query}"'
    return f'🔍 DuckDuckGo results for "{query}" ({len(results)} items):\n\n' + "\n\n---\n\n".join(results)


async def _get_jina_api_key() -> str:
    try:
        from app.models.system_settings import SystemSetting

        async with async_session() as db:
            result = await db.execute(select(SystemSetting).where(SystemSetting.key == "jina_api_key"))
            setting = result.scalar_one_or_none()
            if setting and setting.value.get("api_key"):
                return setting.value["api_key"]
    except Exception as e:
        logger.debug("Suppressed: %s", e)
    from app.config import get_settings

    return get_settings().JINA_API_KEY


async def _jina_search(arguments: dict) -> str:
    import httpx

    query = arguments.get("query", "").strip()
    if not query:
        return "❌ Please provide search keywords"

    max_results = min(arguments.get("max_results", 5), 10)
    api_key = await _get_jina_api_key()

    headers: dict = {
        "Accept": "application/json",
        "X-Respond-With": "no-content",
        "X-Return-Format": "markdown",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(
                f"https://s.jina.ai/{__import__('urllib.parse', fromlist=['quote']).quote(query)}",
                headers=headers,
            )

        if resp.status_code != 200:
            return f"❌ Jina Search error HTTP {resp.status_code}: {resp.text[:200]}"

        data = resp.json()
        items = data.get("data", [])[:max_results]
        if not items:
            return f'🔍 No results found for "{query}"'

        parts = []
        for i, item in enumerate(items, 1):
            title = item.get("title", "Untitled")
            url = item.get("url", "")
            description = item.get("description", "") or item.get("content", "")[:500]
            parts.append(f"**{i}. {title}**\n{url}\n{description}")

        return f'🔍 Jina Search results for "{query}" ({len(items)} items):\n\n' + "\n\n---\n\n".join(parts)
    except Exception as e:
        return f"❌ Jina Search error: {str(e)[:300]}"


async def _jina_read(arguments: dict) -> str:
    import httpx

    url = arguments.get("url", "").strip()
    if not url:
        return "❌ Please provide a URL"
    if not url.startswith("http"):
        url = "https://" + url

    max_chars = min(arguments.get("max_chars", 8000), 20000)
    api_key = await _get_jina_api_key()

    headers: dict = {
        "Accept": "text/plain, text/markdown, */*",
        "X-Return-Format": "markdown",
        "X-Remove-Selector": "header, footer, nav, aside, .ads, .advertisement",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        from urllib.parse import quote

        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(f"https://r.jina.ai/{quote(url, safe='')}", headers=headers)

        if resp.status_code != 200:
            return f"❌ Jina Reader error HTTP {resp.status_code}: {resp.text[:200]}"

        text = resp.text.strip()
        if not text or len(text) < 100:
            return f"❌ Jina Reader returned empty content for {url}"

        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[... truncated at {max_chars} chars]"

        return f"📄 **Content from: {url}**\n\n{text}"
    except Exception as e:
        return f"❌ Jina Reader error: {str(e)[:300]}"


async def _search_tavily(query: str, api_key: str, max_results: int) -> str:
    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={"query": query, "max_results": max_results, "search_depth": "basic"},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=15,
        )
        data = resp.json()

    if "results" not in data:
        return f"❌ Tavily search failed: {data.get('error', str(data)[:200])}"

    results = [
        f"**{r.get('title', '')}**\n{r.get('url', '')}\n{r.get('content', '')[:200]}"
        for r in data["results"][:max_results]
    ]
    if not results:
        return f'🔍 No results found for "{query}"'
    return f'🔍 Tavily search for "{query}" ({len(results)} items):\n\n' + "\n\n---\n\n".join(results)


async def _search_google(query: str, api_key: str, max_results: int, language: str) -> str:
    import httpx

    parts = api_key.split(":", 1)
    if len(parts) != 2:
        return "❌ Google search requires API key in format 'API_KEY:SEARCH_ENGINE_ID'"

    gapi_key, cx = parts
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": gapi_key, "cx": cx, "q": query, "num": max_results, "lr": f"lang_{language[:2]}"},
            timeout=10,
        )
        data = resp.json()

    results = [
        f"**{item.get('title', '')}**\n{item.get('link', '')}\n{item.get('snippet', '')}"
        for item in data.get("items", [])[:max_results]
    ]
    if not results:
        return f'🔍 No results found for "{query}"'
    return f'🔍 Google search for "{query}" ({len(results)} items):\n\n' + "\n\n---\n\n".join(results)


async def _search_bing(query: str, api_key: str, max_results: int, language: str) -> str:
    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.bing.microsoft.com/v7.0/search",
            params={"q": query, "count": max_results, "mkt": language},
            headers={"Ocp-Apim-Subscription-Key": api_key},
            timeout=10,
        )
        data = resp.json()

    results = [
        f"**{item.get('name', '')}**\n{item.get('url', '')}\n{item.get('snippet', '')}"
        for item in data.get("webPages", {}).get("value", [])[:max_results]
    ]
    if not results:
        return f'🔍 No results found for "{query}"'
    return f'🔍 Bing search for "{query}" ({len(results)} items):\n\n' + "\n\n---\n\n".join(results)


async def _execute_mcp_tool(tool_name: str, arguments: dict, agent_id=None) -> str:
    try:
        from app.models.tool import AgentTool, Tool
        from app.services.mcp_client import MCPClient

        async with async_session() as db:
            result = await db.execute(select(Tool).where(Tool.name == tool_name, Tool.type == "mcp"))
            tool = result.scalar_one_or_none()
            agent_config = {}
            if tool and agent_id:
                at_r = await db.execute(
                    select(AgentTool).where(AgentTool.agent_id == agent_id, AgentTool.tool_id == tool.id)
                )
                at = at_r.scalar_one_or_none()
                agent_config = (at.config or {}) if at else {}

        if not tool:
            return f"Unknown tool: {tool_name}"
        if not tool.mcp_server_url:
            return f"❌ MCP tool {tool_name} has no server URL configured"

        merged_config = {**(tool.config or {}), **agent_config}
        mcp_url = tool.mcp_server_url
        mcp_name = tool.mcp_tool_name or tool_name

        if ".run.tools" in mcp_url and merged_config:
            return await _execute_via_smithery_connect(mcp_url, mcp_name, arguments, merged_config, agent_id=agent_id)

        direct_api_key = merged_config.get("api_key") or merged_config.get("atlassian_api_key")
        if not direct_api_key and tool.mcp_server_name == "Atlassian Rovo":
            try:
                from app.api.atlassian import get_atlassian_api_key_for_agent

                direct_api_key = await get_atlassian_api_key_for_agent(agent_id)
            except Exception as e:
                logger.debug("Suppressed: %s", e)
        client = MCPClient(mcp_url, api_key=direct_api_key)
        return await client.call_tool(mcp_name, arguments)
    except Exception as e:
        return f"❌ MCP tool execution error: {str(e)[:200]}"


async def _execute_via_smithery_connect(
    mcp_url: str,
    tool_name: str,
    arguments: dict,
    config: dict,
    agent_id=None,
) -> str:
    import httpx
    import json as json_mod

    from app.services.resource_discovery import _get_smithery_api_key

    api_key = await _get_smithery_api_key(agent_id)
    if not api_key:
        return (
            "❌ Smithery API key not configured.\n\n"
            "请提供你的 Smithery API Key，你可以通过以下步骤获取：\n"
            "1. 注册/登录 https://smithery.ai\n"
            "2. 前往 https://smithery.ai/account/api-keys 创建 API Key\n"
            "3. 将 Key 提供给我，我会帮你配置"
        )

    namespace = config.pop("smithery_namespace", None)
    connection_id = config.pop("smithery_connection_id", None)

    if not namespace or not connection_id:
        try:
            from app.models.tool import Tool

            async with async_session() as db:
                r = await db.execute(select(Tool).where(Tool.name == "discover_resources"))
                disc_tool = r.scalar_one_or_none()
                if disc_tool and disc_tool.config:
                    namespace = namespace or disc_tool.config.get("smithery_namespace")
                    connection_id = connection_id or disc_tool.config.get("smithery_connection_id")
        except Exception as e:
            logger.debug("Suppressed: %s", e)

    if not namespace or not connection_id:
        return (
            "❌ Smithery Connect namespace/connection not configured. "
            "Please set smithery_namespace and smithery_connection_id in the tool configuration."
        )

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            tool_resp = await client.post(
                f"https://api.smithery.ai/connect/{namespace}/{connection_id}/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": tool_name, "arguments": arguments},
                },
                headers=headers,
            )

            if tool_resp.status_code in (401, 403, 404):
                recovery_result = await _smithery_auto_recover(api_key, mcp_url, namespace, connection_id, agent_id)
                if recovery_result:
                    return recovery_result

            raw = tool_resp.text
            data = None
            for line in raw.split("\n"):
                line = line.strip()
                if line.startswith("data: "):
                    try:
                        data = json_mod.loads(line[6:])
                        break
                    except json_mod.JSONDecodeError:
                        pass

            if data is None:
                try:
                    data = json_mod.loads(raw)
                except json_mod.JSONDecodeError:
                    return f"❌ Unexpected response from Smithery: {raw[:300]}"

            if "error" in data:
                err = data["error"]
                msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                auth_keywords = ["auth", "unauthorized", "forbidden", "expired", "not found", "connection"]
                if any(kw in msg.lower() for kw in auth_keywords):
                    recovery_result = await _smithery_auto_recover(api_key, mcp_url, namespace, connection_id, agent_id)
                    if recovery_result:
                        return recovery_result
                return f"❌ MCP tool error: {msg[:300]}"

            result = data.get("result", {})
            if isinstance(result, str):
                return result

            content_blocks = result.get("content", []) if isinstance(result, dict) else []
            texts = []
            for block in content_blocks:
                if isinstance(block, str):
                    texts.append(block)
                elif isinstance(block, dict):
                    if block.get("type") == "text":
                        texts.append(block.get("text", ""))
                    elif block.get("type") == "image":
                        texts.append(f"[Image: {block.get('mimeType', 'image')}]")
                    else:
                        texts.append(str(block))
                else:
                    texts.append(str(block))
            return "\n".join(texts) if texts else str(result)
    except Exception as e:
        return f"❌ Smithery Connect error: {str(e)[:200]}"


async def _smithery_auto_recover(api_key: str, mcp_url: str, namespace: str, connection_id: str, agent_id=None) -> str | None:
    try:
        from app.models.tool import AgentTool, Tool
        from app.services.resource_discovery import _ensure_smithery_connection

        display_name = connection_id.replace("-", " ").title() if connection_id else "MCP Server"
        conn_result = await _ensure_smithery_connection(api_key, mcp_url, display_name)
        if "error" in conn_result:
            return (
                f"❌ MCP tool connection expired and auto-recovery failed: {conn_result['error']}\n\n"
                "💡 Please re-authorize by telling me: `import_mcp_server(server_id=\"...\", reauthorize=true)`"
            )

        new_config = {
            "smithery_namespace": conn_result["namespace"],
            "smithery_connection_id": conn_result["connection_id"],
        }
        if agent_id:
            try:
                async with async_session() as db:
                    r = await db.execute(select(Tool).where(Tool.mcp_server_url == mcp_url, Tool.type == "mcp"))
                    for tool in r.scalars().all():
                        at_r = await db.execute(
                            select(AgentTool).where(AgentTool.agent_id == agent_id, AgentTool.tool_id == tool.id)
                        )
                        at = at_r.scalar_one_or_none()
                        if at:
                            at.config = {**(at.config or {}), **new_config}
                    await db.commit()
            except Exception as e:
                logger.debug("Suppressed: %s", e)

        if conn_result.get("auth_url"):
            return (
                "🔐 MCP tool connection expired. Re-authorization needed.\n\n"
                "Please visit the following URL to re-authorize:\n"
                f"{conn_result['auth_url']}\n\n"
                "After completing authorization, the tools will work again automatically."
            )
        return None
    except Exception as e:
        return f"❌ Auto-recovery failed: {str(e)[:200]}"


async def _discover_resources(arguments: dict) -> str:
    query = arguments.get("query", "")
    if not query:
        return "❌ Please provide a search query describing the capability you need."
    max_results = min(arguments.get("max_results", 5), 10)

    from app.services.resource_discovery import search_smithery

    return await search_smithery(query, max_results)


async def _import_mcp_server(agent_id: uuid.UUID, arguments: dict) -> str:
    config = arguments.get("config") or {}
    reauthorize = arguments.get("reauthorize", False)
    mcp_url = config.pop("mcp_url", None) if isinstance(config, dict) else None

    if mcp_url:
        from app.services.resource_discovery import import_mcp_direct

        server_name = arguments.get("server_id") or config.pop("server_name", None)
        api_key = config.pop("api_key", None)
        return await import_mcp_direct(mcp_url, agent_id, server_name, api_key)

    server_id = arguments.get("server_id", "")
    if not server_id:
        return "❌ Please provide a server_id (e.g. 'github'). Use discover_resources first to find available servers."

    from app.services.resource_discovery import import_mcp_from_smithery

    return await import_mcp_from_smithery(server_id, agent_id, config or None, reauthorize=reauthorize)
