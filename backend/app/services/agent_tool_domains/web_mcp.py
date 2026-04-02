from __future__ import annotations

import html
from html.parser import HTMLParser
import logging
import re
import uuid
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import select

from app.database import async_session
from app.tools.result_envelope import classify_http_status, render_tool_error, render_tool_fallback

logger = logging.getLogger(__name__)


_URL_HOST_RE = re.compile(r"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/.*)?$")


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag in {"p", "div", "section", "article", "main", "h1", "h2", "h3", "li", "br"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self._parts.append(text)

    def get_text(self) -> str:
        raw = " ".join(self._parts)
        raw = html.unescape(raw)
        return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", raw)).strip()


def _looks_like_url(value: str) -> bool:
    candidate = (value or "").strip()
    if not candidate or " " in candidate:
        return False
    parsed = urlparse(candidate if "://" in candidate else f"https://{candidate}")
    return bool(parsed.netloc and "." in parsed.netloc)


def _normalize_url(value: str) -> str | None:
    candidate = (value or "").strip()
    if not _looks_like_url(candidate):
        return None
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    return candidate


def _invalid_argument_error(tool_name: str, message: str, *, provider: str, hint: str) -> str:
    return render_tool_error(
        tool_name=tool_name,
        error_class="bad_arguments",
        message=message,
        provider=provider,
        retryable=False,
        actionable_hint=hint,
    )


def _http_error(tool_name: str, *, provider: str, status_code: int, detail: str, hint: str | None = None) -> str:
    error_class, retryable = classify_http_status(status_code)
    return render_tool_error(
        tool_name=tool_name,
        error_class=error_class,
        message=f"{tool_name} failed with HTTP {status_code}: {detail[:200]}",
        provider=provider,
        http_status=status_code,
        retryable=retryable,
        actionable_hint=hint,
    )


def _extract_text_from_html(markup: str) -> str:
    parser = _HTMLTextExtractor()
    parser.feed(markup)
    return parser.get_text()


def _provider_result_failed(result: str) -> bool:
    normalized = (result or "").strip()
    return normalized.startswith("❌") or "<tool_error>" in normalized


def _provider_failure_message(result: str, engine: str) -> str:
    normalized = (result or "").strip()
    if not normalized:
        return f"web_search provider '{engine}' returned no usable content"
    first_line = normalized.splitlines()[0].strip()
    return first_line.removeprefix("❌").strip() or f"web_search provider '{engine}' failed"


async def _fallback_to_jina_search(query: str, max_results: int) -> str | None:
    api_key = await _get_jina_api_key()
    if not api_key:
        return None
    result = await _jina_search({"query": query, "max_results": max_results})
    if _provider_result_failed(result):
        return None
    return result


async def _fallback_search_result(query: str, max_results: int) -> tuple[str, str] | None:
    try:
        duckduckgo_result = await _search_duckduckgo(query, max_results)
        if not _provider_result_failed(duckduckgo_result):
            return ("web_search:duckduckgo", duckduckgo_result)
    except Exception:
        logger.debug("DuckDuckGo fallback failed", exc_info=True)

    jina_result = await _fallback_to_jina_search(query, max_results)
    if jina_result:
        return ("jina_search", jina_result)
    return None


async def _web_search(arguments: dict) -> str:
    query = arguments.get("query", "")
    if not query:
        return _invalid_argument_error(
            "web_search",
            "web_search requires a non-empty query.",
            provider="web_search",
            hint="Pass concise search keywords. If you already have a URL, use web_fetch instead.",
        )
    if _looks_like_url(query):
        return _invalid_argument_error(
            "web_search",
            "web_search expects search keywords, not a URL.",
            provider="web_search",
            hint="Use web_fetch when you already have a specific URL.",
        )

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
    fallback_note = None

    if engine in {"tavily", "google", "bing"} and not api_key:
        fallback_note = f"{engine} is configured but no API key is available, so web_search fell back to DuckDuckGo."
        engine = "duckduckgo"
    if engine == "google" and api_key and ":" not in api_key:
        fallback_note = "Google search configuration is invalid, so web_search fell back to DuckDuckGo."
        engine = "duckduckgo"

    try:
        if engine == "tavily" and api_key:
            result = await _search_tavily(query, api_key, max_results)
        elif engine == "google" and api_key:
            result = await _search_google(query, api_key, max_results, language)
        elif engine == "bing" and api_key:
            result = await _search_bing(query, api_key, max_results, language)
        else:
            result = await _search_duckduckgo(query, max_results)
        if engine != "duckduckgo" and _provider_result_failed(result):
            fallback = await _fallback_search_result(query, max_results)
            if fallback:
                fallback_tool, fallback_result = fallback
                return render_tool_fallback(
                    tool_name="web_search",
                    error_class="provider_error",
                    message=_provider_failure_message(result, engine),
                    provider=engine,
                    retryable=True,
                    actionable_hint=(
                        "The configured provider returned an unusable response, so the tool fell back to DuckDuckGo."
                        if fallback_tool == "web_search:duckduckgo"
                        else "The configured provider and DuckDuckGo were unavailable, so the tool used Jina Search as a last-resort fallback."
                    ),
                    fallback_tool=fallback_tool,
                    fallback_result=fallback_result,
                )
            return render_tool_fallback(
                tool_name="web_search",
                error_class="provider_error",
                message=_provider_failure_message(result, engine),
                provider=engine,
                retryable=True,
                actionable_hint="The configured provider returned an unusable response and no fallback provider was available.",
                fallback_tool="web_search:duckduckgo",
                fallback_result="❌ No fallback search provider was available.",
            )
        if fallback_note:
            return f"⚠️ {fallback_note}\n\n{result}"
        return result
    except Exception as e:
        if engine != "duckduckgo":
            fallback = await _fallback_search_result(query, max_results)
            if fallback:
                fallback_tool, fallback_result = fallback
                return render_tool_fallback(
                    tool_name="web_search",
                    error_class="provider_error",
                    message=f"web_search provider '{engine}' failed: {str(e)[:200]}",
                    provider=engine,
                    retryable=True,
                    actionable_hint=(
                        "The configured provider failed, so the tool fell back to DuckDuckGo."
                        if fallback_tool == "web_search:duckduckgo"
                        else "The configured provider and DuckDuckGo failed, so the tool used Jina Search as a last-resort fallback."
                    ),
                    fallback_tool=fallback_tool,
                    fallback_result=fallback_result,
                )
        else:
            jina_fallback = await _fallback_to_jina_search(query, max_results)
            if jina_fallback:
                return render_tool_fallback(
                    tool_name="web_search",
                    error_class="provider_error",
                    message=f"web_search provider '{engine}' failed: {str(e)[:200]}",
                    provider=engine,
                    retryable=True,
                    actionable_hint="DuckDuckGo failed, so the tool used Jina Search as a last-resort fallback.",
                    fallback_tool="jina_search",
                    fallback_result=jina_fallback,
                )
        if engine == "duckduckgo":
            return render_tool_error(
                tool_name="web_search",
                error_class="provider_error",
                message=f"web_search failed: {str(e)[:200]}",
                provider=engine,
                retryable=True,
                actionable_hint="Retry with a more specific query or switch to another search provider.",
            )
        return render_tool_error(
            tool_name="web_search",
            error_class="provider_error",
            message=f"web_search provider '{engine}' failed: {str(e)[:200]}",
            provider=engine,
            retryable=True,
            actionable_hint="Retry later or switch to a different search provider.",
        )


async def _search_duckduckgo(query: str, max_results: int) -> str:
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
    query = arguments.get("query", "").strip()
    if not query:
        return _invalid_argument_error(
            "jina_search",
            "jina_search requires a non-empty query.",
            provider="jina",
            hint="Pass concise search keywords. If you already have a URL, use web_fetch.",
        )
    if _looks_like_url(query):
        return _invalid_argument_error(
            "jina_search",
            "jina_search expects keywords, not a URL.",
            provider="jina",
            hint="Use web_fetch when you already have a URL.",
        )

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
                f"https://s.jina.ai/{quote(query)}",
                headers=headers,
            )

        if resp.status_code != 200:
            if resp.status_code in {401, 402, 403, 429, 500, 502, 503, 504}:
                fallback_result = await _web_search({"query": query, "max_results": max_results})
                return render_tool_fallback(
                    tool_name="jina_search",
                    error_class=classify_http_status(resp.status_code)[0],
                    message=f"jina_search failed with HTTP {resp.status_code}: {resp.text[:200]}",
                    provider="jina",
                    http_status=resp.status_code,
                    retryable=classify_http_status(resp.status_code)[1],
                    actionable_hint="Jina is unavailable or misconfigured, so the tool fell back to web_search.",
                    fallback_tool="web_search",
                    fallback_result=fallback_result,
                )
            return _http_error(
                "jina_search",
                provider="jina",
                status_code=resp.status_code,
                detail=resp.text,
                hint="Retry with a shorter query or switch to web_search.",
            )

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
        fallback_result = await _web_search({"query": query, "max_results": max_results})
        return render_tool_fallback(
            tool_name="jina_search",
            error_class="provider_error",
            message=f"jina_search failed: {str(e)[:300]}",
            provider="jina",
            retryable=True,
            actionable_hint="Jina failed unexpectedly, so the tool fell back to web_search.",
            fallback_tool="web_search",
            fallback_result=fallback_result,
        )


async def _jina_read(arguments: dict) -> str:
    url = arguments.get("url", "").strip()
    if not url:
        return _invalid_argument_error(
            "jina_read",
            "jina_read requires a URL.",
            provider="jina",
            hint="Pass a fully-qualified URL or a domain-like URL such as example.com/path.",
        )
    normalized_url = _normalize_url(url)
    if not normalized_url:
        return _invalid_argument_error(
            "jina_read",
            f"jina_read received an invalid URL: {url}",
            provider="jina",
            hint="Use a valid URL. If you only have keywords, use web_search or jina_search first.",
        )
    url = normalized_url

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
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(f"https://r.jina.ai/{quote(url, safe='')}", headers=headers)

        if resp.status_code != 200:
            if resp.status_code in {401, 402, 403, 429, 500, 502, 503, 504}:
                fallback_result = await _web_fetch({"url": url, "max_chars": max_chars})
                return render_tool_fallback(
                    tool_name="jina_read",
                    error_class=classify_http_status(resp.status_code)[0],
                    message=f"jina_read failed with HTTP {resp.status_code}: {resp.text[:200]}",
                    provider="jina",
                    http_status=resp.status_code,
                    retryable=classify_http_status(resp.status_code)[1],
                    actionable_hint="Jina Reader is unavailable or misconfigured, so the tool fell back to web_fetch.",
                    fallback_tool="web_fetch",
                    fallback_result=fallback_result,
                )
            return _http_error(
                "jina_read",
                provider="jina",
                status_code=resp.status_code,
                detail=resp.text,
                hint="Retry with a valid URL or switch to web_fetch.",
            )

        text = resp.text.strip()
        if not text or len(text) < 100:
            fallback_result = await _web_fetch({"url": url, "max_chars": max_chars})
            return render_tool_fallback(
                tool_name="jina_read",
                error_class="provider_empty",
                message=f"jina_read returned empty content for {url}",
                provider="jina",
                retryable=False,
                actionable_hint="Jina returned no usable content, so the tool fell back to web_fetch.",
                fallback_tool="web_fetch",
                fallback_result=fallback_result,
            )

        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[... truncated at {max_chars} chars]"

        return f"📄 **Content from: {url}**\n\n{text}"
    except Exception as e:
        fallback_result = await _web_fetch({"url": url, "max_chars": max_chars})
        return render_tool_fallback(
            tool_name="jina_read",
            error_class="provider_error",
            message=f"jina_read failed: {str(e)[:300]}",
            provider="jina",
            retryable=True,
            actionable_hint="Jina Reader failed unexpectedly, so the tool fell back to web_fetch.",
            fallback_tool="web_fetch",
            fallback_result=fallback_result,
        )


async def _web_fetch(arguments: dict) -> str:
    url = arguments.get("url", "").strip()
    if not url:
        return _invalid_argument_error(
            "web_fetch",
            "web_fetch requires a URL.",
            provider="web_fetch",
            hint="Pass a fully-qualified URL or a domain-like URL such as example.com/path.",
        )

    normalized_url = _normalize_url(url)
    if not normalized_url:
        return _invalid_argument_error(
            "web_fetch",
            f"web_fetch received an invalid URL: {url}",
            provider="web_fetch",
            hint="Use a valid URL. If you only have keywords, use web_search or jina_search first.",
        )

    max_chars = min(arguments.get("max_chars", 8000), 20000)

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
            resp = await client.get(normalized_url, headers={"User-Agent": "Hive WebFetch/1.0"})

        if resp.status_code != 200:
            return _http_error(
                "web_fetch",
                provider="web_fetch",
                status_code=resp.status_code,
                detail=resp.text,
                hint="Retry with another URL or fall back to search if the page is blocked.",
            )

        content_type = (resp.headers.get("content-type", "") or "").lower()
        text = resp.text.strip()
        if "html" in content_type or text.lstrip().startswith("<!doctype html") or text.lstrip().startswith("<html"):
            text = _extract_text_from_html(text)
        if not text:
            return render_tool_error(
                tool_name="web_fetch",
                error_class="empty_content",
                message=f"web_fetch returned empty content for {normalized_url}",
                provider="web_fetch",
                retryable=False,
                actionable_hint="Try another URL or use search to find a cleaner source page.",
            )
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[... truncated at {max_chars} chars]"
        return f"📄 **Fetched content from: {normalized_url}**\n\n{text}"
    except Exception as e:
        return render_tool_error(
            tool_name="web_fetch",
            error_class="provider_error",
            message=f"web_fetch failed: {str(e)[:300]}",
            provider="web_fetch",
            retryable=True,
            actionable_hint="Retry with another URL or use search to discover an alternate page.",
        )


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

    if resp.status_code != 200:
        detail = data.get("error") if isinstance(data, dict) else None
        return f"❌ Tavily search failed: HTTP {resp.status_code}: {str(detail or data)[:200]}"
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

    if resp.status_code != 200:
        error = data.get("error") if isinstance(data, dict) else None
        detail = error.get("message") if isinstance(error, dict) else error
        return f"❌ Google search failed: HTTP {resp.status_code}: {str(detail or data)[:200]}"
    if isinstance(data, dict) and data.get("error"):
        error = data["error"]
        detail = error.get("message") if isinstance(error, dict) else error
        return f"❌ Google search failed: {str(detail)[:200]}"
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

    if resp.status_code != 200:
        error = data.get("error") if isinstance(data, dict) else None
        detail = error.get("message") if isinstance(error, dict) else error
        return f"❌ Bing search failed: HTTP {resp.status_code}: {str(detail or data)[:200]}"
    if isinstance(data, dict) and data.get("error"):
        error = data["error"]
        detail = error.get("message") if isinstance(error, dict) else error
        return f"❌ Bing search failed: {str(detail)[:200]}"
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
                    return render_tool_error(
                        tool_name=tool_name,
                        error_class="provider_bad_response",
                        message=f"Smithery returned an unexpected response for {tool_name}: {raw[:300]}",
                        provider="smithery",
                        retryable=False,
                        actionable_hint="Retry later or re-authorize the MCP server connection.",
                    )

            if "error" in data:
                err = data["error"]
                msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                auth_keywords = ["auth", "unauthorized", "forbidden", "expired", "not found", "connection"]
                if any(kw in msg.lower() for kw in auth_keywords):
                    recovery_result = await _smithery_auto_recover(api_key, mcp_url, namespace, connection_id, agent_id)
                    if recovery_result:
                        return recovery_result
                return render_tool_error(
                    tool_name=tool_name,
                    error_class="provider_error",
                    message=f"MCP tool error: {msg[:300]}",
                    provider="smithery",
                    retryable=False,
                    actionable_hint="Retry after checking MCP authorization and server health.",
                )

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
        return render_tool_error(
            tool_name=tool_name,
            error_class="provider_error",
            message=f"Smithery Connect failed for {tool_name}: {str(e)[:200]}",
            provider="smithery",
            retryable=True,
            actionable_hint="Retry later or re-authorize the Smithery/MCP connection.",
        )


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
