"""Integration-oriented tool executors extracted from the legacy dispatcher."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from app.tools.runtime import ToolExecutionRegistry, ToolExecutionRequest


AsyncManageTasksTool = Callable[[object, object, Path, dict], Awaitable[str] | str]
AsyncAgentTool = Callable[[object, dict], Awaitable[str] | str]
AsyncEmailTool = Callable[[str, object, Path, dict], Awaitable[str] | str]
AsyncMcpTool = Callable[[str, dict, object | None], Awaitable[str] | str]


@dataclass(slots=True)
class IntegrationToolDependencies:
    manage_tasks: AsyncManageTasksTool
    plaza_get_new_posts: AsyncAgentTool
    plaza_create_post: AsyncAgentTool
    plaza_add_comment: AsyncAgentTool
    feishu_wiki_list: AsyncAgentTool
    feishu_doc_read: AsyncAgentTool
    feishu_doc_create: AsyncAgentTool
    feishu_doc_append: AsyncAgentTool
    feishu_doc_share: AsyncAgentTool
    feishu_user_search: AsyncAgentTool
    feishu_calendar_list: AsyncAgentTool
    feishu_calendar_create: AsyncAgentTool
    feishu_calendar_update: AsyncAgentTool
    feishu_calendar_delete: AsyncAgentTool
    handle_email_tool: AsyncEmailTool
    execute_mcp_tool: AsyncMcpTool


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def register_integration_tool_executors(
    registry: ToolExecutionRegistry,
    deps: IntegrationToolDependencies,
) -> None:
    async def _manage_tasks(request: ToolExecutionRequest) -> str:
        return await _maybe_await(
            deps.manage_tasks(
                request.context.agent_id,
                request.context.user_id,
                request.context.workspace,
                request.arguments,
            )
        )

    async def _agent_only(dependency: AsyncAgentTool, request: ToolExecutionRequest) -> str:
        return await _maybe_await(dependency(request.context.agent_id, request.arguments))

    async def _send_email_family(request: ToolExecutionRequest) -> str:
        return await _maybe_await(
            deps.handle_email_tool(
                request.tool_name,
                request.context.agent_id,
                request.context.workspace,
                request.arguments,
            )
        )

    async def _mcp_passthrough(request: ToolExecutionRequest) -> str:
        return await _maybe_await(
            deps.execute_mcp_tool(
                request.tool_name,
                request.arguments,
                request.context.agent_id,
            )
        )

    registry.register("manage_tasks", _manage_tasks)
    registry.register("plaza_get_new_posts", lambda request: _agent_only(deps.plaza_get_new_posts, request))
    registry.register("plaza_create_post", lambda request: _agent_only(deps.plaza_create_post, request))
    registry.register("plaza_add_comment", lambda request: _agent_only(deps.plaza_add_comment, request))
    registry.register("feishu_wiki_list", lambda request: _agent_only(deps.feishu_wiki_list, request))
    registry.register("feishu_doc_read", lambda request: _agent_only(deps.feishu_doc_read, request))
    registry.register("feishu_doc_create", lambda request: _agent_only(deps.feishu_doc_create, request))
    registry.register("feishu_doc_append", lambda request: _agent_only(deps.feishu_doc_append, request))
    registry.register("feishu_doc_share", lambda request: _agent_only(deps.feishu_doc_share, request))
    registry.register("feishu_user_search", lambda request: _agent_only(deps.feishu_user_search, request))
    registry.register("feishu_calendar_list", lambda request: _agent_only(deps.feishu_calendar_list, request))
    registry.register("feishu_calendar_create", lambda request: _agent_only(deps.feishu_calendar_create, request))
    registry.register("feishu_calendar_update", lambda request: _agent_only(deps.feishu_calendar_update, request))
    registry.register("feishu_calendar_delete", lambda request: _agent_only(deps.feishu_calendar_delete, request))
    registry.register("send_email", _send_email_family)
    registry.register("read_emails", _send_email_family)
    registry.register("reply_email", _send_email_family)
    registry.register("__mcp_fallback__", _mcp_passthrough)
