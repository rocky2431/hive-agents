"""Core tool executors extracted from the legacy tool dispatcher."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from app.tools.runtime import ToolExecutionRegistry, ToolExecutionRequest


SyncWorkspaceTool = Callable[[Path, str, str | None], str]
LoadSkillTool = Callable[[Path, str], str]
WriteFileTool = Callable[[Path, str, str], str]
EditFileTool = Callable[[Path, str, str, str, bool], str]
GlobSearchTool = Callable[[Path, str, str], str]
GrepSearchTool = Callable[[Path, str, str, int], str]
ToolSearchTool = Callable[[Path, str], str]
AsyncWorkspaceTool = Callable[[Path, dict], Awaitable[str] | str]
AsyncAgentTool = Callable[[object, dict], Awaitable[str] | str]


@dataclass(slots=True)
class CoreToolDependencies:
    list_files: SyncWorkspaceTool
    read_file: SyncWorkspaceTool
    load_skill: LoadSkillTool
    write_file: WriteFileTool
    edit_file: EditFileTool
    glob_search: GlobSearchTool
    grep_search: GrepSearchTool
    tool_search: ToolSearchTool
    execute_code: AsyncWorkspaceTool
    set_trigger: AsyncAgentTool
    send_feishu_message: AsyncAgentTool
    send_web_message: AsyncAgentTool
    send_message_to_agent: AsyncAgentTool


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def register_core_tool_executors(
    registry: ToolExecutionRegistry,
    deps: CoreToolDependencies,
) -> None:
    async def _list_files(request: ToolExecutionRequest) -> str:
        return deps.list_files(
            request.context.workspace,
            request.arguments.get("path", ""),
            request.context.tenant_id,
        )

    async def _read_file(request: ToolExecutionRequest) -> str:
        path = request.arguments.get("path")
        if not path:
            return "❌ Missing required argument 'path' for read_file"
        return deps.read_file(
            request.context.workspace,
            path,
            request.context.tenant_id,
        )

    async def _load_skill(request: ToolExecutionRequest) -> str:
        skill_name = request.arguments.get("name")
        if not skill_name:
            return "❌ Missing required argument 'name' for load_skill"
        return deps.load_skill(request.context.workspace, skill_name)

    async def _write_file(request: ToolExecutionRequest) -> str:
        path = request.arguments.get("path")
        content = request.arguments.get("content")
        if not path:
            return "❌ Missing required argument 'path' for write_file. Please provide a file path like 'skills/my-skill/SKILL.md'"
        if content is None:
            return "❌ Missing required argument 'content' for write_file"
        return deps.write_file(request.context.workspace, path, content)

    async def _edit_file(request: ToolExecutionRequest) -> str:
        path = request.arguments.get("path")
        old_text = request.arguments.get("old_text")
        new_text = request.arguments.get("new_text")
        replace_all = bool(request.arguments.get("replace_all", False))
        if not path or old_text is None or new_text is None:
            return "❌ Missing required arguments 'path', 'old_text', and 'new_text' for edit_file"
        return deps.edit_file(request.context.workspace, path, old_text, new_text, replace_all)

    async def _glob_search(request: ToolExecutionRequest) -> str:
        pattern = request.arguments.get("pattern")
        if not pattern:
            return "❌ Missing required argument 'pattern' for glob_search"
        root = request.arguments.get("root", "")
        return deps.glob_search(request.context.workspace, pattern, root)

    async def _grep_search(request: ToolExecutionRequest) -> str:
        pattern = request.arguments.get("pattern")
        if not pattern:
            return "❌ Missing required argument 'pattern' for grep_search"
        root = request.arguments.get("root", "")
        max_results = int(request.arguments.get("max_results", 50))
        return deps.grep_search(request.context.workspace, pattern, root, max_results)

    async def _tool_search(request: ToolExecutionRequest) -> str:
        query = str(request.arguments.get("query", "") or "")
        return deps.tool_search(request.context.workspace, query)

    async def _execute_code(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.execute_code(request.context.workspace, request.arguments))

    async def _set_trigger(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.set_trigger(request.context.agent_id, request.arguments))

    async def _send_feishu_message(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.send_feishu_message(request.context.agent_id, request.arguments))

    async def _send_web_message(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.send_web_message(request.context.agent_id, request.arguments))

    async def _send_message_to_agent(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.send_message_to_agent(request.context.agent_id, request.arguments))

    registry.register("list_files", _list_files)
    registry.register("read_file", _read_file)
    registry.register("load_skill", _load_skill)
    registry.register("write_file", _write_file)
    registry.register("edit_file", _edit_file)
    registry.register("glob_search", _glob_search)
    registry.register("grep_search", _grep_search)
    registry.register("tool_search", _tool_search)
    registry.register("execute_code", _execute_code)
    registry.register("set_trigger", _set_trigger)
    registry.register("send_feishu_message", _send_feishu_message)
    registry.register("send_web_message", _send_web_message)
    registry.register("send_message_to_agent", _send_message_to_agent)
