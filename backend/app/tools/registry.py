"""Central tool registry for compatibility-friendly tool lookup."""

from __future__ import annotations

from collections import OrderedDict
from typing import Iterable

from .types import ToolDefinition


_FILE_SYSTEM = {
    "list_files",
    "read_file",
    "write_file",
    "edit_file",
    "glob_search",
    "grep_search",
    "delete_file",
    "read_document",
    "execute_code",
}
_SKILLS = {"load_skill", "tool_search", "discover_resources", "import_mcp_server"}
_SCHEDULED = {"set_trigger", "update_trigger", "cancel_trigger", "list_triggers"}
_CHANNEL = {"send_feishu_message", "send_web_message", "send_message_to_agent", "send_channel_file"}
_WEB = {"jina_search", "jina_read", "web_search"}


def infer_category(tool_name: str) -> str:
    if tool_name in _FILE_SYSTEM:
        return "File System"
    if tool_name in _SKILLS:
        return "Skills"
    if tool_name in _SCHEDULED:
        return "Scheduled"
    if tool_name in _CHANNEL:
        return "IM Channel"
    if tool_name in _WEB:
        return "Web Search"
    return "System"


class ToolRegistry:
    """Normalized lookup layer over OpenAI-style tool schemas."""

    def __init__(self) -> None:
        self._tools: "OrderedDict[str, ToolDefinition]" = OrderedDict()

    @classmethod
    def from_openai_tools(cls, tools: Iterable[dict]) -> "ToolRegistry":
        registry = cls()
        for tool in tools:
            fn = tool.get("function", {})
            name = fn.get("name")
            if not name:
                continue
            registry.register(ToolDefinition.from_openai_tool(tool, category=infer_category(name)))
        return registry

    def register(self, tool: ToolDefinition) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> ToolDefinition:
        return self._tools[name]

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def values(self) -> list[ToolDefinition]:
        return list(self._tools.values())

    def to_openai_tools(self, names: list[str] | None = None) -> list[dict]:
        if names is None:
            return [tool.to_openai_tool() for tool in self._tools.values()]
        return [self._tools[name].to_openai_tool() for name in names if name in self._tools]
