from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_integration_tool_executors_dispatch_expected_dependencies():
    from app.tools.executors.integrations import (
        IntegrationToolDependencies,
        register_integration_tool_executors,
    )
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest

    calls: list[tuple[str, object]] = []

    async def manage_tasks(agent_id, user_id, workspace: Path, arguments: dict) -> str:
        calls.append(("manage_tasks", (agent_id, user_id, workspace, arguments)))
        return "TASKS"

    async def plaza_get_new_posts(agent_id, arguments: dict) -> str:
        calls.append(("plaza_get_new_posts", (agent_id, arguments)))
        return "PLAZA_LIST"

    async def plaza_create_post(agent_id, arguments: dict) -> str:
        calls.append(("plaza_create_post", (agent_id, arguments)))
        return "PLAZA_CREATE"

    async def plaza_add_comment(agent_id, arguments: dict) -> str:
        calls.append(("plaza_add_comment", (agent_id, arguments)))
        return "PLAZA_COMMENT"

    async def feishu_wiki_list(agent_id, arguments: dict) -> str:
        calls.append(("feishu_wiki_list", (agent_id, arguments)))
        return "WIKI"

    async def feishu_doc_read(agent_id, arguments: dict) -> str:
        calls.append(("feishu_doc_read", (agent_id, arguments)))
        return "DOC_READ"

    async def feishu_doc_create(agent_id, arguments: dict) -> str:
        calls.append(("feishu_doc_create", (agent_id, arguments)))
        return "DOC_CREATE"

    async def feishu_doc_append(agent_id, arguments: dict) -> str:
        calls.append(("feishu_doc_append", (agent_id, arguments)))
        return "DOC_APPEND"

    async def feishu_doc_share(agent_id, arguments: dict) -> str:
        calls.append(("feishu_doc_share", (agent_id, arguments)))
        return "DOC_SHARE"

    async def feishu_user_search(agent_id, arguments: dict) -> str:
        calls.append(("feishu_user_search", (agent_id, arguments)))
        return "USER_SEARCH"

    async def feishu_calendar_list(agent_id, arguments: dict) -> str:
        calls.append(("feishu_calendar_list", (agent_id, arguments)))
        return "CAL_LIST"

    async def feishu_calendar_create(agent_id, arguments: dict) -> str:
        calls.append(("feishu_calendar_create", (agent_id, arguments)))
        return "CAL_CREATE"

    async def feishu_calendar_update(agent_id, arguments: dict) -> str:
        calls.append(("feishu_calendar_update", (agent_id, arguments)))
        return "CAL_UPDATE"

    async def feishu_calendar_delete(agent_id, arguments: dict) -> str:
        calls.append(("feishu_calendar_delete", (agent_id, arguments)))
        return "CAL_DELETE"

    async def handle_email_tool(tool_name: str, agent_id, workspace: Path, arguments: dict) -> str:
        calls.append(("handle_email_tool", (tool_name, agent_id, workspace, arguments)))
        return "EMAIL"

    async def execute_mcp_tool(tool_name: str, arguments: dict, agent_id=None) -> str:
        calls.append(("execute_mcp_tool", (tool_name, arguments, agent_id)))
        return "MCP"

    registry = ToolExecutionRegistry()
    register_integration_tool_executors(
        registry,
        IntegrationToolDependencies(
            manage_tasks=manage_tasks,
            plaza_get_new_posts=plaza_get_new_posts,
            plaza_create_post=plaza_create_post,
            plaza_add_comment=plaza_add_comment,
            feishu_wiki_list=feishu_wiki_list,
            feishu_doc_read=feishu_doc_read,
            feishu_doc_create=feishu_doc_create,
            feishu_doc_append=feishu_doc_append,
            feishu_doc_share=feishu_doc_share,
            feishu_user_search=feishu_user_search,
            feishu_calendar_list=feishu_calendar_list,
            feishu_calendar_create=feishu_calendar_create,
            feishu_calendar_update=feishu_calendar_update,
            feishu_calendar_delete=feishu_calendar_delete,
            handle_email_tool=handle_email_tool,
            execute_mcp_tool=execute_mcp_tool,
        ),
    )

    context = ToolExecutionContext(
        agent_id=uuid4(),
        user_id=uuid4(),
        tenant_id="tenant-1",
        workspace=Path("/tmp/ws"),
    )

    assert await registry.try_execute(ToolExecutionRequest("manage_tasks", {"action": "list"}, context)) == "TASKS"
    assert await registry.try_execute(ToolExecutionRequest("plaza_get_new_posts", {"limit": 5}, context)) == "PLAZA_LIST"
    assert await registry.try_execute(ToolExecutionRequest("plaza_create_post", {"content": "hi"}, context)) == "PLAZA_CREATE"
    assert await registry.try_execute(ToolExecutionRequest("plaza_add_comment", {"post_id": "1", "content": "ok"}, context)) == "PLAZA_COMMENT"
    assert await registry.try_execute(ToolExecutionRequest("feishu_wiki_list", {"node_token": "n"}, context)) == "WIKI"
    assert await registry.try_execute(ToolExecutionRequest("feishu_doc_read", {"document_token": "d"}, context)) == "DOC_READ"
    assert await registry.try_execute(ToolExecutionRequest("feishu_doc_create", {"title": "doc"}, context)) == "DOC_CREATE"
    assert await registry.try_execute(ToolExecutionRequest("feishu_doc_append", {"document_token": "d", "content": "x"}, context)) == "DOC_APPEND"
    assert await registry.try_execute(ToolExecutionRequest("feishu_doc_share", {"document_token": "d", "email": "a@b.com"}, context)) == "DOC_SHARE"
    assert await registry.try_execute(ToolExecutionRequest("feishu_user_search", {"name": "张三"}, context)) == "USER_SEARCH"
    assert await registry.try_execute(ToolExecutionRequest("feishu_calendar_list", {"days": 7}, context)) == "CAL_LIST"
    assert await registry.try_execute(ToolExecutionRequest("feishu_calendar_create", {"title": "meeting"}, context)) == "CAL_CREATE"
    assert await registry.try_execute(ToolExecutionRequest("feishu_calendar_update", {"event_id": "e"}, context)) == "CAL_UPDATE"
    assert await registry.try_execute(ToolExecutionRequest("feishu_calendar_delete", {"event_id": "e"}, context)) == "CAL_DELETE"
    assert await registry.try_execute(ToolExecutionRequest("send_email", {"to": "a@b.com", "subject": "s"}, context)) == "EMAIL"
    assert await registry.try_execute(ToolExecutionRequest("read_emails", {"folder": "INBOX"}, context)) == "EMAIL"
    assert await registry.try_execute(ToolExecutionRequest("reply_email", {"message_id": "m", "body": "b"}, context)) == "EMAIL"
    assert await registry.try_execute(ToolExecutionRequest("custom_mcp_tool", {"query": "x"}, context)) == "MCP"

    assert [call[0] for call in calls] == [
        "manage_tasks",
        "plaza_get_new_posts",
        "plaza_create_post",
        "plaza_add_comment",
        "feishu_wiki_list",
        "feishu_doc_read",
        "feishu_doc_create",
        "feishu_doc_append",
        "feishu_doc_share",
        "feishu_user_search",
        "feishu_calendar_list",
        "feishu_calendar_create",
        "feishu_calendar_update",
        "feishu_calendar_delete",
        "handle_email_tool",
        "handle_email_tool",
        "handle_email_tool",
        "execute_mcp_tool",
    ]
