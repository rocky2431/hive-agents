"""Preflight governance checks for tool execution."""

from __future__ import annotations

import inspect
import logging
import uuid
from collections.abc import Iterator, Set
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None] | None]

_STATIC_SENSITIVE_TOOLS = {
    "send_feishu_message",
    "send_email",
    "delete_file",
    "write_file",
    "reply_email",
    "execute_code",
    "set_trigger",
    "import_mcp_server",
    "send_message_to_agent",
}
_STATIC_SAFE_TOOLS = {
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


def _resolve_collected_governance_names() -> tuple[frozenset[str], frozenset[str]]:
    from app.tools.collector import collect_tools

    collected = collect_tools()
    return collected.safe_tools, collected.sensitive_tools


class _LazyToolNameSet(Set[str]):
    def __init__(self, static_names: set[str], kind: str) -> None:
        self._static_names = frozenset(static_names)
        self._kind = kind
        self._resolved: frozenset[str] | None = None

    def _ensure(self) -> frozenset[str]:
        if self._resolved is None:
            safe, sensitive = _resolve_collected_governance_names()
            dynamic = safe if self._kind == "safe" else sensitive
            self._resolved = frozenset(set(self._static_names) | set(dynamic))
        return self._resolved

    def __contains__(self, item: object) -> bool:
        return item in self._ensure()

    def __iter__(self) -> Iterator[str]:
        return iter(self._ensure())

    def __len__(self) -> int:
        return len(self._ensure())

    def __repr__(self) -> str:
        return repr(self._ensure())


SAFE_TOOLS: Set[str] = _LazyToolNameSet(_STATIC_SAFE_TOOLS, "safe")
SENSITIVE_TOOLS: Set[str] = _LazyToolNameSet(_STATIC_SENSITIVE_TOOLS, "sensitive")


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
    request_approval: Callable[..., Awaitable[dict] | dict]


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
            await _emit_event(
                event_callback,
                {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "blocked",
                    "message": message,
                    "security_zone": zone,
                },
            )
            return message
        if zone == "restricted" and context.tool_name in SENSITIVE_TOOLS:
            message = (
                f"🔒 Tool '{context.tool_name}' requires approval — this agent is in the "
                "'restricted' security zone. Please ask an admin to approve this action."
            )
            await _emit_event(
                event_callback,
                {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "approval_required",
                    "message": message,
                    "security_zone": zone,
                },
            )
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
                f"🔒 Tool '{context.tool_name}' blocked — security zone check failed. Please retry or contact admin."
            )
            await _emit_event(
                event_callback,
                {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "blocked",
                    "message": message,
                },
            )
            return message

    if context.tenant_id:
        try:
            tenant_uuid = uuid.UUID(context.tenant_id)
            cap_result = await _maybe_await(deps.check_capability(tenant_uuid, context.agent_id, context.tool_name))
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
                await _emit_event(
                    event_callback,
                    {
                        "type": "permission",
                        "tool_name": context.tool_name,
                        "status": "capability_denied",
                        "message": message,
                        "capability": cap_result.capability,
                    },
                )
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
            _escalated_capability = (
                getattr(cap_result, "capability", None) if getattr(cap_result, "escalate_to_l3", False) else None
            )
        except Exception as exc:
            _escalated_capability = None
            logger.warning("Capability gate check failed for tool %s: %s", context.tool_name, exc)
    else:
        _escalated_capability = None

    if _escalated_capability:
        try:
            result_check = await _maybe_await(
                deps.request_approval(
                    agent_id=context.agent_id,
                    user_id=context.user_id,
                    tool_name=context.tool_name,
                    arguments=context.arguments,
                    capability=_escalated_capability,
                )
            )
            message = (
                "⏳ This action requires approval. An approval request has been sent. "
                f"Please wait for approval before retrying. (Approval ID: {result_check.get('approval_id', 'N/A')})"
            )
            await _emit_event(
                event_callback,
                {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "approval_required",
                    "message": message,
                    "approval_id": result_check.get("approval_id"),
                    "capability": _escalated_capability,
                },
            )
            return message
        except Exception as exc:
            logger.error("[Approval] Request failed — blocking as safety measure: %s", exc)
            message = f"⚠️ Approval request failed ({exc}). Operation blocked for safety. Please retry or contact admin."
            await _emit_event(
                event_callback,
                {
                    "type": "permission",
                    "tool_name": context.tool_name,
                    "status": "blocked",
                    "message": message,
                    "capability": _escalated_capability,
                },
            )
            return message

    return None
