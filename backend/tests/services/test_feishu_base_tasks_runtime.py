from __future__ import annotations

import json

import pytest


def _extract_tool_error_payload(result: str) -> dict:
    marker = "<tool_error>"
    end_marker = "</tool_error>"
    start = result.index(marker) + len(marker)
    end = result.index(end_marker)
    return json.loads(result[start:end])


@pytest.mark.asyncio
async def test_feishu_base_table_list_prefers_cli_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent_tool_domains import feishu_base

    async def fake_cli_available() -> bool:
        return True

    async def fake_run_feishu_cli_command(args: list[str]) -> tuple[int, str, str]:
        assert args == [
            "lark-cli",
            "base",
            "+table-list",
            "--base-token",
            "app-token",
            "--offset",
            "0",
            "--limit",
            "50",
            "--format",
            "json",
        ]
        return 0, json.dumps({
            "items": [
                {"table_id": "tbl_1", "table_name": "销售日报"},
                {"table_id": "tbl_2", "table_name": "客户跟进"},
            ],
            "count": 2,
            "total": 2,
        }), ""

    monkeypatch.setattr(feishu_base, "_feishu_cli_available", fake_cli_available)
    monkeypatch.setattr(feishu_base, "_run_feishu_cli_command", fake_run_feishu_cli_command)

    result = await feishu_base._feishu_base_table_list("agent-1", {"base_token": "app-token"})

    assert "销售日报" in result
    assert "tbl_2" in result
    assert "<tool_error>" not in result


@pytest.mark.asyncio
async def test_feishu_base_record_list_prefers_cli_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent_tool_domains import feishu_base

    async def fake_cli_available() -> bool:
        return True

    async def fake_run_feishu_cli_command(args: list[str]) -> tuple[int, str, str]:
        assert args == [
            "lark-cli",
            "base",
            "+record-list",
            "--base-token",
            "app-token",
            "--table-id",
            "tbl_1",
            "--offset",
            "0",
            "--limit",
            "100",
            "--format",
            "json",
        ]
        return 0, json.dumps({
            "items": [
                {"record_id": "rec_1", "fields": {"姓名": "张三", "状态": "已完成"}},
            ],
            "count": 1,
            "total": 1,
        }), ""

    monkeypatch.setattr(feishu_base, "_feishu_cli_available", fake_cli_available)
    monkeypatch.setattr(feishu_base, "_run_feishu_cli_command", fake_run_feishu_cli_command)

    result = await feishu_base._feishu_base_record_list(
        "agent-1",
        {"base_token": "app-token", "table_id": "tbl_1"},
    )

    assert "rec_1" in result
    assert "张三" in result
    assert "<tool_error>" not in result


@pytest.mark.asyncio
async def test_feishu_task_list_uses_user_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent_tool_domains import feishu_tasks

    async def fake_cli_available() -> bool:
        return True

    async def fake_run_feishu_cli_command(args: list[str]) -> tuple[int, str, str]:
        assert args == [
            "lark-cli",
            "task",
            "+get-my-tasks",
            "--query",
            "日报",
            "--as",
            "user",
            "--format",
            "json",
        ]
        return 0, json.dumps({
            "items": [
                {"guid": "task_1", "summary": "日报整理", "url": "https://task", "due_at": "2026-04-02T10:00:00Z"},
            ],
            "has_more": False,
        }), ""

    monkeypatch.setattr(feishu_tasks, "_feishu_cli_available", fake_cli_available)
    monkeypatch.setattr(feishu_tasks, "_run_feishu_cli_command", fake_run_feishu_cli_command)

    result = await feishu_tasks._feishu_task_list("agent-1", {"query": "日报"})

    assert "task_1" in result
    assert "日报整理" in result
    assert "<tool_error>" not in result


@pytest.mark.asyncio
async def test_feishu_task_list_returns_structured_error_when_cli_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent_tool_domains import feishu_tasks

    async def fake_cli_available() -> bool:
        return False

    monkeypatch.setattr(feishu_tasks, "_feishu_cli_available", fake_cli_available)

    result = await feishu_tasks._feishu_task_list("agent-1", {"query": "日报"})

    payload = _extract_tool_error_payload(result)
    assert payload["tool_name"] == "feishu_task_list"
    assert payload["error_class"] == "not_configured"
