from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_extended_tool_executors_dispatch_expected_dependencies():
    from app.tools.executors.extended import ExtendedToolDependencies, register_extended_tool_executors
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest

    calls: list[tuple[str, object]] = []

    async def read_document(workspace: Path, rel_path: str, max_chars: int, tenant_id: str | None) -> str:
        calls.append(("read_document", (workspace, rel_path, max_chars, tenant_id)))
        return "DOC"

    def delete_file(workspace: Path, rel_path: str) -> str:
        calls.append(("delete_file", (workspace, rel_path)))
        return "DELETE"

    async def update_trigger(agent_id, arguments: dict) -> str:
        calls.append(("update_trigger", (agent_id, arguments)))
        return "UPDATE_TRIGGER"

    async def cancel_trigger(agent_id, arguments: dict) -> str:
        calls.append(("cancel_trigger", (agent_id, arguments)))
        return "CANCEL_TRIGGER"

    async def list_triggers(agent_id) -> str:
        calls.append(("list_triggers", agent_id))
        return "LIST_TRIGGERS"

    async def web_search(arguments: dict) -> str:
        calls.append(("web_search", arguments))
        return "WEB_SEARCH"

    async def jina_search(arguments: dict) -> str:
        calls.append(("jina_search", arguments))
        return "JINA_SEARCH"

    async def jina_read(arguments: dict) -> str:
        calls.append(("jina_read", arguments))
        return "JINA_READ"

    async def send_channel_file(agent_id, workspace: Path, arguments: dict) -> str:
        calls.append(("send_channel_file", (agent_id, workspace, arguments)))
        return "CHANNEL_FILE"

    async def upload_image(agent_id, workspace: Path, arguments: dict) -> str:
        calls.append(("upload_image", (agent_id, workspace, arguments)))
        return "UPLOAD"

    async def discover_resources(arguments: dict) -> str:
        calls.append(("discover_resources", arguments))
        return "DISCOVER"

    async def import_mcp_server(agent_id, arguments: dict) -> str:
        calls.append(("import_mcp_server", (agent_id, arguments)))
        return "IMPORT_MCP"

    registry = ToolExecutionRegistry()
    register_extended_tool_executors(
        registry,
        ExtendedToolDependencies(
            read_document=read_document,
            delete_file=delete_file,
            update_trigger=update_trigger,
            cancel_trigger=cancel_trigger,
            list_triggers=list_triggers,
            web_search=web_search,
            jina_search=jina_search,
            jina_read=jina_read,
            send_channel_file=send_channel_file,
            upload_image=upload_image,
            discover_resources=discover_resources,
            import_mcp_server=import_mcp_server,
        ),
    )

    context = ToolExecutionContext(
        agent_id=uuid4(),
        user_id=uuid4(),
        tenant_id="tenant-1",
        workspace=Path("/tmp/ws"),
    )

    assert await registry.try_execute(ToolExecutionRequest("read_document", {"path": "memo.pdf", "max_chars": 1234}, context)) == "DOC"
    assert await registry.try_execute(ToolExecutionRequest("delete_file", {"path": "tmp.md"}, context)) == "DELETE"
    assert await registry.try_execute(ToolExecutionRequest("update_trigger", {"trigger_id": "1"}, context)) == "UPDATE_TRIGGER"
    assert await registry.try_execute(ToolExecutionRequest("cancel_trigger", {"trigger_id": "1"}, context)) == "CANCEL_TRIGGER"
    assert await registry.try_execute(ToolExecutionRequest("list_triggers", {}, context)) == "LIST_TRIGGERS"
    assert await registry.try_execute(ToolExecutionRequest("web_search", {"query": "agent"}, context)) == "WEB_SEARCH"
    assert await registry.try_execute(ToolExecutionRequest("jina_search", {"query": "agent"}, context)) == "JINA_SEARCH"
    assert await registry.try_execute(ToolExecutionRequest("jina_read", {"url": "https://example.com"}, context)) == "JINA_READ"
    assert await registry.try_execute(ToolExecutionRequest("send_channel_file", {"path": "report.md"}, context)) == "CHANNEL_FILE"
    assert await registry.try_execute(ToolExecutionRequest("upload_image", {"source_path": "a.png"}, context)) == "UPLOAD"
    assert await registry.try_execute(ToolExecutionRequest("discover_resources", {"query": "doc"} , context)) == "DISCOVER"
    assert await registry.try_execute(ToolExecutionRequest("import_mcp_server", {"name": "rovo"}, context)) == "IMPORT_MCP"

    assert [call[0] for call in calls] == [
        "read_document",
        "delete_file",
        "update_trigger",
        "cancel_trigger",
        "list_triggers",
        "web_search",
        "jina_search",
        "jina_read",
        "send_channel_file",
        "upload_image",
        "discover_resources",
        "import_mcp_server",
    ]


@pytest.mark.asyncio
async def test_extended_tool_executors_validate_read_document_arguments():
    from app.tools.executors.extended import ExtendedToolDependencies, register_extended_tool_executors
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest

    registry = ToolExecutionRegistry()
    register_extended_tool_executors(
        registry,
        ExtendedToolDependencies(
            read_document=lambda *_args, **_kwargs: "unused",
            delete_file=lambda *_args, **_kwargs: "unused",
            update_trigger=lambda *_args, **_kwargs: "unused",
            cancel_trigger=lambda *_args, **_kwargs: "unused",
            list_triggers=lambda *_args, **_kwargs: "unused",
            web_search=lambda *_args, **_kwargs: "unused",
            jina_search=lambda *_args, **_kwargs: "unused",
            jina_read=lambda *_args, **_kwargs: "unused",
            send_channel_file=lambda *_args, **_kwargs: "unused",
            upload_image=lambda *_args, **_kwargs: "unused",
            discover_resources=lambda *_args, **_kwargs: "unused",
            import_mcp_server=lambda *_args, **_kwargs: "unused",
        ),
    )

    context = ToolExecutionContext(
        agent_id=uuid4(),
        user_id=uuid4(),
        tenant_id=None,
        workspace=Path("/tmp/ws"),
    )

    assert await registry.try_execute(ToolExecutionRequest("read_document", {}, context)) == "❌ Missing required argument 'path' for read_document"
