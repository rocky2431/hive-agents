from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_core_tool_executors_validate_and_dispatch():
    from app.tools.executors.core import CoreToolDependencies, register_core_tool_executors
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest

    calls: list[tuple[str, object]] = []

    def list_files(workspace: Path, rel_path: str, tenant_id: str | None) -> str:
        calls.append(("list_files", (workspace, rel_path, tenant_id)))
        return "LIST"

    def read_file(workspace: Path, rel_path: str, tenant_id: str | None) -> str:
        calls.append(("read_file", (workspace, rel_path, tenant_id)))
        return "READ"

    def load_skill(workspace: Path, skill_name: str) -> str:
        calls.append(("load_skill", (workspace, skill_name)))
        return "SKILL"

    def write_file(workspace: Path, rel_path: str, content: str) -> str:
        calls.append(("write_file", (workspace, rel_path, content)))
        return "WRITE"

    def edit_file(workspace: Path, rel_path: str, old_text: str, new_text: str, replace_all: bool) -> str:
        calls.append(("edit_file", (workspace, rel_path, old_text, new_text, replace_all)))
        return "EDIT"

    def glob_search(workspace: Path, pattern: str, root: str) -> str:
        calls.append(("glob_search", (workspace, pattern, root)))
        return "GLOB"

    def grep_search(workspace: Path, pattern: str, root: str, max_results: int) -> str:
        calls.append(("grep_search", (workspace, pattern, root, max_results)))
        return "GREP"

    def tool_search(workspace: Path, query: str) -> str:
        calls.append(("tool_search", (workspace, query)))
        return "TOOL_SEARCH"

    async def execute_code(workspace: Path, arguments: dict) -> str:
        calls.append(("execute_code", (workspace, arguments)))
        return "EXEC"

    async def set_trigger(agent_id, arguments: dict) -> str:
        calls.append(("set_trigger", (agent_id, arguments)))
        return "TRIGGER"

    async def send_feishu_message(agent_id, arguments: dict) -> str:
        calls.append(("send_feishu_message", (agent_id, arguments)))
        return "FEISHU"

    async def send_web_message(agent_id, arguments: dict) -> str:
        calls.append(("send_web_message", (agent_id, arguments)))
        return "WEB"

    async def send_message_to_agent(agent_id, arguments: dict) -> str:
        calls.append(("send_message_to_agent", (agent_id, arguments)))
        return "A2A"

    registry = ToolExecutionRegistry()
    register_core_tool_executors(
        registry,
        CoreToolDependencies(
            list_files=list_files,
            read_file=read_file,
            load_skill=load_skill,
            write_file=write_file,
            edit_file=edit_file,
            glob_search=glob_search,
            grep_search=grep_search,
            tool_search=tool_search,
            execute_code=execute_code,
            set_trigger=set_trigger,
            send_feishu_message=send_feishu_message,
            send_web_message=send_web_message,
            send_message_to_agent=send_message_to_agent,
        ),
    )

    context = ToolExecutionContext(
        agent_id=uuid4(),
        user_id=uuid4(),
        tenant_id="tenant-1",
        workspace=Path("/tmp/ws"),
    )

    assert await registry.try_execute(ToolExecutionRequest("list_files", {"path": "skills"}, context)) == "LIST"
    assert await registry.try_execute(ToolExecutionRequest("read_file", {"path": "soul.md"}, context)) == "READ"
    assert await registry.try_execute(ToolExecutionRequest("load_skill", {"name": "web research"}, context)) == "SKILL"
    assert await registry.try_execute(ToolExecutionRequest("write_file", {"path": "focus.md", "content": "- [ ] item"}, context)) == "WRITE"
    assert await registry.try_execute(ToolExecutionRequest("edit_file", {"path": "focus.md", "old_text": "a", "new_text": "b"}, context)) == "EDIT"
    assert await registry.try_execute(ToolExecutionRequest("glob_search", {"pattern": "**/*.md", "root": "skills"}, context)) == "GLOB"
    assert await registry.try_execute(ToolExecutionRequest("grep_search", {"pattern": "TODO", "root": "workspace", "max_results": 25}, context)) == "GREP"
    assert await registry.try_execute(ToolExecutionRequest("tool_search", {"query": "feishu"}, context)) == "TOOL_SEARCH"
    assert await registry.try_execute(ToolExecutionRequest("execute_code", {"code": "print(1)"}, context)) == "EXEC"
    assert await registry.try_execute(ToolExecutionRequest("set_trigger", {"name": "daily", "type": "cron"}, context)) == "TRIGGER"
    assert await registry.try_execute(ToolExecutionRequest("send_feishu_message", {"member_name": "张三", "message": "hi"}, context)) == "FEISHU"
    assert await registry.try_execute(ToolExecutionRequest("send_web_message", {"username": "rocky", "message": "hi"}, context)) == "WEB"
    assert await registry.try_execute(ToolExecutionRequest("send_message_to_agent", {"target_agent_name": "Morty", "message": "hi"}, context)) == "A2A"
    assert await registry.try_execute(ToolExecutionRequest("unknown_tool", {}, context)) is None

    assert [call[0] for call in calls] == [
        "list_files",
        "read_file",
        "load_skill",
        "write_file",
        "edit_file",
        "glob_search",
        "grep_search",
        "tool_search",
        "execute_code",
        "set_trigger",
        "send_feishu_message",
        "send_web_message",
        "send_message_to_agent",
    ]


@pytest.mark.asyncio
async def test_core_tool_executors_return_validation_errors():
    from app.tools.executors.core import CoreToolDependencies, register_core_tool_executors
    from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest

    registry = ToolExecutionRegistry()
    deps = CoreToolDependencies(
        list_files=lambda *_args, **_kwargs: "unused",
        read_file=lambda *_args, **_kwargs: "unused",
        load_skill=lambda *_args, **_kwargs: "unused",
        write_file=lambda *_args, **_kwargs: "unused",
        edit_file=lambda *_args, **_kwargs: "unused",
        glob_search=lambda *_args, **_kwargs: "unused",
        grep_search=lambda *_args, **_kwargs: "unused",
        tool_search=lambda *_args, **_kwargs: "unused",
        execute_code=lambda *_args, **_kwargs: "unused",
        set_trigger=lambda *_args, **_kwargs: "unused",
        send_feishu_message=lambda *_args, **_kwargs: "unused",
        send_web_message=lambda *_args, **_kwargs: "unused",
        send_message_to_agent=lambda *_args, **_kwargs: "unused",
    )
    register_core_tool_executors(registry, deps)

    context = ToolExecutionContext(
        agent_id=uuid4(),
        user_id=uuid4(),
        tenant_id=None,
        workspace=Path("/tmp/ws"),
    )

    assert await registry.try_execute(ToolExecutionRequest("read_file", {}, context)) == "❌ Missing required argument 'path' for read_file"
    assert await registry.try_execute(ToolExecutionRequest("load_skill", {}, context)) == "❌ Missing required argument 'name' for load_skill"
    assert await registry.try_execute(ToolExecutionRequest("write_file", {"content": "x"}, context)) == (
        "❌ Missing required argument 'path' for write_file. Please provide a file path like 'skills/my-skill/SKILL.md'"
    )
    assert await registry.try_execute(ToolExecutionRequest("write_file", {"path": "focus.md"}, context)) == "❌ Missing required argument 'content' for write_file"
    assert await registry.try_execute(ToolExecutionRequest("edit_file", {"path": "focus.md", "new_text": "x"}, context)) == (
        "❌ Missing required arguments 'path', 'old_text', and 'new_text' for edit_file"
    )
    assert await registry.try_execute(ToolExecutionRequest("glob_search", {}, context)) == "❌ Missing required argument 'pattern' for glob_search"
    assert await registry.try_execute(ToolExecutionRequest("grep_search", {}, context)) == "❌ Missing required argument 'pattern' for grep_search"
