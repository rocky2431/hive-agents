from __future__ import annotations

import json
from types import SimpleNamespace

import pytest


def _extract_tool_error_payload(result: str) -> dict:
    marker = "<tool_error>"
    end_marker = "</tool_error>"
    start = result.index(marker) + len(marker)
    end = result.index(end_marker)
    return json.loads(result[start:end])


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, text: str = "", json_data: dict | None = None, headers: dict | None = None):
        self.status_code = status_code
        self.text = text
        self._json_data = json_data or {}
        self.headers = headers or {}

    def json(self) -> dict:
        return self._json_data


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def get(self, *args, **kwargs):
        return self._response

    async def post(self, *args, **kwargs):
        return self._response


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, value):
        self._value = value

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _query):
        return _ScalarResult(self._value)


@pytest.mark.asyncio
async def test_jina_search_falls_back_to_web_search_on_billing_error(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    async def fake_get_jina_api_key() -> str:
        return "jina_key"

    monkeypatch.setattr(web_mcp, "_get_jina_api_key", fake_get_jina_api_key)

    async def fake_web_search(arguments: dict) -> str:
        assert arguments["query"] == "openai news"
        return "fallback search results"

    monkeypatch.setattr(web_mcp, "_web_search", fake_web_search)
    monkeypatch.setattr(
        "httpx.AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse(status_code=402, text="Payment Required"),
        ),
    )

    result = await web_mcp._jina_search({"query": "openai news"})

    assert "fallback search results" in result
    payload = _extract_tool_error_payload(result)
    assert payload["error_class"] == "quota_or_billing"
    assert payload["http_status"] == 402
    assert payload["provider"] == "jina"


@pytest.mark.asyncio
async def test_jina_read_rejects_non_url_input():
    from app.services.agent_tool_domains import web_mcp

    result = await web_mcp._jina_read({"url": "not a valid url"})

    payload = _extract_tool_error_payload(result)
    assert payload["error_class"] == "bad_arguments"
    assert payload["provider"] == "jina"


@pytest.mark.asyncio
async def test_web_fetch_extracts_html_content(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    html = "<html><head><title>Demo</title></head><body><main><h1>Hello</h1><p>World</p></main></body></html>"
    monkeypatch.setattr(
        "httpx.AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse(status_code=200, text=html, headers={"content-type": "text/html"}),
        ),
    )

    result = await web_mcp._web_fetch({"url": "https://example.com", "max_chars": 1000})

    assert "Hello" in result
    assert "World" in result
    assert "<tool_error>" not in result


@pytest.mark.asyncio
async def test_web_search_falls_back_to_duckduckgo_when_provider_returns_error_string(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    tool = SimpleNamespace(config={"search_engine": "tavily", "api_key": "tvly-key", "max_results": 5, "language": "en"})
    monkeypatch.setattr(web_mcp, "async_session", lambda: _FakeSession(tool))

    async def fake_tavily(query: str, api_key: str, max_results: int) -> str:
        assert query == "openai sdk"
        assert api_key == "tvly-key"
        assert max_results == 5
        return "❌ Tavily search failed: upstream 400"

    async def fake_duckduckgo(query: str, max_results: int) -> str:
        assert query == "openai sdk"
        assert max_results == 5
        return "duckduckgo fallback results"

    monkeypatch.setattr(web_mcp, "_search_tavily", fake_tavily)
    monkeypatch.setattr(web_mcp, "_search_duckduckgo", fake_duckduckgo)

    result = await web_mcp._web_search({"query": "openai sdk"})

    assert "duckduckgo fallback results" in result
    payload = _extract_tool_error_payload(result)
    assert payload["provider"] == "tavily"
    assert payload["fallback_tool"] == "web_search:duckduckgo"


@pytest.mark.asyncio
async def test_web_search_falls_back_to_jina_when_duckduckgo_fails(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    tool = SimpleNamespace(config={"search_engine": "duckduckgo", "max_results": 5, "language": "en"})
    monkeypatch.setattr(web_mcp, "async_session", lambda: _FakeSession(tool))

    async def fake_get_jina_api_key() -> str:
        return "jina-key"

    async def fake_duckduckgo(query: str, max_results: int) -> str:
        assert query == "python asyncio"
        raise RuntimeError("duckduckgo blocked")

    async def fake_jina_search(arguments: dict) -> str:
        assert arguments == {"query": "python asyncio", "max_results": 5}
        return "jina fallback results"

    monkeypatch.setattr(web_mcp, "_get_jina_api_key", fake_get_jina_api_key)
    monkeypatch.setattr(web_mcp, "_search_duckduckgo", fake_duckduckgo)
    monkeypatch.setattr(web_mcp, "_jina_search", fake_jina_search)

    result = await web_mcp._web_search({"query": "python asyncio", "max_results": 5})

    assert "jina fallback results" in result
    payload = _extract_tool_error_payload(result)
    assert payload["provider"] == "duckduckgo"
    assert payload["fallback_tool"] == "jina_search"


@pytest.mark.asyncio
async def test_web_search_falls_back_to_jina_when_primary_and_duckduckgo_both_fail(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    tool = SimpleNamespace(config={"search_engine": "tavily", "api_key": "tvly-key", "max_results": 5, "language": "en"})
    monkeypatch.setattr(web_mcp, "async_session", lambda: _FakeSession(tool))

    async def fake_get_jina_api_key() -> str:
        return "jina-key"

    async def fake_tavily(query: str, api_key: str, max_results: int) -> str:
        raise RuntimeError("tavily down")

    async def fake_duckduckgo(query: str, max_results: int) -> str:
        raise RuntimeError("duckduckgo blocked")

    async def fake_jina_search(arguments: dict) -> str:
        return "jina tertiary fallback results"

    monkeypatch.setattr(web_mcp, "_get_jina_api_key", fake_get_jina_api_key)
    monkeypatch.setattr(web_mcp, "_search_tavily", fake_tavily)
    monkeypatch.setattr(web_mcp, "_search_duckduckgo", fake_duckduckgo)
    monkeypatch.setattr(web_mcp, "_jina_search", fake_jina_search)

    result = await web_mcp._web_search({"query": "python asyncio", "max_results": 5})

    assert "jina tertiary fallback results" in result
    payload = _extract_tool_error_payload(result)
    assert payload["provider"] == "tavily"
    assert payload["fallback_tool"] == "jina_search"


@pytest.mark.asyncio
async def test_web_search_falls_back_when_google_returns_auth_error(monkeypatch):
    from app.services.agent_tool_domains import web_mcp

    tool = SimpleNamespace(config={"search_engine": "google", "api_key": "key:cx", "max_results": 5, "language": "en"})
    monkeypatch.setattr(web_mcp, "async_session", lambda: _FakeSession(tool))

    async def fake_duckduckgo(query: str, max_results: int) -> str:
        assert query == "cloud deploy"
        return "duckduckgo fallback results"

    monkeypatch.setattr(web_mcp, "_search_duckduckgo", fake_duckduckgo)
    monkeypatch.setattr(
        "httpx.AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse(status_code=403, json_data={"error": {"message": "bad key"}}),
        ),
    )

    result = await web_mcp._web_search({"query": "cloud deploy"})

    assert "duckduckgo fallback results" in result
    payload = _extract_tool_error_payload(result)
    assert payload["provider"] == "google"
    assert payload["fallback_tool"] == "web_search:duckduckgo"
