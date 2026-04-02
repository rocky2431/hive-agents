"""Feishu Base — CLI-backed helpers for cloud office automation."""

from __future__ import annotations

import json
from pathlib import Path

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


def _render_base_upsert(table_id: str, payload: dict) -> str:
    record = payload.get("record", {})
    record_id = record.get("record_id") or record.get("id", "")
    status = "updated" if payload.get("updated") else "created"
    lines = [f"✅ **Feishu Base record {status}** (`{table_id}`)"]
    if record_id:
        lines.append(f"- Record ID: `{record_id}`")
    lines.append(f"- Fields: {json.dumps(record.get('fields', {}), ensure_ascii=False)}")
    return "\n".join(lines)


def _render_base_fields(table_id: str, items: list[dict], *, total: int | None = None) -> str:
    lines = [f"🧩 **Feishu Base fields** (`{table_id}`)"]
    if total is not None:
        lines.append(f"总数：{total}")
    if not items:
        lines.append("当前表下没有字段。")
        return "\n".join(lines)
    for item in items:
        lines.append(
            f"- `{item.get('field_id', '')}` **{item.get('field_name', '(未命名字段)')}** · type: {item.get('type', '')}"
        )
    return "\n".join(lines)


def _render_base_attachment_upload(table_id: str, payload: dict) -> str:
    record = payload.get("record", {})
    attachment = payload.get("attachment", {})
    record_id = record.get("record_id") or record.get("id", "")
    file_token = attachment.get("file_token", "")
    name = attachment.get("name", "")
    lines = [f"📎 **Feishu Base attachment uploaded** (`{table_id}`)"]
    if record_id:
        lines.append(f"- Record ID: `{record_id}`")
    if file_token:
        lines.append(f"- File Token: `{file_token}`")
    if name:
        lines.append(f"- File Name: {name}")
    return "\n".join(lines)


async def _run_feishu_base_shortcut(args: list[str]) -> dict:
    settings = get_settings()
    cli_bin = getattr(settings, "FEISHU_CLI_BIN", "lark-cli") or "lark-cli"
    command = [cli_bin, *args, "--format", "json"]
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


def _render_invalid_input(message: str, *, tool_name: str, actionable_hint: str | None = None) -> str:
    return render_tool_error(
        tool_name=tool_name,
        error_class="invalid_input",
        message=message,
        provider="lark-cli",
        retryable=False,
        actionable_hint=actionable_hint,
    )


def _resolve_workspace_file(agent_id, file_path: str) -> Path:
    settings = get_settings()
    workspace_root = Path(settings.AGENT_DATA_DIR).resolve() / str(agent_id)
    candidate = (workspace_root / file_path).resolve()
    if not str(candidate).startswith(str(workspace_root)):
        raise ValueError("file_path must stay inside the agent workspace")
    return candidate


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


async def _feishu_base_record_upsert(_agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_base_record_upsert",
            error_class="not_configured",
            message="Feishu Base CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and run `lark-cli auth login` with required Base scopes.",
        )

    base_token = str(arguments.get("base_token") or "").strip()
    table_id = str(arguments.get("table_id") or "").strip()
    fields = arguments.get("fields")
    if not base_token:
        return _render_invalid_input(
            "Missing required argument 'base_token'.",
            tool_name="feishu_base_record_upsert",
        )
    if not table_id:
        return _render_invalid_input(
            "Missing required argument 'table_id'.",
            tool_name="feishu_base_record_upsert",
        )
    if not isinstance(fields, dict):
        return _render_invalid_input(
            "Argument 'fields' must be a JSON object.",
            tool_name="feishu_base_record_upsert",
            actionable_hint="Pass a field-name to value mapping, for example {'状态': '进行中'}.",
        )

    command = [
        "base",
        "+record-upsert",
        "--base-token",
        base_token,
        "--table-id",
        table_id,
    ]
    record_id = str(arguments.get("record_id") or "").strip()
    if record_id:
        command.extend(["--record-id", record_id])
    command.extend(["--json", json.dumps(fields, ensure_ascii=False, separators=(",", ":"))])

    payload = await _run_feishu_base_shortcut(command)
    return _render_base_upsert(table_id, payload)


async def _feishu_base_field_list(_agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_base_field_list",
            error_class="not_configured",
            message="Feishu Base CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and run `lark-cli auth login` with required Base scopes.",
        )

    base_token = str(arguments.get("base_token") or "").strip()
    table_id = str(arguments.get("table_id") or "").strip()
    if not base_token:
        return _render_invalid_input(
            "Missing required argument 'base_token'.",
            tool_name="feishu_base_field_list",
        )
    if not table_id:
        return _render_invalid_input(
            "Missing required argument 'table_id'.",
            tool_name="feishu_base_field_list",
        )

    offset = max(0, int(arguments.get("offset", 0)))
    limit = min(max(1, int(arguments.get("limit", 100))), 200)
    payload = await _run_feishu_base_shortcut(
        [
            "base",
            "+field-list",
            "--base-token",
            base_token,
            "--table-id",
            table_id,
            "--offset",
            str(offset),
            "--limit",
            str(limit),
        ]
    )
    return _render_base_fields(table_id, payload.get("items", []), total=payload.get("total"))


async def _feishu_base_record_upload_attachment(agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_base_record_upload_attachment",
            error_class="not_configured",
            message="Feishu Base CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and run `lark-cli auth login` with required Base scopes.",
        )

    base_token = str(arguments.get("base_token") or "").strip()
    table_id = str(arguments.get("table_id") or "").strip()
    record_id = str(arguments.get("record_id") or "").strip()
    field_id = str(arguments.get("field_id") or "").strip()
    file_path = str(arguments.get("file_path") or "").strip()
    if not base_token:
        return _render_invalid_input("Missing required argument 'base_token'.", tool_name="feishu_base_record_upload_attachment")
    if not table_id:
        return _render_invalid_input("Missing required argument 'table_id'.", tool_name="feishu_base_record_upload_attachment")
    if not record_id:
        return _render_invalid_input("Missing required argument 'record_id'.", tool_name="feishu_base_record_upload_attachment")
    if not field_id:
        return _render_invalid_input("Missing required argument 'field_id'.", tool_name="feishu_base_record_upload_attachment")
    if not file_path:
        return _render_invalid_input(
            "Missing required argument 'file_path'.",
            tool_name="feishu_base_record_upload_attachment",
            actionable_hint="Pass a workspace-relative file path, for example 'workspace/report.pdf'.",
        )

    try:
        absolute_file = _resolve_workspace_file(agent_id, file_path)
    except ValueError as exc:
        return _render_invalid_input(str(exc), tool_name="feishu_base_record_upload_attachment")
    if not absolute_file.exists():
        return render_tool_error(
            tool_name="feishu_base_record_upload_attachment",
            error_class="not_found",
            message=f"Workspace file not found: {file_path}",
            provider="lark-cli",
            retryable=False,
            actionable_hint="Write the file into the agent workspace before uploading it to Feishu Base.",
        )

    command = [
        "base",
        "+record-upload-attachment",
        "--base-token",
        base_token,
        "--table-id",
        table_id,
        "--record-id",
        record_id,
        "--field-id",
        field_id,
        "--file",
        str(absolute_file),
    ]
    display_name = str(arguments.get("name") or "").strip()
    if display_name:
        command.extend(["--name", display_name])

    payload = await _run_feishu_base_shortcut(command)
    return _render_base_attachment_upload(table_id, payload)
