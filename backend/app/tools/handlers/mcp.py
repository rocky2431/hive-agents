"""MCP tools — import MCP servers from Smithery registry."""

from __future__ import annotations

import uuid

from app.tools.decorator import ToolMeta, tool


# -- import_mcp_server --------------------------------------------------------

@tool(ToolMeta(
    name="import_mcp_server",
    description="Import an MCP server from Smithery registry into the platform. The server's tools become available for use. Use discover_resources first to find the server ID. If previously imported tools stopped working (e.g. OAuth expired), set reauthorize=true to re-run the authorization flow.",
    parameters={
        "type": "object",
        "properties": {
            "server_id": {
                "type": "string",
                "description": "Smithery server ID, e.g. '@anthropic/brave-search' or '@anthropic/fetch'",
            },
            "config": {
                "type": "object",
                "description": "Optional server configuration (e.g. API keys required by the server)",
            },
            "reauthorize": {
                "type": "boolean",
                "description": "Set to true to force re-authorization of existing tools (e.g. when OAuth token has expired)",
            },
        },
        "required": ["server_id"],
    },
    category="mcp",
    display_name="Import MCP Server",
    icon="\U0001f4e6",
    pack="mcp_admin_pack",
    adapter="agent_args",
))
async def import_mcp_server(agent_id: uuid.UUID, arguments: dict) -> str:
    from app.services.agent_tool_domains.web_mcp import _import_mcp_server
    return await _import_mcp_server(agent_id, arguments)
