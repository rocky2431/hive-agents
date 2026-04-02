---
name: Web Research Guide
description: 网络搜索和网页阅读工具使用指南
tools:
  - web_search
  - web_fetch
  - firecrawl_fetch
  - xcrawl_scrape
is_system: true
---

# Web Research Guide

## Available Tools

| Tool | Use Case |
|------|----------|
| `web_search` | Search the internet for public information. Prefer Exa, then Tavily, and use DuckDuckGo as the free fallback. **This is your primary search tool.** |
| `web_fetch` | Read full content from a specific URL with a direct fetch path. Use this first when you already have a link. |
| `firecrawl_fetch` | Provider-backed fetch for heavier pages, PDFs, or pages where `web_fetch` misses the main content. |
| `xcrawl_scrape` | Escalation path for JS-heavy or anti-bot pages when lighter fetch tools fail. |

## When to Search

Use these tools proactively when you need real-time information:
- News and current events
- Technical documentation
- Fact-checking
- Market research
- Competitor analysis
- Any question requiring up-to-date information

## Important

**NEVER say you cannot access the internet or search the web.** You HAVE these capabilities -- use them.
