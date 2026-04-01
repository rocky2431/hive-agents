"""Platform-level event bus for agent runtime lifecycle hooks.

Provides a lightweight pub/sub mechanism for tool execution, session lifecycle,
and compaction events. Handlers are async callables registered per event type.

Inspired by Claude Code's 23-event hook system, but starting with the most
critical events and expanding based on demand.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


class HookEvent(StrEnum):
    """Core runtime lifecycle events."""
    PRE_TOOL_USE = "pre_tool_use"
    POST_TOOL_USE = "post_tool_use"
    POST_TOOL_FAILURE = "post_tool_failure"
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    PRE_COMPACTION = "pre_compaction"
    POST_COMPACTION = "post_compaction"
    DELEGATION_START = "delegation_start"
    DELEGATION_END = "delegation_end"
    MEMORY_EXTRACTED = "memory_extracted"


@dataclass(slots=True)
class HookContext:
    """Data passed to every hook handler."""
    event: HookEvent
    agent_id: Any = None
    session_id: str | None = None
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_result: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class HookResult:
    """Optional result from a hook handler."""
    block: bool = False  # If True, block the operation (PreToolUse only)
    reason: str = ""  # Reason for blocking
    modified_args: dict[str, Any] | None = None  # Modified tool args (PreToolUse only)


# Type alias for hook handlers
HookHandler = Callable[[HookContext], Awaitable[HookResult | None] | HookResult | None]


class HookRegistry:
    """Central registry for runtime event hooks.

    Thread-safe for registration (append-only). Handlers execute in registration
    order. PreToolUse handlers can block execution by returning HookResult(block=True).
    """

    def __init__(self) -> None:
        self._handlers: dict[HookEvent, list["HookHandler"]] = {event: [] for event in HookEvent}

    def register(self, event: HookEvent, handler: "HookHandler") -> None:
        """Register a handler for a specific event."""
        self._handlers[event].append(handler)

    def unregister(self, event: HookEvent, handler: "HookHandler") -> None:
        """Remove a specific handler."""
        try:
            self._handlers[event].remove(handler)
        except ValueError:
            logger.debug("[Hooks] Handler not found for %s during unregister", event)

    async def emit(self, ctx: HookContext) -> HookResult | None:
        """Emit an event to all registered handlers.

        For PRE_TOOL_USE: returns first blocking result (short-circuits).
        For all other events: runs all handlers, collects no results.
        """
        handlers = self._handlers.get(ctx.event, [])
        if not handlers:
            return None

        for handler in handlers:
            try:
                result = handler(ctx)
                if asyncio.iscoroutine(result):
                    result = await result

                if isinstance(result, HookResult) and result.block and ctx.event == HookEvent.PRE_TOOL_USE:
                    logger.info(
                        "[Hooks] %s blocked by handler: %s",
                        ctx.tool_name, result.reason,
                    )
                    return result
            except Exception as exc:
                logger.warning(
                    "[Hooks] Handler failed for %s: %s",
                    ctx.event, exc,
                )
        return None

    def handler_count(self, event: HookEvent) -> int:
        return len(self._handlers.get(event, []))

    def clear(self) -> None:
        """Remove all handlers (for testing)."""
        for handlers in self._handlers.values():
            handlers.clear()


# Global singleton — import and use directly
hook_registry = HookRegistry()


async def emit_hook(event: HookEvent, **kwargs: Any) -> HookResult | None:
    """Convenience function to emit a hook event."""
    ctx = HookContext(event=event, **kwargs)
    return await hook_registry.emit(ctx)
