"""Feishu Base — CLI-backed read-only helpers for cloud office automation."""

from __future__ import annotations

import json

from app.config import get_settings
from app.services.agent_tool_domains.feishu_cli import FeishuCliError, _feishu_cli_available, _run_feishu_cli_command
from app.tools.result_envelope import render_tool_error


def _render_base_tables(base_token: str, items: list[dict], *, total: int | None = None) -> str:
    lines = [f"🗂️ **Feishu Base tables** (`{base_token}`)"]
    if total is not None:
        lines.append(f"总数：{total}")
    if not items:
        lines.append("当前 Base 下没有数据表。")
        return "\n".join(lines)
    for item in items:
        lines.append(f"- `{item.get('table_id', '')}` **{item.get('table_name', '(未命名)')}**")
    return "\n".join(lines)


def _render_base_records(table_id: str, items: list[dict], *, total: int | None = None) -> str:
    lines = [f"📋 **Feishu Base records** (`{table_id}`)"]
    if total is not None:
        lines.append(f"总数：{total}")
    if not items:
        lines.append("当前表下没有记录。")
        return "\n".join(lines)
    for item in items:
        lines.append(f"- `{item.get('record_id', '')}` {json.dumps(item.get('fields', {}), ensure_ascii=False)}")
    return "\n".join(lines)


async def _run_feishu_base_shortcut(args: list[str]) -> dict:
    settings = get_settings()
    command = [settings.FEISHU_CLI_BIN, *args, "--format", "json"]
    return_code, stdout, stderr = await _run_feishu_cli_command(command)
    if return_code != 0:
        raise FeishuCliError(
            stderr or stdout or "lark-cli base command failed.",
            error_class="provider_unavailable",
            retryable=True,
            actionable_hint="Verify lark-cli auth status, Base scopes, and base/table arguments.",
        )
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise FeishuCliError(
            "lark-cli base returned non-JSON output.",
            error_class="provider_error",
            retryable=False,
            actionable_hint="Run the same lark-cli base command manually and inspect the output.",
        ) from exc


async def _feishu_base_table_list(_agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_base_table_list",
            error_class="not_configured",
            message="Feishu Base CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and run `lark-cli auth login` with required Base scopes.",
        )

    base_token = str(arguments.get("base_token") or "").strip()
    if not base_token:
        return "❌ Missing required argument 'base_token'"

    offset = max(0, int(arguments.get("offset", 0)))
    limit = min(max(1, int(arguments.get("limit", 50))), 100)
    payload = await _run_feishu_base_shortcut(
        [
            "base",
            "+table-list",
            "--base-token",
            base_token,
            "--offset",
            str(offset),
            "--limit",
            str(limit),
        ]
    )
    return _render_base_tables(base_token, payload.get("items", []), total=payload.get("total"))


async def _feishu_base_record_list(_agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_base_record_list",
            error_class="not_configured",
            message="Feishu Base CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and run `lark-cli auth login` with required Base scopes.",
        )

    base_token = str(arguments.get("base_token") or "").strip()
    table_id = str(arguments.get("table_id") or "").strip()
    if not base_token:
        return "❌ Missing required argument 'base_token'"
    if not table_id:
        return "❌ Missing required argument 'table_id'"

    offset = max(0, int(arguments.get("offset", 0)))
    limit = min(max(1, int(arguments.get("limit", 100))), 200)
    command = [
        "base",
        "+record-list",
        "--base-token",
        base_token,
        "--table-id",
        table_id,
        "--offset",
        str(offset),
        "--limit",
        str(limit),
    ]
    view_id = str(arguments.get("view_id") or "").strip()
    if view_id:
        command.extend(["--view-id", view_id])
    payload = await _run_feishu_base_shortcut(command)
    return _render_base_records(table_id, payload.get("items", []), total=payload.get("total"))
