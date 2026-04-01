"""Four-layer memory retrieval pipeline.

Retrieves memory items from working, episodic, semantic, and external layers,
returning a unified list of MemoryItem objects for the assembler.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

import json

from app.memory.store import PersistentMemoryStore
from app.memory.types import MemoryItem, MemoryKind, parse_utc_timestamp

# Rerank: only trigger LLM side-query when semantic candidates exceed this count.
_RERANK_THRESHOLD = 5
_RERANK_MAX_SELECT = 5

logger = logging.getLogger(__name__)


def _content_similar(a: str, b: str, threshold: float = 0.7) -> bool:
    """Check if two text blocks are similar using word overlap."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return False
    overlap = len(words_a & words_b)
    return overlap / min(len(words_a), len(words_b)) > threshold


def _score_relevance(content: str, query: str) -> float:
    """Score content relevance against query using keyword overlap."""
    query_words = set(query.lower().split())
    content_words = set(content.lower().split())
    overlap = query_words & content_words
    return len(overlap) / max(len(query_words), 1)


_parse_timestamp = parse_utc_timestamp  # Use shared implementation from types.py


def _score_recency(timestamp: str | None) -> float:
    dt = _parse_timestamp(timestamp)
    if dt is None:
        return 0.0
    now = datetime.now(UTC)
    age_days = max((now - dt).total_seconds() / 86400, 0.0)
    # Smooth decay: 1.0 when new, tapering over ~90 days.
    return 1.0 / (1.0 + (age_days / 90.0))


def _score_semantic_item(content: str, query: str, timestamp: str | None, category: str | None = None) -> float:
    lexical = _score_relevance(content, query) if query else 0.0
    recency = _score_recency(timestamp)
    if query:
        base = lexical * 0.85 + recency * 0.15
    else:
        # Without query (session start): baseline 0.5 + recency bonus so all semantic
        # facts surface with reasonable scores instead of pure recency ordering.
        base = 0.5 + recency * 0.3
    # B-07 fix: category-aware scoring — feedback and user facts are higher signal
    if category == "feedback":
        base = min(base * 1.5, 1.0)
    elif category == "user":
        base = min(base * 1.2, 1.0)
    return base


async def _rerank_semantic_items(
    items: list[MemoryItem],
    query: str,
    model_config: dict | None = None,
) -> list[MemoryItem]:
    """Use a cheap LLM side-query to select the most relevant semantic memories.

    Returns up to _RERANK_MAX_SELECT items, preserving original MemoryItem objects.
    Falls back to the original list on any error.

    Args:
        model_config: dict with keys provider/api_key/model/base_url for create_llm_client.
            If None, rerank is skipped (graceful degradation).
    """
    if not model_config:
        return items[:_RERANK_MAX_SELECT]

    try:
        from app.services.llm_client import LLMMessage, create_llm_client
    except ImportError:
        return items[:_RERANK_MAX_SELECT]

    manifest_lines = [
        str(i) + ": " + item.content[:150] for i, item in enumerate(items)
    ]
    manifest = "\n".join(manifest_lines)
    prompt_parts = [
        "Query: " + query,
        "",
        "Memories (index: content):",
        manifest,
        "",
        "Select up to " + str(_RERANK_MAX_SELECT) + " memory indices most useful for this query. ",
        'Return JSON: {"selected": [0, 2, 4]}',
    ]
    prompt_text = "\n".join(prompt_parts)
    try:
        client = create_llm_client(**model_config)
        response = await client.stream(
            messages=[
                LLMMessage(role="system", content="Select the most relevant memories. Return only JSON."),
                LLMMessage(role="user", content=prompt_text),
            ],
            max_tokens=100,
            temperature=0.0,
        )
        content = response.content if hasattr(response, "content") else str(response)
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end])
            indices = parsed.get("selected", [])
            if isinstance(indices, list) and indices:
                selected = [items[i] for i in indices if isinstance(i, int) and 0 <= i < len(items)]
                if selected:
                    logger.debug("[Retriever] Rerank selected %d/%d items", len(selected), len(items))
                    return selected
        if hasattr(client, "close"):
            await client.close()
    except Exception as exc:
        logger.debug("[Retriever] Rerank failed, using original order: %s", exc)

    return items[:_RERANK_MAX_SELECT]


class MemoryRetriever:
    """Four-layer memory retrieval pipeline.

    Each layer maps to a MemoryKind and retrieves items independently.
    The retriever works without a database connection (for testability);
    DB-dependent layers degrade gracefully with logging.
    """

    def __init__(self, *, data_root: Path) -> None:
        self.data_root = Path(data_root)
        self._persistent_store = PersistentMemoryStore(data_root=self.data_root)

    async def retrieve(
        self,
        agent_id: uuid.UUID,
        query: str,
        session_id: str | None,
        tenant_id: str | None,
        *,
        limit: int = 50,
        rerank_model_config: dict | None = None,
    ) -> list[MemoryItem]:
        """Retrieve memory items from all four layers.

        Args:
            rerank_model_config: When provided and semantic candidates > _RERANK_THRESHOLD,
                use a cheap LLM side-query to re-score semantic items by relevance.
                Dict with keys: provider, api_key, model, base_url (for create_llm_client).
        """
        items: list[MemoryItem] = []
        items.extend(self._retrieve_working(agent_id))
        items.extend(await self._retrieve_episodic(agent_id, session_id))
        semantic_items = self._retrieve_semantic(agent_id, query, limit=limit)

        # P1.6: Optional LLM-based rerank for semantic items
        if rerank_model_config and query and len(semantic_items) > _RERANK_THRESHOLD:
            semantic_items = await _rerank_semantic_items(semantic_items, query, rerank_model_config)

        items.extend(semantic_items)
        items.extend(await self._retrieve_external(agent_id, query, tenant_id))
        return items

    # -- Working layer: agent's focus.md --

    def _retrieve_working(self, agent_id: uuid.UUID) -> list[MemoryItem]:
        focus_file = self.data_root / str(agent_id) / "focus.md"
        # Atomic read: skip exists() check to avoid TOCTOU race — just try to read
        try:
            content = focus_file.read_text(encoding="utf-8").strip()
            if not content:
                return []
            return [MemoryItem(kind=MemoryKind.WORKING, content=content, score=1.0, source="focus.md")]
        except FileNotFoundError:
            return []
        except OSError:
            logger.debug("Failed to read focus.md for agent %s", agent_id)
            return []

    # -- Episodic layer: session summaries from DB --

    async def _retrieve_episodic(self, agent_id: uuid.UUID, session_id: str | None) -> list[MemoryItem]:
        items: list[MemoryItem] = []
        try:
            from app.database import async_session
            from app.models.chat_session import ChatSession
            from sqlalchemy import select

            session_uuid = _parse_session_uuid(session_id)

            async with async_session() as db:
                # Current session summary
                if session_uuid:
                    result = await db.execute(
                        select(ChatSession.summary, ChatSession.id).where(
                            ChatSession.id == session_uuid,
                            ChatSession.summary.isnot(None),
                            (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
                        )
                    )
                    row = result.first()
                    if row and row[0]:
                        items.append(
                            MemoryItem(
                                kind=MemoryKind.EPISODIC,
                                content=row[0],
                                score=1.0,
                                source="current_session",
                                metadata={"session_id": str(row[1]), "is_current_session": True},
                            )
                        )

                # Previous session summaries — load up to 3 for continuity
                prev_query = (
                    select(ChatSession.summary, ChatSession.id, ChatSession.last_message_at)
                    .where(
                        (ChatSession.agent_id == agent_id) | (ChatSession.peer_agent_id == agent_id),
                        ChatSession.summary.isnot(None),
                    )
                    .order_by(ChatSession.last_message_at.desc(), ChatSession.created_at.desc())
                    .limit(3)
                )
                if session_uuid:
                    prev_query = prev_query.where(ChatSession.id != session_uuid)
                result = await db.execute(prev_query)
                rows = result.all()
                for i, row in enumerate(rows):
                    if row[0]:
                        # Score decays: 0.8 → 0.6 → 0.4 for older sessions
                        score = max(0.8 - i * 0.2, 0.3)
                        _last_msg_at = row[2]
                        items.append(
                            MemoryItem(
                                kind=MemoryKind.EPISODIC,
                                content=row[0],
                                score=score,
                                source=f"previous_session_{i + 1}",
                                metadata={
                                    "session_id": str(row[1]),
                                    "timestamp": _last_msg_at.isoformat() if _last_msg_at else None,
                                },
                            )
                        )

        except Exception as exc:
            logger.warning("Episodic retrieval failed: %s", exc)

        # Deduplicate episodic items with similar content
        if len(items) > 1:
            unique: list[MemoryItem] = [items[0]]
            for item in items[1:]:
                if not any(_content_similar(item.content, u.content) for u in unique):
                    unique.append(item)
            items = unique

        return items

    # -- Semantic layer: memory.json facts scored by relevance --

    def _retrieve_semantic(self, agent_id: uuid.UUID, query: str, *, limit: int = 50) -> list[MemoryItem]:
        try:
            facts = self._persistent_store.load_semantic_facts(agent_id)
        except Exception as exc:
            logger.warning("Failed to read semantic store for agent %s: %s", agent_id, exc)
            return []

        if not isinstance(facts, list) or not facts:
            return []

        items: list[MemoryItem] = []
        for fact in facts:
            if not isinstance(fact, dict):
                continue
            content = fact.get("content", fact.get("fact", ""))
            if not content:
                continue
            timestamp = fact.get("timestamp") or fact.get("created_at")
            _category = fact.get("category")
            score = _score_semantic_item(content, query, timestamp, category=_category)
            items.append(
                MemoryItem(
                    kind=MemoryKind.SEMANTIC,
                    content=content,
                    score=score,
                    source="memory.sqlite3",
                    metadata={k: v for k, v in fact.items() if k not in ("content", "fact")},
                )
            )

        # Sort by relevance score descending, take top `limit`
        items.sort(key=lambda x: x.score, reverse=True)
        return items[:limit]

    # -- External layer: OpenViking recall --

    async def _retrieve_external(self, agent_id: uuid.UUID, query: str, tenant_id: str | None) -> list[MemoryItem]:
        if not query or not tenant_id:
            return []

        try:
            from app.services import viking_client

            if not viking_client.is_configured():
                return []

            results = await viking_client.find(
                query,
                tenant_id=tenant_id,
                agent_id=str(agent_id),
                limit=5,
            )

            items: list[MemoryItem] = []
            for result in results:
                content = result.get("content", "")
                if not content:
                    continue
                items.append(
                    MemoryItem(
                        kind=MemoryKind.EXTERNAL,
                        content=content,
                        score=result.get("score", 0.5),
                        source="openviking",
                        metadata={"uri": result.get("uri", "")},
                    )
                )
            return items

        except Exception as exc:
            logger.warning("External retrieval failed: %s", exc)
            return []


def _parse_session_uuid(session_id: str | None) -> uuid.UUID | None:
    if not session_id:
        return None
    try:
        return uuid.UUID(str(session_id))
    except (ValueError, TypeError) as exc:
        logger.debug("Invalid session UUID %s: %s", session_id, exc)
        return None
