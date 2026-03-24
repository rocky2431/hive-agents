"""Communication tools — messaging to humans and agents, file sharing, image upload."""

from __future__ import annotations

import uuid
from pathlib import Path

from app.tools.decorator import ToolMeta, tool


# -- send_feishu_message ------------------------------------------------------

@tool(ToolMeta(
    name="send_feishu_message",
    description=(
        "Send a Feishu IM message to a colleague. "
        "You can provide either the colleague's name (will auto-search their open_id) "
        "or their open_id directly. "
        "To contact digital employees use send_message_to_agent instead."
    ),
    parameters={
        "type": "object",
        "properties": {
            "member_name": {
                "type": "string",
                "description": "Recipient's name, e.g. '\u8983\u7766'. Will be looked up automatically.",
            },
            "user_id": {
                "type": "string",
                "description": "Recipient's Feishu user_id (preferred, tenant-stable). Get from feishu_user_search.",
            },
            "open_id": {
                "type": "string",
                "description": "Recipient's Feishu open_id (fallback, per-app). Use user_id instead when available.",
            },
            "message": {
                "type": "string",
                "description": "Message content to send",
            },
        },
        "required": ["message"],
    },
    category="communication",
    display_name="Send Feishu Message",
    icon="\U0001f4e8",
    governance="sensitive",
    pack="feishu_pack",
    adapter="agent_args",
))
async def send_feishu_message(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _send_feishu_message
    return await _send_feishu_message(agent_id, arguments)


# -- send_web_message ---------------------------------------------------------

@tool(ToolMeta(
    name="send_web_message",
    description="Send a message to a user on the Clawith web platform. The message will appear in their web chat history and be pushed in real-time if they are online. Use this to proactively notify web users.",
    parameters={
        "type": "object",
        "properties": {
            "username": {
                "type": "string",
                "description": "Username or display name of the recipient (must be a registered platform user)",
            },
            "message": {
                "type": "string",
                "description": "Message content to send",
            },
        },
        "required": ["username", "message"],
    },
    category="communication",
    display_name="Send Web Message",
    icon="\U0001f4ac",
    adapter="agent_args",
))
async def send_web_message(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _send_web_message
    return await _send_web_message(agent_id, arguments)


# -- send_message_to_agent ----------------------------------------------------

@tool(ToolMeta(
    name="send_message_to_agent",
    description="Send a message to a digital employee colleague and receive a reply. The recipient is another AI agent, not a human. This triggers the recipient's LLM reasoning and returns their response. Suitable for asking questions, delegating tasks, or collaboration. Your relationships.md lists available digital employees under 'Digital Employee Colleagues'.",
    parameters={
        "type": "object",
        "properties": {
            "agent_name": {
                "type": "string",
                "description": "Target digital employee's name",
            },
            "message": {
                "type": "string",
                "description": "Message content to send",
            },
            "msg_type": {
                "type": "string",
                "enum": ["notify", "consult", "task_delegate"],
                "description": "Message type: notify (notification), consult (ask a question), task_delegate (delegate a task). Defaults to notify.",
            },
        },
        "required": ["agent_name", "message"],
    },
    category="communication",
    display_name="Send Message to Agent",
    icon="\U0001f916",
    adapter="agent_args",
))
async def send_message_to_agent(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tools import _send_message_to_agent
    return await _send_message_to_agent(agent_id, arguments)


# -- send_channel_file --------------------------------------------------------

@tool(ToolMeta(
    name="send_channel_file",
    description="Send a file to the user via the current communication channel (Feishu, Slack, Discord, or web). Call this when you have created a file and the user would benefit from receiving it directly. Provide the workspace-relative file path (e.g. workspace/report.md).",
    parameters={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Workspace-relative path to the file, e.g. workspace/report.md",
            },
            "message": {
                "type": "string",
                "description": "Optional message to accompany the file",
            },
        },
        "required": ["file_path"],
    },
    category="communication",
    display_name="Send Channel File",
    icon="\U0001f4ce",
    adapter="agent_workspace_args",
))
async def send_channel_file(agent_id: uuid.UUID, workspace: Path, arguments: dict) -> str:
    from app.services.agent_tools import _send_channel_file
    return await _send_channel_file(agent_id, workspace, arguments)


# -- upload_image -------------------------------------------------------------

@tool(ToolMeta(
    name="upload_image",
    description="Upload an image file from your workspace (or from a public URL) to a cloud CDN and get a permanent public URL. Use this when you need to share images externally, embed them in messages/reports, or make workspace images accessible via URL. Supports common formats: PNG, JPG, GIF, WebP, SVG.",
    parameters={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Workspace-relative path to the image file, e.g. workspace/chart.png or workspace/knowledge_base/diagram.jpg",
            },
            "url": {
                "type": "string",
                "description": "Alternative: a public URL of an image to upload (e.g. https://example.com/photo.jpg). Use this instead of file_path when the image is not in your workspace.",
            },
            "file_name": {
                "type": "string",
                "description": "Optional custom filename for the uploaded image. If omitted, the original filename is used.",
            },
            "folder": {
                "type": "string",
                "description": "Optional CDN folder path, e.g. /agents/reports. Defaults to /clawith.",
            },
        },
    },
    category="communication",
    display_name="Upload Image",
    icon="\U0001f5bc",
    adapter="agent_workspace_args",
))
async def upload_image(agent_id: uuid.UUID, workspace: Path, arguments: dict) -> str:
    from app.services.agent_tools import _upload_image
    return await _upload_image(agent_id, workspace, arguments)
