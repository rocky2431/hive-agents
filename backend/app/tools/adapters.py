"""Adapter layer bridging ToolExecutionRequest → handler native signatures.

Each tool declares an `adapter` string in its ToolMeta. The adapter extracts
the right arguments from the generic ToolExecutionRequest and calls the handler.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable

from app.tools.decorator import ToolMeta
from app.tools.runtime import ToolExecutionRequest


async def adapt_and_call(
    meta: ToolMeta,
    fn: Callable[..., Any],
    request: ToolExecutionRequest,
) -> str:
    """Route from ToolExecutionRequest to the handler's native signature."""
    match meta.adapter:
        case "request":
            result = fn(request)
        case "args_only":
            result = fn(request.arguments)
        case "agent_args":
            result = fn(request.context.agent_id, request.arguments)
        case "agent_only":
            result = fn(request.context.agent_id)
        case "agent_workspace_args":
            result = fn(request.context.agent_id, request.context.workspace, request.arguments)
        case "workspace_args":
            result = fn(request.context.workspace, request.arguments, request.context.tenant_id)
        case _:
            raise ValueError(f"Unknown adapter type: {meta.adapter!r} for tool {meta.name!r}")

    if inspect.isawaitable(result):
        result = await result
    # Enforce str return type — tools must return strings for LLM consumption
    if not isinstance(result, str):
        if result is None:
            return "[Tool returned no output]"
        # Serialize dicts/lists as JSON instead of Python repr
        if isinstance(result, (dict, list)):
            import json
            return json.dumps(result, ensure_ascii=False, default=str)
        return str(result)
    return result
