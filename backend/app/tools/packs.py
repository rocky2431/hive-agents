"""Tool pack metadata for minimal-by-default expansion."""

from __future__ import annotations

from dataclasses import dataclass


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
        name="email_pack",
        summary="邮件读取、发送与回复能力。",
        source="system",
        activation_mode="通过 email 相关 skill 显式激活",
        tools=("send_email", "read_emails", "reply_email"),
    ),
    ToolPackSpec(
        name="document_pack",
        summary="Office/PDF 文档读取能力。",
        source="system",
        activation_mode="通过文档类 skill 显式激活",
        tools=("read_document",),
    ),
    ToolPackSpec(
        name="image_pack",
        summary="图片上传与图像相关辅助能力。",
        source="system",
        activation_mode="通过图像类 skill 显式激活",
        tools=("upload_image",),
    ),
    ToolPackSpec(
        name="plaza_pack",
        summary="Plaza 内容发布、评论与任务管理能力。",
        source="system",
        activation_mode="通过 plaza skill 显式激活",
        tools=(
            "manage_tasks",
            "plaza_list_posts",
            "plaza_create_post",
            "plaza_get_comments",
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
