"""Feishu Tasks — CLI-backed read-only task listing for cloud office automation."""

from __future__ import annotations

import json

from app.config import get_settings
from app.services.agent_tool_domains.feishu_cli import FeishuCliError, _feishu_cli_available, _run_feishu_cli_command
from app.tools.result_envelope import render_tool_error


def _render_tasks(items: list[dict]) -> str:
    lines = ["✅ **Feishu tasks**"]
    if not items:
        lines.append("No tasks found.")
        return "\n".join(lines)
    for item in items:
        due = item.get("due_at") or "无截止时间"
        lines.append(f"- `{item.get('guid', '')}` **{item.get('summary', '(无标题)')}** · due: {due}")
    return "\n".join(lines)


async def _run_feishu_task_shortcut(args: list[str]) -> dict:
    settings = get_settings()
    command = [settings.FEISHU_CLI_BIN, *args, "--as", "user", "--format", "json"]
    return_code, stdout, stderr = await _run_feishu_cli_command(command)
    if return_code != 0:
        raise FeishuCliError(
            stderr or stdout or "lark-cli task command failed.",
            error_class="provider_unavailable",
            retryable=True,
            actionable_hint="Verify user auth via `lark-cli auth login --as user` and required task scopes.",
        )
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise FeishuCliError(
            "lark-cli task returned non-JSON output.",
            error_class="provider_error",
            retryable=False,
            actionable_hint="Run the same lark-cli task command manually and inspect the output.",
        ) from exc


async def _feishu_task_list(_agent_id, arguments: dict) -> str:
    if not await _feishu_cli_available():
        return render_tool_error(
            tool_name="feishu_task_list",
            error_class="not_configured",
            message="Feishu Task CLI is not enabled or authenticated.",
            provider="lark-cli",
            actionable_hint="Enable FEISHU_CLI_ENABLED and complete `lark-cli auth login --as user`.",
        )

    command = ["task", "+get-my-tasks"]
    query = str(arguments.get("query") or "").strip()
    if query:
        command.extend(["--query", query])
    if "complete" in arguments and arguments.get("complete") is not None:
        command.append(f"--complete={str(bool(arguments['complete'])).lower()}")
    if arguments.get("created_at"):
        command.extend(["--created_at", str(arguments["created_at"]).strip()])
    if arguments.get("due_start"):
        command.extend(["--due-start", str(arguments["due_start"]).strip()])
    if arguments.get("due_end"):
        command.extend(["--due-end", str(arguments["due_end"]).strip()])
    if arguments.get("page_all"):
        command.append("--page-all")
    elif arguments.get("page_limit"):
        command.extend(["--page-limit", str(int(arguments["page_limit"]))])

    payload = await _run_feishu_task_shortcut(command)
    return _render_tasks(payload.get("items", []))
