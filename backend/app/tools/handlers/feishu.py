"""Feishu tools — wiki, docs, calendar, user search."""

from __future__ import annotations

import logging
import uuid

from app.tools.decorator import ToolMeta, tool

logger = logging.getLogger(__name__)

_FEISHU_NOT_CONFIGURED_MSG = (
    "❌ Feishu/Lark is not configured for this agent. "
    "Ask your admin to set up Feishu App credentials in Enterprise Settings → Channels."
)


async def _check_feishu_configured(agent_id: uuid.UUID) -> bool:
    """Quick pre-check: does this agent's tenant have Feishu credentials?"""
    try:
        from app.services.feishu_service import get_feishu_tenant_token
        token = await get_feishu_tenant_token(agent_id)
        return bool(token)
    except Exception as exc:
        logger.debug("[Feishu] Auth precheck failed for agent %s: %s", agent_id, exc)
        return False


# -- feishu_wiki_list ---------------------------------------------------------

@tool(ToolMeta(
    name="feishu_wiki_list",
    description=(
        "List all sub-pages (child nodes) of a Feishu Wiki (\u77e5\u8bc6\u5e93) page. "
        "Works with wiki URLs like 'https://xxx.feishu.cn/wiki/NodeToken'. "
        "Use this when a wiki page has child pages you need to explore. "
        "Returns titles, node_tokens, and obj_tokens for each sub-page. "
        "Each sub-page can then be read with feishu_doc_read using its node_token."
    ),
    parameters={
        "type": "object",
        "properties": {
            "node_token": {
                "type": "string",
                "description": "Wiki node token from the URL, e.g. 'HrGawgXxLiqoS5kT6pUczya3nEc' from 'https://xxx.feishu.cn/wiki/HrGawgXxLiqoS5kT6pUczya3nEc'",
            },
            "recursive": {
                "type": "boolean",
                "description": "If true, also list sub-pages of sub-pages (up to 2 levels deep). Default false.",
            },
        },
        "required": ["node_token"],
    },
    category="feishu",
    display_name="Feishu Wiki List",
    icon="\U0001f4da",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_wiki_list(agent_id: uuid.UUID, arguments: dict) -> str:
    if not await _check_feishu_configured(agent_id):
        return _FEISHU_NOT_CONFIGURED_MSG
    from app.services.agent_tools import _feishu_wiki_list
    return await _feishu_wiki_list(agent_id, arguments)


# -- feishu_doc_read ----------------------------------------------------------

@tool(ToolMeta(
    name="feishu_doc_read",
    description=(
        "Read the text content of a Feishu document or Wiki page. "
        "Works with both regular docx URLs (https://xxx.feishu.cn/docx/Token) "
        "and Wiki page URLs (https://xxx.feishu.cn/wiki/Token). "
        "Automatically handles wiki node tokens. "
        "If the page has sub-pages, use feishu_wiki_list to list them."
    ),
    parameters={
        "type": "object",
        "properties": {
            "document_token": {
                "type": "string",
                "description": "Feishu document token (from document URL)",
            },
            "max_chars": {
                "type": "integer",
                "description": "Max characters to return (default 6000, max 20000)",
            },
        },
        "required": ["document_token"],
    },
    category="feishu",
    display_name="Feishu Doc Read",
    icon="\U0001f4c4",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_doc_read(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_doc_read
    return await _feishu_doc_read(agent_id, arguments)


# -- feishu_doc_create --------------------------------------------------------

@tool(ToolMeta(
    name="feishu_doc_create",
    description="Create a new Feishu document with a given title. Returns the new document token and URL.",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Document title",
            },
            "folder_token": {
                "type": "string",
                "description": "Optional: parent folder token. Leave empty to create in root My Drive.",
            },
        },
        "required": ["title"],
    },
    category="feishu",
    display_name="Feishu Doc Create",
    icon="\U0001f4dd",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_doc_create(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_doc_create
    return await _feishu_doc_create(agent_id, arguments)


# -- feishu_doc_append --------------------------------------------------------

@tool(ToolMeta(
    name="feishu_doc_append",
    description="Append text content to an existing Feishu document. Content is appended as one or more new paragraphs at the end.",
    parameters={
        "type": "object",
        "properties": {
            "document_token": {
                "type": "string",
                "description": "Feishu document token",
            },
            "content": {
                "type": "string",
                "description": "Text content to append. Supports multiple lines separated by \\n.",
            },
        },
        "required": ["document_token", "content"],
    },
    category="feishu",
    display_name="Feishu Doc Append",
    icon="\u2795",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_doc_append(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_doc_append
    return await _feishu_doc_append(agent_id, arguments)


# -- feishu_doc_share ---------------------------------------------------------

@tool(ToolMeta(
    name="feishu_doc_share",
    description=(
        "Manage Feishu document collaborators and permissions. "
        "Can add or remove collaborators with viewer/editor/full_access roles, "
        "or get the current collaborator list. "
        "Accepts colleague names (auto-searched) or open_ids directly."
    ),
    parameters={
        "type": "object",
        "properties": {
            "document_token": {
                "type": "string",
                "description": "Feishu document token (from feishu_doc_create or doc URL)",
            },
            "action": {
                "type": "string",
                "enum": ["add", "remove", "list"],
                "description": "'add' to grant access, 'remove' to revoke, 'list' to view current collaborators",
            },
            "member_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Colleague names to add/remove, e.g. ['\u8983\u7766', '\u5f20\u4e09']. Auto-searched.",
            },
            "member_open_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Feishu open_ids to add/remove directly (if already known).",
            },
            "permission": {
                "type": "string",
                "enum": ["view", "edit", "full_access"],
                "description": "Permission level: 'view' (read-only), 'edit' (can edit), 'full_access' (can manage). Default: 'edit'",
            },
        },
        "required": ["document_token", "action"],
    },
    category="feishu",
    display_name="Feishu Doc Share",
    icon="\U0001f91d",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_doc_share(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_doc_share
    return await _feishu_doc_share(agent_id, arguments)


# -- feishu_user_search -------------------------------------------------------

@tool(ToolMeta(
    name="feishu_user_search",
    description=(
        "Search for a colleague in the Feishu (Lark) directory by name. "
        "Returns their open_id, email, and department so you can send messages, "
        "invite them to calendar events, or share documents. "
        "Use this whenever you need to find a colleague's Feishu identity."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The colleague's name to search for, e.g. '\u8983\u7766' or '\u5f20\u4e09'",
            },
        },
        "required": ["name"],
    },
    category="feishu",
    display_name="Feishu User Search",
    icon="\U0001f50d",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_user_search(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_user_search
    return await _feishu_user_search(agent_id, arguments)


# -- feishu_calendar_list -----------------------------------------------------

@tool(ToolMeta(
    name="feishu_calendar_list",
    description="\u67e5\u8be2\u98de\u4e66\u65e5\u5386\u3002**\u81ea\u52a8\u8bfb\u53d6\u5f53\u524d\u5bf9\u8bdd\u7528\u6237\u7684\u771f\u5b9e\u5fd9\u788c\u65f6\u6bb5\uff08freebusy\uff09**\uff0c\u540c\u65f6\u5217\u51fa bot \u521b\u5efa\u7684\u65e5\u7a0b\u3002\u7528\u4e8e\u67e5\u8be2\u67d0\u4eba\u662f\u5426\u6709\u7a7a\u3001\u5b89\u6392\u65e5\u7a0b\u65f6\u907f\u5f00\u51b2\u7a81\u3002",
    parameters={
        "type": "object",
        "properties": {
            "start_time": {
                "type": "string",
                "description": "\u67e5\u8be2\u8d77\u59cb\u65f6\u95f4\uff0cISO 8601 \u683c\u5f0f\uff0c\u4f8b\u5982 '2026-03-13T00:00:00+08:00'\u3002\u9ed8\u8ba4\uff1a\u5f53\u524d\u65f6\u95f4\u3002",
            },
            "end_time": {
                "type": "string",
                "description": "\u67e5\u8be2\u622a\u6b62\u65f6\u95f4\uff0cISO 8601 \u683c\u5f0f\u3002\u9ed8\u8ba4\uff1a7\u5929\u540e\u3002",
            },
            "user_open_id": {
                "type": "string",
                "description": "\u8981\u67e5\u8be2 freebusy \u7684\u7528\u6237 open_id\u3002\u4e0d\u586b\u5219\u81ea\u52a8\u4f7f\u7528\u5f53\u524d\u5bf9\u8bdd\u53d1\u9001\u8005\u3002",
            },
            "max_results": {
                "type": "integer",
                "description": "Max events to return (default 20)",
            },
        },
        "required": [],
    },
    category="feishu",
    display_name="Feishu Calendar List",
    icon="\U0001f4c5",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_calendar_list(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_calendar_list
    return await _feishu_calendar_list(agent_id, arguments)


# -- feishu_calendar_create ---------------------------------------------------

@tool(ToolMeta(
    name="feishu_calendar_create",
    description="Create a Feishu calendar event immediately. The current user is automatically invited as attendee \u2014 no email or authorization required. Just provide the title and time.",
    parameters={
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Event title",
            },
            "start_time": {
                "type": "string",
                "description": "Event start in ISO 8601 with timezone, e.g. '2026-03-15T14:00:00+08:00'",
            },
            "end_time": {
                "type": "string",
                "description": "Event end in ISO 8601 with timezone, e.g. '2026-03-15T15:00:00+08:00'",
            },
            "description": {
                "type": "string",
                "description": "Event description or agenda",
            },
            "attendee_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of colleagues to invite, e.g. ['\u8983\u7766', '\u5f20\u4e09']. Will be looked up automatically via feishu_user_search.",
            },
            "attendee_open_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Feishu open_ids to invite directly (if you already have them from feishu_user_search).",
            },
            "attendee_emails": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Additional attendee emails to invite (use attendee_names if you only have the name).",
            },
            "location": {
                "type": "string",
                "description": "Event location or meeting room",
            },
            "timezone": {
                "type": "string",
                "description": "Timezone, e.g. 'Asia/Shanghai'. Defaults to Asia/Shanghai.",
            },
        },
        "required": ["summary", "start_time", "end_time"],
    },
    category="feishu",
    display_name="Feishu Calendar Create",
    icon="\U0001f4c5",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_calendar_create(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_calendar_create
    return await _feishu_calendar_create(agent_id, arguments)


# -- feishu_calendar_update ---------------------------------------------------

@tool(ToolMeta(
    name="feishu_calendar_update",
    description="Update an existing Feishu calendar event. Provide only the fields you want to change.",
    parameters={
        "type": "object",
        "properties": {
            "user_email": {"type": "string", "description": "Calendar owner's email"},
            "event_id": {"type": "string", "description": "Event ID from feishu_calendar_list"},
            "summary": {"type": "string", "description": "New title"},
            "description": {"type": "string", "description": "New description"},
            "start_time": {"type": "string", "description": "New start time (ISO 8601)"},
            "end_time": {"type": "string", "description": "New end time (ISO 8601)"},
            "location": {"type": "string", "description": "New location"},
        },
        "required": ["user_email", "event_id"],
    },
    category="feishu",
    display_name="Feishu Calendar Update",
    icon="\U0001f504",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_calendar_update(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_calendar_update
    return await _feishu_calendar_update(agent_id, arguments)


# -- feishu_calendar_delete ---------------------------------------------------

@tool(ToolMeta(
    name="feishu_calendar_delete",
    description="Delete (cancel) a Feishu calendar event.",
    parameters={
        "type": "object",
        "properties": {
            "user_email": {"type": "string", "description": "Calendar owner's email"},
            "event_id": {"type": "string", "description": "Event ID to delete"},
        },
        "required": ["user_email", "event_id"],
    },
    category="feishu",
    display_name="Feishu Calendar Delete",
    icon="\U0001f5d1",
    pack="feishu_pack",
    adapter="agent_args",
))
async def feishu_calendar_delete(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _feishu_calendar_delete
    return await _feishu_calendar_delete(agent_id, arguments)
