"""Preflight governance checks for tool execution."""

from __future__ import annotations

import inspect
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None] | None]

SENSITIVE_TOOLS = {"send_feishu_message", "send_email", "delete_file", "write_file", "reply_email"}
SAFE_TOOLS = {
    "list_files",
    "read_file",
    "load_skill",
    "jina_search",
    "jina_read",
    "web_search",
    "read_document",
    "list_tasks",
    "get_task",
}
TOOL_AUTONOMY_MAP = {
    "write_file": "write_workspace_files",
    "delete_file": "delete_files",
    "send_feishu_message": "send_feishu_message",
    "send_message_to_agent": "send_feishu_message",
    "web_search": "web_search",
    "execute_code": "execute_code",
}


@dataclass(slots=True)
class ToolGovernanceContext:
    agent_id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: str | None
    tool_name: str
    arguments: dict[str, Any]


@dataclass(slots=True)
class GovernanceDependencies:
    resolve_security_zone: Callable[[uuid.UUID], Awaitable[str] | str]
    check_capability: Callable[[uuid.UUID, uuid.UUID, str], Awaitable[Any] | Any]
    write_audit_event: Callable[..., Awaitable[None] | None]
    check_autonomy: Callable[..., Awaitable[dict] | dict]


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _emit_event(event_callback: EventCallback | None, payload: dict[str, Any]) -> None:
    if event_callback:
        maybe_result = event_callback(payload)
        if maybe_result is not None:
            await _maybe_await(maybe_result)


async def run_tool_governance(
    context: ToolGovernanceContext,
    deps: GovernanceDependencies,
    *,
    event_callback: EventCallback | None = None,
) -> str | None:
    """Run governance checks before tool execution.

    Returns a blocking message when execution should stop, otherwise None.
    """
    try:
        zone = await _maybe_await(deps.resolve_security_zone(context.agent_id))
        zone = zone or "standard"
        if zone == "public" and context.tool_name not in SAFE_TOOLS:
            message = (
                f"🔒 Tool '{context.tool_name}' is blocked — this agent is in the 'public' "
                "security zone and can only use safe read-only tools."
            )
            await _emit_event(event_callback, {
                "type": "permission",
                "tool_name": context.tool_name,
                "status": "blocked",
                "message": message,
                "security_zone": zone,
            })
            return message
        if zone == "restricted" and context.tool_name in SENSITIVE_TOOLS:
            message = (
                f"🔒 Tool '{context.tool_name}' requires approval — this agent is in the "
                "'restricted' security zone. Please ask an admin to approve this action."
            )
            await _emit_event(event_callback, {
                "type": "permission",
                "tool_name": context.tool_name,
                "status": "approval_required",
                "message": message,
                "security_zone": zone,
            })
            return message
    except Exception as exc:
        logger.warning(
            "Security zone check failed for agent %s — blocking sensitive tool %s: %s",
            context.agent_id,
            context.tool_name,
            exc,
        )
        if context.tool_name in SENSITIVE_TOOLS:
            message = (
                f"🔒 Tool '{context.tool_name}' blocked — security zone check failed. "
                "Please retry or contact admin."
            )
            await _emit_event(event_callback, {
                "type": "permission",
                "tool_name": context.tool_name,
                "status": "blocked",
                "message": message,
            })
            return message

    if context.tenant_id:
        try:
            tenant_uuid = uuid.UUID(context.tenant_id)
            cap_result = await _maybe_await(
                deps.check_capability(tenant_uuid, context.agent_id, context.tool_name)
            )
            if getattr(cap_result, "denied", False):
                message = f"🚫 Capability denied: {cap_result.reason}"
                await _maybe_await(
                    deps.write_audit_event(
                        event_type="capability.denied",
                        severity="warn",
                        actor_type="agent",
                        actor_id=context.agent_id,
                        tenant_id=tenant_uuid,
                        action="capability_denied",
                        resource_type="tool",
                        resource_id=None,
                        details={"tool": context.tool_name, "capability": cap_result.capability},
                    )
                )
                await _emit_event(event_callback, {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "capability_denied",
                    "message": message,
                    "capability": cap_result.capability,
                })
                return message
            if getattr(cap_result, "escalate_to_l3", False):
                await _maybe_await(
                    deps.write_audit_event(
                        event_type="capability.escalated",
                        severity="warn",
                        actor_type="agent",
                        actor_id=context.agent_id,
                        tenant_id=tenant_uuid,
                        action="capability_escalated",
                        resource_type="tool",
                        resource_id=None,
                        details={"tool": context.tool_name, "capability": cap_result.capability},
                    )
                )
        except Exception as exc:
            logger.warning("Capability gate check failed for tool %s: %s", context.tool_name, exc)

    action_type = TOOL_AUTONOMY_MAP.get(context.tool_name)
    if action_type:
        try:
            autonomy_kwargs = {
                "agent_id": context.agent_id,
                "user_id": context.user_id,
                "tool_name": context.tool_name,
                "arguments": context.arguments,
            }
            if "action_type" in inspect.signature(deps.check_autonomy).parameters:
                autonomy_kwargs["action_type"] = action_type
            result_check = await _maybe_await(deps.check_autonomy(**autonomy_kwargs))
            if not result_check.get("allowed"):
                level = result_check.get("level", "L3")
                if level == "L3":
                    message = (
                        "⏳ This action requires approval. An approval request has been sent. "
                        f"Please wait for approval before retrying. (Approval ID: {result_check.get('approval_id', 'N/A')})"
                    )
                    await _emit_event(event_callback, {
                        "type": "permission",
                        "tool_name": context.tool_name,
                        "status": "approval_required",
                        "message": message,
                        "approval_id": result_check.get("approval_id"),
                        "autonomy_level": level,
                    })
                    return message
                message = f"❌ Action denied: {result_check.get('message', 'unknown reason')}"
                await _emit_event(event_callback, {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "blocked",
                    "message": message,
                    "autonomy_level": level,
                })
                return message
        except Exception as exc:
            logger.error("[Autonomy] Check failed — blocking as safety measure: %s", exc)
            message = (
                f"⚠️ Autonomy check failed ({exc}). Operation blocked for safety. "
                "Please retry or contact admin."
            )
            await _emit_event(event_callback, {
                "type": "permission",
                "tool_name": context.tool_name,
                "status": "blocked",
                "message": message,
            })
            return message

    return None
