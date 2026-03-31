"""Tool pack metadata for minimal-by-default expansion."""

from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class ToolPackSpec:
    name: str
    summary: str
    source: str
    activation_mode: str
    tools: tuple[str, ...]


TOOL_PACKS: tuple[ToolPackSpec, ...] = (
    ToolPackSpec(
        name="web_pack",
        summary="网页搜索与抓取能力，用于公开信息检索与网页内容提取。",
        source="system",
        activation_mode="通过 web research 等 skill 间接激活",
        tools=("web_search", "jina_search", "jina_read"),
    ),
    ToolPackSpec(
        name="feishu_pack",
        summary="飞书消息、文档、日历与用户查询能力。",
        source="channel",
        activation_mode="通过 feishu skill 或已配置飞书渠道后显式使用",
        tools=(
            "send_feishu_message",
            "feishu_user_search",
            "feishu_wiki_list",
            "feishu_doc_read",
            "feishu_doc_create",
            "feishu_doc_append",
            "feishu_doc_share",
            "feishu_calendar_list",
            "feishu_calendar_create",
            "feishu_calendar_update",
            "feishu_calendar_delete",
        ),
    ),
    ToolPackSpec(
        name="plaza_pack",
        summary="共享广场动态浏览、发帖与评论能力，用于人和 agent 的公共协作 feed。",
        source="system",
        activation_mode="作为共享协作广场能力按需激活",
        tools=(
            "plaza_get_new_posts",
            "plaza_create_post",
            "plaza_add_comment",
        ),
    ),
    ToolPackSpec(
        name="mcp_admin_pack",
        summary="MCP 资源发现、导入与资源读取能力。",
        source="mcp",
        activation_mode="通过 tool_search 后显式选择，或 import_mcp_server 激活",
        tools=(
            "discover_resources",
            "import_mcp_server",
            "list_mcp_resources",
            "read_mcp_resource",
        ),
    ),
)


def iter_tool_packs(query: str = "") -> tuple[ToolPackSpec, ...]:
    normalized = query.strip().lower()
    if not normalized:
        return TOOL_PACKS
    return tuple(
        pack
        for pack in TOOL_PACKS
        if normalized in pack.name.lower()
        or normalized in pack.summary.lower()
        or any(normalized in tool.lower() for tool in pack.tools)
    )


def pack_for_name(name: str) -> ToolPackSpec | None:
    for pack in TOOL_PACKS:
        if pack.name == name:
            return pack
    return None


def static_pack_names_for_tool(tool_name: str) -> tuple[str, ...]:
    return tuple(pack.name for pack in TOOL_PACKS if tool_name in pack.tools)


def infer_static_pack_names(tool_names: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    names: list[str] = []
    seen: set[str] = set()
    for tool_name in tool_names:
        for pack_name in static_pack_names_for_tool(tool_name):
            if pack_name not in seen:
                names.append(pack_name)
                seen.add(pack_name)
    return tuple(names)


def make_mcp_server_pack_name(server_name: str | None, server_url: str | None = None) -> str:
    # NOTE: Theoretical collision risk exists when different server names normalize
    # to the same slug (e.g. "my.server" vs "my_server"). Acceptable because MCP
    # server names are typically unique within a tenant and collisions are benign
    # (same pack activated twice is a no-op).
    source = server_name
    if not source and server_url:
        parsed = urlparse(server_url)
        source = parsed.netloc or parsed.path or server_url
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", (source or "server").strip().lower()).strip("-") or "server"
    return f"mcp_server:{normalized}"
