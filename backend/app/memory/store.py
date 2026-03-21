"""Memory stores backed by the current file layout and a stronger semantic fact store."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Awaitable, Callable


SummaryLoader = Callable[[uuid.UUID, str | None], Awaitable[str | None]]
MemoryLoader = Callable[[uuid.UUID], str]


class PersistentMemoryStore:
    """Persistent semantic fact store backed by a per-agent SQLite database.

    The store remains compatible with the previous `memory.json` format by:
    1. importing legacy facts on first access
    2. exporting the canonical fact list back to `memory.json`
    """

    def __init__(self, *, data_root: Path) -> None:
        self.data_root = Path(data_root)

    def replace_semantic_facts(self, agent_id: uuid.UUID, facts: list[dict]) -> None:
        facts = [fact for fact in facts if isinstance(fact, dict) and fact.get("content")]
        with self._connect(agent_id) as conn:
            self._ensure_schema(conn)
            conn.execute("DELETE FROM semantic_facts")
            rows = []
            for index, fact in enumerate(facts):
                payload = dict(fact)
                content = str(payload.pop("content"))
                subject = payload.pop("subject", None)
                timestamp = payload.pop("timestamp", payload.pop("created_at", None))
                rows.append(
                    (
                        index,
                        content,
                        str(subject) if subject else None,
                        str(timestamp) if timestamp else None,
                        json.dumps(payload, ensure_ascii=False) if payload else None,
                    )
                )
            conn.executemany(
                """
                INSERT INTO semantic_facts(position, content, subject, timestamp, metadata_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
        self._write_legacy_json(agent_id, facts)

    def load_semantic_facts(self, agent_id: uuid.UUID, *, limit: int | None = None) -> list[dict]:
        with self._connect(agent_id) as conn:
            self._ensure_schema(conn)
            self._import_legacy_json_if_needed(agent_id, conn)
            query = (
                "SELECT content, subject, timestamp, metadata_json FROM semantic_facts "
                "ORDER BY position ASC"
            )
            params: tuple[object, ...] = ()
            if limit is not None:
                query += " LIMIT ?"
                params = (int(limit),)
            rows = conn.execute(query, params).fetchall()

        facts: list[dict] = []
        for content, subject, timestamp, metadata_json in rows:
            fact: dict = {"content": content}
            if subject:
                fact["subject"] = subject
            if timestamp:
                fact["timestamp"] = timestamp
            if metadata_json:
                try:
                    payload = json.loads(metadata_json)
                    if isinstance(payload, dict):
                        fact.update(payload)
                except json.JSONDecodeError:
                    fact["metadata_json"] = metadata_json
            facts.append(fact)
        return facts

    def render_semantic_lines(self, agent_id: uuid.UUID, *, limit: int = 15) -> str:
        lines = []
        for fact in self.load_semantic_facts(agent_id):
            content = fact.get("content", fact.get("fact", ""))
            if content:
                lines.append(f"- {content}")
        return "\n".join(lines[-limit:])

    def _memory_dir(self, agent_id: uuid.UUID) -> Path:
        return self.data_root / str(agent_id) / "memory"

    def _db_path(self, agent_id: uuid.UUID) -> Path:
        return self._memory_dir(agent_id) / "memory.sqlite3"

    def _legacy_json_path(self, agent_id: uuid.UUID) -> Path:
        return self._memory_dir(agent_id) / "memory.json"

    def _connect(self, agent_id: uuid.UUID) -> sqlite3.Connection:
        memory_dir = self._memory_dir(agent_id)
        memory_dir.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(self._db_path(agent_id))

    def _ensure_schema(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS semantic_facts (
                position INTEGER NOT NULL,
                content TEXT NOT NULL,
                subject TEXT,
                timestamp TEXT,
                metadata_json TEXT
            )
            """
        )

    def _import_legacy_json_if_needed(self, agent_id: uuid.UUID, conn: sqlite3.Connection) -> None:
        row = conn.execute("SELECT COUNT(*) FROM semantic_facts").fetchone()
        if row and row[0]:
            return

        memory_file = self._legacy_json_path(agent_id)
        if not memory_file.exists():
            return

        try:
            facts = json.loads(memory_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(facts, list):
            return
        conn.execute("DELETE FROM semantic_facts")
        rows = []
        for index, fact in enumerate(facts):
            if not isinstance(fact, dict) or not fact.get("content"):
                continue
            payload = dict(fact)
            content = str(payload.pop("content"))
            subject = payload.pop("subject", None)
            timestamp = payload.pop("timestamp", payload.pop("created_at", None))
            rows.append(
                (
                    index,
                    content,
                    str(subject) if subject else None,
                    str(timestamp) if timestamp else None,
                    json.dumps(payload, ensure_ascii=False) if payload else None,
                )
            )
        conn.executemany(
            """
            INSERT INTO semantic_facts(position, content, subject, timestamp, metadata_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
        self._write_legacy_json(agent_id, facts)

    def _write_legacy_json(self, agent_id: uuid.UUID, facts: list[dict]) -> None:
        memory_file = self._legacy_json_path(agent_id)
        memory_file.parent.mkdir(parents=True, exist_ok=True)
        memory_file.write_text(json.dumps(facts, ensure_ascii=False, indent=2), encoding="utf-8")


class FileBackedMemoryStore:
    """Build runtime memory context from the current Clawith storage layout."""

    def __init__(
        self,
        *,
        data_root: Path,
        load_session_summary: SummaryLoader,
        load_previous_session_summary: SummaryLoader,
        load_agent_memory: MemoryLoader | None = None,
    ) -> None:
        self.data_root = Path(data_root)
        self.load_session_summary = load_session_summary
        self.load_previous_session_summary = load_previous_session_summary
        self._persistent_store = PersistentMemoryStore(data_root=self.data_root)
        self.load_agent_memory = load_agent_memory or self._load_agent_memory

    async def build_context(
        self,
        *,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
        session_id: str | None = None,
    ) -> str:
        del tenant_id  # reserved for future backends

        parts: list[str] = []
        if session_id:
            current_summary = await self.load_session_summary(agent_id, session_id)
            if current_summary:
                parts.append(f"[Previous conversation summary]\n{current_summary}")
            else:
                previous_summary = await self.load_previous_session_summary(agent_id, session_id)
                if previous_summary:
                    parts.append(f"[Previous conversation summary]\n{previous_summary}")

        memory_text = self.load_agent_memory(agent_id)
        if memory_text:
            parts.append(f"[Agent memory]\n{memory_text}")

        return "\n\n".join(parts)

    async def build_session_snapshot(
        self,
        *,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
        session_id: str | None = None,
    ) -> str:
        """Build a frozen memory snapshot for session-start prompt caching."""
        return await self.build_context(
            agent_id=agent_id,
            tenant_id=tenant_id,
            session_id=session_id,
        )

    def _load_agent_memory(self, agent_id: uuid.UUID) -> str:
        return self._persistent_store.render_semantic_lines(agent_id)
