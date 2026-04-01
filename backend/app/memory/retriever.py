"""Four-layer memory retrieval pipeline.

Retrieves memory items from working, episodic, semantic, and external layers,
returning a unified list of MemoryItem objects for the assembler.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.memory.store import PersistentMemoryStore
from app.memory.types import MemoryItem, MemoryKind, parse_utc_timestamp

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


def _score_semantic_item(content: str, query: str, timestamp: str | None) -> float:
    lexical = _score_relevance(content, query) if query else 0.0
    recency = _score_recency(timestamp)
    if query:
        return lexical * 0.85 + recency * 0.15
    # Without query (session start): baseline 0.5 + recency bonus so all semantic
    # facts surface with reasonable scores instead of pure recency ordering.
    return 0.5 + recency * 0.3


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
        limit: int = 20,
    ) -> list[MemoryItem]:
        """Retrieve memory items from all four layers."""
        items: list[MemoryItem] = []
        items.extend(self._retrieve_working(agent_id))
        items.extend(await self._retrieve_episodic(agent_id, session_id))
        items.extend(self._retrieve_semantic(agent_id, query, limit=limit))
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

    def _retrieve_semantic(self, agent_id: uuid.UUID, query: str, *, limit: int = 20) -> list[MemoryItem]:
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
            score = _score_semantic_item(content, query, timestamp)
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
