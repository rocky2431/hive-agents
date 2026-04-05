"""Memory system hook handler registration.

Phase 0: logging-only handlers for all memory-related events.
Phase 2+: real extraction / T0 / curation handlers will replace these.
"""

from __future__ import annotations

import logging

from app.runtime.hooks import HookContext, HookEvent, hook_registry

logger = logging.getLogger(__name__)


# ── Logging-only handlers (Phase 0 baseline) ──


async def _log_response_complete(ctx: HookContext) -> None:
    turn = ctx.metadata.get("turn_count", "?")
    logger.info(
        "[Hooks] RESPONSE_COMPLETE: agent=%s source=%s turn=%s",
        ctx.agent_id, ctx.source, turn,
    )


async def _log_session_idle(ctx: HookContext) -> None:
    idle_s = ctx.metadata.get("idle_seconds", "?")
    logger.info(
        "[Hooks] SESSION_IDLE: agent=%s idle=%ss msgs=%d",
        ctx.agent_id, idle_s, len(ctx.messages or []),
    )


async def _log_session_close(ctx: HookContext) -> None:
    reason = ctx.metadata.get("reason", "unknown")
    logger.info(
        "[Hooks] SESSION_CLOSE: agent=%s reason=%s msgs=%d",
        ctx.agent_id, reason, len(ctx.messages or []),
    )


async def _log_session_start(ctx: HookContext) -> None:
    model = ctx.metadata.get("model", "?")
    logger.info(
        "[Hooks] SESSION_START: agent=%s source=%s model=%s",
        ctx.agent_id, ctx.source, model,
    )


async def _log_pre_compaction(ctx: HookContext) -> None:
    trigger = ctx.metadata.get("trigger", "?")
    logger.info(
        "[Hooks] PRE_COMPACTION: agent=%s trigger=%s msgs=%d",
        ctx.agent_id, trigger, len(ctx.messages or []),
    )


async def _log_post_compaction(ctx: HookContext) -> None:
    trigger = ctx.metadata.get("trigger", "?")
    summary_len = len(ctx.metadata.get("summary", ""))
    logger.info(
        "[Hooks] POST_COMPACTION: agent=%s trigger=%s summary_len=%d",
        ctx.agent_id, trigger, summary_len,
    )


async def _log_delegation_end(ctx: HookContext) -> None:
    logger.info("[Hooks] DELEGATION_END: agent=%s", ctx.agent_id)


async def _log_trigger_end(ctx: HookContext) -> None:
    logger.info("[Hooks] TRIGGER_END: agent=%s", ctx.agent_id)


async def _log_heartbeat_tick_end(ctx: HookContext) -> None:
    logger.info("[Hooks] HEARTBEAT_TICK_END: agent=%s", ctx.agent_id)


async def _log_dream_end(ctx: HookContext) -> None:
    logger.info("[Hooks] DREAM_END: agent=%s", ctx.agent_id)


async def _log_memory_extracted(ctx: HookContext) -> None:
    logger.info("[Hooks] MEMORY_EXTRACTED: agent=%s", ctx.agent_id)


def register_memory_hooks() -> None:
    """Register all memory system hook handlers.

    Called from main.py lifespan during startup.
    Phase 0: logging-only handlers.
    Phase 2+: replace with real extraction/T0/curation handlers.
    """
    hook_registry.register(HookEvent.RESPONSE_COMPLETE, _log_response_complete)
    hook_registry.register(HookEvent.SESSION_IDLE, _log_session_idle)
    hook_registry.register(HookEvent.SESSION_CLOSE, _log_session_close)
    hook_registry.register(HookEvent.SESSION_START, _log_session_start)
    hook_registry.register(HookEvent.PRE_COMPACTION, _log_pre_compaction)
    hook_registry.register(HookEvent.POST_COMPACTION, _log_post_compaction)
    hook_registry.register(HookEvent.DELEGATION_END, _log_delegation_end)
    hook_registry.register(HookEvent.TRIGGER_END, _log_trigger_end)
    hook_registry.register(HookEvent.HEARTBEAT_TICK_END, _log_heartbeat_tick_end)
    hook_registry.register(HookEvent.DREAM_END, _log_dream_end)
    hook_registry.register(HookEvent.MEMORY_EXTRACTED, _log_memory_extracted)

    logger.info("[Hooks] Memory system hooks registered: %d handlers", 11)
