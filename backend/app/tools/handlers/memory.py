"""Memory tools — agent-initiated memory read/write and cross-session search."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.tools.decorator import ToolMeta, tool


# -- save_memory ---------------------------------------------------------------

@tool(ToolMeta(
    name="save_memory",
    description=(
        "Persist a fact to your long-term memory so it is available in future conversations.\n\n"
        "Use this tool when you encounter information worth remembering across sessions:\n"
        "- User corrections or preferences (category: feedback)\n"
        "- Important project decisions or deadlines (category: project)\n"
        "- Successful approaches worth reusing (category: strategy)\n"
        "- Approaches proven to fail (category: blocked_pattern)\n"
        "- Hard rules you must follow (category: constraint)\n"
        "- External system references, URLs, tool names (category: reference)\n"
        "- User role, knowledge, working style (category: user)\n\n"
        "Each fact should be a single, concise statement (under 200 chars is ideal).\n"
        "Do NOT store transient task state, raw tool output, or debugging logs."
    ),
    parameters={
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The fact to remember. Keep concise and durable.",
            },
            "category": {
                "type": "string",
                "enum": [
                    "user", "feedback", "project", "reference",
                    "constraint", "strategy", "blocked_pattern", "general",
                ],
                "description": "Memory category for retrieval prioritization.",
            },
            "subject": {
                "type": "string",
                "description": "Optional topic/subject tag for grouping related facts.",
            },
        },
        "required": ["content", "category"],
    },
    category="memory",
    display_name="Save Memory",
    icon="\U0001f9e0",
    read_only=False,
    parallel_safe=False,
    governance="safe",
    adapter="agent_args",
))
def save_memory(agent_id: uuid.UUID, arguments: dict) -> str:
    from pathlib import Path

    from app.config import get_settings
    from app.memory.store import MEMORY_CATEGORIES, PersistentMemoryStore

    content = (arguments.get("content") or "").strip()
    if not content:
        return "[Error] content is required and cannot be empty."

    category = arguments.get("category", "general")
    if category not in MEMORY_CATEGORIES:
        category = "general"

    subject = arguments.get("subject")

    settings = get_settings()
    store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))
    existing = store.load_semantic_facts(agent_id)

    new_fact = {
        "content": content[:2000],
        "category": category,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if subject:
        new_fact["subject"] = subject

    # Merge: deduplicate by content similarity before appending
    from app.services.memory_service import _merge_memory_facts
    merged = _merge_memory_facts(existing, [new_fact])
    store.replace_semantic_facts(agent_id, merged)

    return f"Saved to long-term memory [{category}]: {content[:80]}{'...' if len(content) > 80 else ''}"


# -- search_memory -------------------------------------------------------------

@tool(ToolMeta(
    name="search_memory",
    description=(
        "Search your long-term memory and past session history.\n\n"
        "Use this tool when you need to recall:\n"
        "- What a user told you in a previous conversation\n"
        "- Decisions, preferences, or constraints from past sessions\n"
        "- Strategies that worked or approaches that failed\n"
        "- Any fact you saved previously with save_memory\n\n"
        "Returns matching facts ranked by relevance."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords or phrase to find in memory.",
            },
            "scope": {
                "type": "string",
                "enum": ["facts", "sessions", "all"],
                "description": "Search scope: 'facts' (semantic memory only), 'sessions' (past session summaries), 'all' (both). Default: all.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return. Default: 10.",
            },
        },
        "required": ["query"],
    },
    category="memory",
    display_name="Search Memory",
    icon="\U0001f50d",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    adapter="agent_args",
))
async def search_memory(agent_id: uuid.UUID, arguments: dict) -> str:
    from pathlib import Path

    from app.config import get_settings
    from app.memory.store import PersistentMemoryStore

    query = (arguments.get("query") or "").strip()
    if not query:
        return "[Error] query is required."

    scope = arguments.get("scope", "all")
    limit = min(int(arguments.get("limit", 10)), 20)
    results: list[str] = []

    settings = get_settings()

    # --- Semantic facts search ---
    if scope in ("facts", "all"):
        store = PersistentMemoryStore(data_root=Path(settings.AGENT_DATA_DIR))
        facts = store.search_facts(agent_id, query, limit=limit)
        if facts:
            results.append("## Semantic Memory")
            for f in facts:
                cat = f.get("category", "general")
                content = f.get("content", "")
                ts = f.get("timestamp", "")
                ts_display = f" ({ts[:10]})" if ts else ""
                results.append(f"- [{cat}]{ts_display} {content}")

    # --- Session summaries search ---
    if scope in ("sessions", "all"):
        try:
            from sqlalchemy import select

            from app.db import async_session
            from app.models.chat_session import ChatSession

            async with async_session() as db:
                stmt = (
                    select(ChatSession.summary, ChatSession.last_message_at, ChatSession.source_channel)
                    .where(
                        ChatSession.agent_id == agent_id,
                        ChatSession.summary.isnot(None),
                        ChatSession.summary != "",
                    )
                    .order_by(ChatSession.last_message_at.desc())
                    .limit(50)  # scan recent 50 sessions
                )
                rows = (await db.execute(stmt)).all()

            # Simple keyword match on summaries
            query_lower = query.lower()
            matched = []
            for summary, last_msg_at, source in rows:
                if query_lower in (summary or "").lower():
                    matched.append((summary, last_msg_at, source))
                if len(matched) >= limit:
                    break

            if matched:
                results.append("## Session History")
                for summary, last_msg_at, source in matched:
                    ts = last_msg_at.strftime("%Y-%m-%d") if last_msg_at else "?"
                    src = f" [{source}]" if source else ""
                    results.append(f"- ({ts}{src}) {summary[:300]}")
        except Exception as exc:
            results.append(f"## Session History\n- [Search error: {exc}]")

    if not results:
        return f"No memory found for query: {query}"

    return "\n".join(results)
