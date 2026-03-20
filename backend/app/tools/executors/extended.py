"""Extended tool executors extracted from the legacy dispatcher."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from app.tools.runtime import ToolExecutionRegistry, ToolExecutionRequest


AsyncReadDocumentTool = Callable[[Path, str, int, str | None], Awaitable[str] | str]
DeleteFileTool = Callable[[Path, str], str]
AsyncAgentTool = Callable[[object, dict], Awaitable[str] | str]
AsyncAgentNoArgsTool = Callable[[object], Awaitable[str] | str]
AsyncArgsTool = Callable[[dict], Awaitable[str] | str]
AsyncChannelFileTool = Callable[[object, Path, dict], Awaitable[str] | str]


@dataclass(slots=True)
class ExtendedToolDependencies:
    read_document: AsyncReadDocumentTool
    delete_file: DeleteFileTool
    update_trigger: AsyncAgentTool
    cancel_trigger: AsyncAgentTool
    list_triggers: AsyncAgentNoArgsTool
    web_search: AsyncArgsTool
    jina_search: AsyncArgsTool
    jina_read: AsyncArgsTool
    send_channel_file: AsyncChannelFileTool
    upload_image: AsyncChannelFileTool
    discover_resources: AsyncArgsTool
    import_mcp_server: AsyncAgentTool


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def register_extended_tool_executors(
    registry: ToolExecutionRegistry,
    deps: ExtendedToolDependencies,
) -> None:
    async def _read_document(request: ToolExecutionRequest) -> str:
        path = request.arguments.get("path")
        if not path:
            return "❌ Missing required argument 'path' for read_document"
        max_chars = min(int(request.arguments.get("max_chars", 8000)), 20000)
        return await _maybe_await(
            deps.read_document(request.context.workspace, path, max_chars, request.context.tenant_id)
        )

    async def _delete_file(request: ToolExecutionRequest) -> str:
        return deps.delete_file(request.context.workspace, request.arguments.get("path", ""))

    async def _update_trigger(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.update_trigger(request.context.agent_id, request.arguments))

    async def _cancel_trigger(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.cancel_trigger(request.context.agent_id, request.arguments))

    async def _list_triggers(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.list_triggers(request.context.agent_id))

    async def _web_search(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.web_search(request.arguments))

    async def _jina_search(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.jina_search(request.arguments))

    async def _jina_read(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.jina_read(request.arguments))

    async def _send_channel_file(request: ToolExecutionRequest) -> str:
        return await _maybe_await(
            deps.send_channel_file(request.context.agent_id, request.context.workspace, request.arguments)
        )

    async def _upload_image(request: ToolExecutionRequest) -> str:
        return await _maybe_await(
            deps.upload_image(request.context.agent_id, request.context.workspace, request.arguments)
        )

    async def _discover_resources(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.discover_resources(request.arguments))

    async def _import_mcp_server(request: ToolExecutionRequest) -> str:
        return await _maybe_await(deps.import_mcp_server(request.context.agent_id, request.arguments))

    registry.register("read_document", _read_document)
    registry.register("delete_file", _delete_file)
    registry.register("update_trigger", _update_trigger)
    registry.register("cancel_trigger", _cancel_trigger)
    registry.register("list_triggers", _list_triggers)
    registry.register("web_search", _web_search)
    registry.register("jina_search", _jina_search)
    registry.register("bing_search", _jina_search)
    registry.register("jina_read", _jina_read)
    registry.register("read_webpage", _jina_read)
    registry.register("send_channel_file", _send_channel_file)
    registry.register("upload_image", _upload_image)
    registry.register("discover_resources", _discover_resources)
    registry.register("import_mcp_server", _import_mcp_server)
