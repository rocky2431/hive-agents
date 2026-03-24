"""Filesystem tools — workspace file I/O, search, code execution."""

from __future__ import annotations

from pathlib import Path

from app.tools.decorator import ToolMeta, tool


# -- list_files ---------------------------------------------------------------

@tool(ToolMeta(
    name="list_files",
    description="List files and folders in a directory within my workspace. Can also list enterprise_info/ for shared company information.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory path to list, defaults to root (empty string). e.g.: '', 'skills', 'workspace', 'enterprise_info', 'enterprise_info/knowledge_base'",
            }
        },
    },
    category="filesystem",
    display_name="List Files",
    icon="\U0001f4c2",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    adapter="workspace_args",
))
def list_files(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _list_files
    return _list_files(workspace, arguments.get("path", ""), tenant_id)


# -- read_file ----------------------------------------------------------------

@tool(ToolMeta(
    name="read_file",
    description="Read file contents from the workspace. Can read tasks.json for tasks, soul.md for personality, memory/memory.md for memory, skills/ for skill files, and enterprise_info/ for shared company info.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path, e.g.: tasks.json, soul.md, memory/memory.md, skills/xxx.md, enterprise_info/company_profile.md",
            }
        },
        "required": ["path"],
    },
    category="filesystem",
    display_name="Read File",
    icon="\U0001f4c4",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    adapter="workspace_args",
))
def read_file(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _read_file
    return _read_file(workspace, arguments.get("path", ""), tenant_id)


# -- write_file ---------------------------------------------------------------

@tool(ToolMeta(
    name="write_file",
    description="Write or update a file in the workspace. Can update memory/memory.md, focus.md, task_history.md, create documents in workspace/, create skills in skills/.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path, e.g.: memory/memory.md, workspace/report.md, skills/data_analysis.md",
            },
            "content": {
                "type": "string",
                "description": "File content to write",
            },
        },
        "required": ["path", "content"],
    },
    category="filesystem",
    display_name="Write File",
    icon="\u270f\ufe0f",
    governance="sensitive",
    adapter="workspace_args",
))
def write_file(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _write_file
    return _write_file(workspace, arguments.get("path", ""), arguments.get("content", ""))


# -- edit_file ----------------------------------------------------------------

@tool(ToolMeta(
    name="edit_file",
    description="Edit an existing text file by replacing a specific snippet. Use this for precise changes instead of rewriting the full file.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path to edit, e.g. workspace/report.md or focus.md",
            },
            "old_text": {
                "type": "string",
                "description": "The exact text to replace",
            },
            "new_text": {
                "type": "string",
                "description": "Replacement text",
            },
            "replace_all": {
                "type": "boolean",
                "description": "When true, replace all occurrences instead of exactly one",
            },
        },
        "required": ["path", "old_text", "new_text"],
    },
    category="filesystem",
    display_name="Edit File",
    icon="\u270f\ufe0f",
    adapter="workspace_args",
))
def edit_file(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _edit_file
    return _edit_file(
        workspace,
        arguments.get("path", ""),
        arguments.get("old_text", ""),
        arguments.get("new_text", ""),
        arguments.get("replace_all", False),
    )


# -- glob_search --------------------------------------------------------------

@tool(ToolMeta(
    name="glob_search",
    description="Find files by path pattern inside the workspace. Use this to discover candidate files before reading them.",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob pattern such as '**/*.md' or 'skills/*/SKILL.md'",
            },
            "root": {
                "type": "string",
                "description": "Optional workspace-relative root path to search from",
            },
        },
        "required": ["pattern"],
    },
    category="filesystem",
    display_name="Glob Search",
    icon="\U0001f50e",
    read_only=True,
    parallel_safe=True,
    adapter="workspace_args",
))
def glob_search(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _glob_search
    return _glob_search(workspace, arguments.get("pattern", ""), arguments.get("root", ""))


# -- grep_search --------------------------------------------------------------

@tool(ToolMeta(
    name="grep_search",
    description="Search file contents for a text pattern inside the workspace. Prefer this before opening many files one by one.",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "The text or regex pattern to search for",
            },
            "root": {
                "type": "string",
                "description": "Optional workspace-relative root path to search from",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of matches to return",
            },
        },
        "required": ["pattern"],
    },
    category="filesystem",
    display_name="Grep Search",
    icon="\U0001f50d",
    read_only=True,
    parallel_safe=True,
    adapter="workspace_args",
))
def grep_search(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _grep_search
    return _grep_search(
        workspace,
        arguments.get("pattern", ""),
        arguments.get("root", ""),
        arguments.get("max_results", 50),
    )


# -- delete_file --------------------------------------------------------------

@tool(ToolMeta(
    name="delete_file",
    description="Delete a file from the workspace. Cannot delete soul.md or tasks.json.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path to delete",
            }
        },
        "required": ["path"],
    },
    category="filesystem",
    display_name="Delete File",
    icon="\U0001f5d1",
    governance="sensitive",
    adapter="workspace_args",
))
def delete_file(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _delete_file
    return _delete_file(workspace, arguments.get("path", ""))


# -- read_document ------------------------------------------------------------

@tool(ToolMeta(
    name="read_document",
    description="Read office document contents (PDF, Word, Excel, PPT, etc.) and extract text. Suitable for reading knowledge base documents.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Document file path, e.g.: workspace/knowledge_base/report.pdf, enterprise_info/knowledge_base/policy.docx",
            }
        },
        "required": ["path"],
    },
    category="filesystem",
    display_name="Read Document",
    icon="\U0001f4d1",
    read_only=True,
    parallel_safe=True,
    governance="safe",
    adapter="workspace_args",
))
async def read_document(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tool_domains.workspace import _read_document
    return await _read_document(workspace, arguments.get("path", ""), tenant_id=tenant_id)


# -- execute_code -------------------------------------------------------------

@tool(ToolMeta(
    name="execute_code",
    description="Execute code (Python, Bash, or Node.js) in a sandboxed environment within the agent's workspace directory. Useful for data processing, calculations, file transformations, and automation scripts. Code runs with the workspace as the working directory. Security restrictions apply: no network access commands, no system-level operations, 30-second timeout.",
    parameters={
        "type": "object",
        "properties": {
            "language": {
                "type": "string",
                "enum": ["python", "bash", "node"],
                "description": "Programming language to execute",
            },
            "code": {
                "type": "string",
                "description": "Code to execute. For Python, you can import standard libraries (json, csv, math, re, collections, etc.). Working directory is your workspace/.",
            },
            "timeout": {
                "type": "integer",
                "description": "Max execution time in seconds (default 30, max 60)",
            },
        },
        "required": ["language", "code"],
    },
    category="filesystem",
    display_name="Execute Code",
    icon="\u25b6\ufe0f",
    adapter="workspace_args",
))
async def execute_code(workspace: Path, arguments: dict, tenant_id: str | None = None) -> str:
    from app.services.agent_tools import _execute_code
    return await _execute_code(workspace, arguments)
