"""Tests for T0 Raw Behavior Logger."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.t0_logger import (
    _format_chat_log,
    _format_delegation_log,
    _format_dream_log,
    _format_heartbeat_log,
    _format_trigger_log,
    _generate_filename,
    _truncate,
    _yaml_frontmatter,
    cleanup_old_logs,
    write_t0_log,
)


# ── Helpers ──


@pytest.fixture
def agent_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def tmp_agent_dir(tmp_path: Path, agent_id: uuid.UUID) -> Path:
    """Create a temporary agent data dir with logs/."""
    agent_dir = tmp_path / str(agent_id)
    (agent_dir / "logs").mkdir(parents=True)
    return tmp_path


# ── _yaml_frontmatter ──


class TestYamlFrontmatter:
    def test_basic_fields(self) -> None:
        result = _yaml_frontmatter({"type": "chat", "turns": 5})
        assert result.startswith("---")
        assert result.endswith("---")
        assert "type: chat" in result
        assert "turns: 5" in result

    def test_list_field(self) -> None:
        result = _yaml_frontmatter({"tools": ["search", "write"]})
        assert "tools: [search, write]" in result

    def test_empty_list(self) -> None:
        result = _yaml_frontmatter({"tools": []})
        assert "tools: []" in result

    def test_datetime_field(self) -> None:
        dt = datetime(2026, 4, 5, 14, 30, tzinfo=timezone.utc)
        result = _yaml_frontmatter({"started": dt})
        assert "started: 2026-04-05T14:30:00+00:00" in result

    def test_bool_field(self) -> None:
        result = _yaml_frontmatter({"active": True, "stale": False})
        assert "active: true" in result
        assert "stale: false" in result


# ── _generate_filename ──


class TestGenerateFilename:
    def test_format(self) -> None:
        name = _generate_filename("chat", "a1b2")
        assert name.startswith("chat-")
        assert name.endswith("-a1b2.md")
        # HHmm part should be 4 digits
        parts = name.split("-")
        assert len(parts[1]) == 4
        assert parts[1].isdigit()

    def test_auto_short_id(self) -> None:
        name = _generate_filename("trigger")
        assert name.startswith("trigger-")
        assert name.endswith(".md")
        # Should have auto-generated short_id (4 hex chars)
        parts = name.rsplit("-", 1)
        short_id = parts[1].replace(".md", "")
        assert len(short_id) == 4


# ── _truncate ──


class TestTruncate:
    def test_short_text(self) -> None:
        assert _truncate("hello", 100) == "hello"

    def test_exact_length(self) -> None:
        assert _truncate("12345", 5) == "12345"

    def test_truncation(self) -> None:
        result = _truncate("hello world", 5)
        assert result == "hello…"
        assert len(result) == 6  # 5 + ellipsis


# ── Format functions ──


class TestFormatChatLog:
    def test_basic_chat(self) -> None:
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        result = _format_chat_log(messages, {"source": "web", "session_id": "abc-123", "user_name": "Rocky"})
        assert "type: chat" in result
        assert "source: web" in result
        assert "user: Rocky" in result
        assert "turns: 1" in result
        assert "## Turn 1" in result
        assert "**User**: Hello" in result
        assert "**Agent**: Hi there!" in result

    def test_multi_part_content(self) -> None:
        messages = [
            {"role": "user", "content": [{"type": "text", "text": "image question"}, {"type": "image_url"}]},
        ]
        result = _format_chat_log(messages, {})
        assert "image question" in result

    def test_tool_calls(self) -> None:
        messages = [
            {"role": "user", "content": "search for X"},
            {
                "role": "assistant",
                "content": "Searching...",
                "tool_calls": [{"function": {"name": "web_search", "arguments": '{"q":"X"}'}}],
            },
        ]
        result = _format_chat_log(messages, {})
        assert "tools: [web_search]" in result
        assert "`web_search(" in result

    def test_empty_messages(self) -> None:
        result = _format_chat_log([], {})
        assert "type: chat" in result
        assert "turns: 0" in result


class TestFormatTriggerLog:
    def test_basic_trigger(self) -> None:
        result = _format_trigger_log(
            [{"role": "assistant", "content": "Done"}],
            {"trigger_name": "daily-standup", "trigger_type": "cron", "status": "success", "duration_ms": 5000,
             "instruction": "Check tasks", "result": "3 tasks updated"},
        )
        assert "type: trigger" in result
        assert "trigger_name: daily-standup" in result
        assert "status: success" in result
        assert "## Instruction" in result
        assert "Check tasks" in result
        assert "## Result" in result
        assert "3 tasks updated" in result


class TestFormatDelegationLog:
    def test_basic_delegation(self) -> None:
        result = _format_delegation_log(
            [{"role": "assistant", "content": "Researched"}],
            {"from_agent": "PM", "to_agent": "Researcher", "task": "Find competitors", "status": "success",
             "result": "Found 5"},
        )
        assert "type: delegation" in result
        assert "from: PM" in result
        assert "to: Researcher" in result
        assert "Find competitors" in result


class TestFormatHeartbeatLog:
    def test_basic_heartbeat(self) -> None:
        result = _format_heartbeat_log(
            [],
            {"tick": 3, "new_t2": 2, "distilled": 1, "score": 7,
             "new_t2_entries": ["feedback: user likes X"], "action": "none"},
        )
        assert "type: heartbeat" in result
        assert "tick: 3" in result
        assert "new_t2: 2" in result
        assert "feedback: user likes X" in result


class TestFormatDreamLog:
    def test_basic_dream(self) -> None:
        result = _format_dream_log(
            [],
            {"t3_processed": 5, "deduped": 3, "promoted_to_soul": 1,
             "dedup_summary": "Merged 3 feedback entries", "soul_promotions": ["Core value: quality"],
             "cleanup_summary": "T2 truncated to 10"},
        )
        assert "type: dream" in result
        assert "t3_processed: 5" in result
        assert "Merged 3 feedback entries" in result
        assert "Core value: quality" in result


# ── write_t0_log ──


class TestWriteT0Log:
    def test_writes_chat_file(self, agent_id: uuid.UUID, tmp_agent_dir: Path) -> None:
        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            path = write_t0_log(
                agent_id,
                behavior_type="chat",
                messages=[{"role": "user", "content": "Hi"}],
                metadata={"source": "web", "session_id": "test-sess"},
            )
        assert path is not None
        assert path.exists()
        assert path.name.startswith("chat-")
        content = path.read_text()
        assert "type: chat" in content

    def test_unknown_type_returns_none(self, agent_id: uuid.UUID) -> None:
        result = write_t0_log(agent_id, behavior_type="unknown_type")
        assert result is None

    def test_writes_to_date_directory(self, agent_id: uuid.UUID, tmp_agent_dir: Path) -> None:
        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            path = write_t0_log(agent_id, behavior_type="trigger", metadata={"trigger_name": "test"})
        assert path is not None
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert today in str(path)

    def test_all_five_types(self, agent_id: uuid.UUID, tmp_agent_dir: Path) -> None:
        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            for btype in ["chat", "trigger", "delegation", "heartbeat", "dream"]:
                path = write_t0_log(agent_id, behavior_type=btype)
                assert path is not None, f"Failed for type: {btype}"
                assert path.exists()


# ── cleanup_old_logs ──


class TestCleanupOldLogs:
    def test_removes_old_directories(self, agent_id: uuid.UUID, tmp_agent_dir: Path) -> None:
        logs_dir = tmp_agent_dir / str(agent_id) / "logs"
        # Create old directory (40 days ago)
        old_date = (datetime.now(timezone.utc) - timedelta(days=40)).strftime("%Y-%m-%d")
        (logs_dir / old_date).mkdir()
        (logs_dir / old_date / "chat-1200-abcd.md").write_text("old log")
        # Create recent directory
        recent_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        (logs_dir / recent_date).mkdir()
        (logs_dir / recent_date / "chat-1200-efgh.md").write_text("new log")

        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            removed = cleanup_old_logs(agent_id, retention_days=30)

        assert removed == 1
        assert not (logs_dir / old_date).exists()
        assert (logs_dir / recent_date).exists()

    def test_no_logs_dir(self, tmp_agent_dir: Path) -> None:
        fake_id = uuid.uuid4()
        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            removed = cleanup_old_logs(fake_id, retention_days=30)
        assert removed == 0

    def test_keeps_recent(self, agent_id: uuid.UUID, tmp_agent_dir: Path) -> None:
        logs_dir = tmp_agent_dir / str(agent_id) / "logs"
        recent = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        (logs_dir / recent).mkdir()

        with patch("app.services.t0_logger.get_settings") as mock_settings:
            mock_settings.return_value.AGENT_DATA_DIR = str(tmp_agent_dir)
            removed = cleanup_old_logs(agent_id, retention_days=30)
        assert removed == 0
        assert (logs_dir / recent).exists()
