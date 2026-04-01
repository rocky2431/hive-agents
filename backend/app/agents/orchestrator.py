"""Explicit multi-agent orchestration helpers."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext
from app.services.runtime_task_service import (
    create_runtime_task_record,
    get_runtime_task_record,
    update_runtime_task_record,
)

logger = logging.getLogger(__name__)

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str] | str]


@dataclass(slots=True)
class OrchestrationPolicy:
    max_depth: int = 2
    timeout_seconds: float = 30.0


# ── Async delegation registry (in-process, per-worker) ──────────────
_async_tasks: dict[str, asyncio.Task[AgentDelegationResult]] = {}
_MAX_TRACKED_TASKS = 200


def _maybe_uuid(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def _persist_delegation_event(
    *,
    task_id: str,
    status: str,
    parent_agent_id: str | uuid.UUID | None = None,
    child_agent_name: str | None = None,
    trace_id: str | None = None,
    result_preview: str = "",
    timed_out: bool = False,
) -> None:
    """Fire-and-forget persistence of delegation lifecycle events via activity logger."""
    if not parent_agent_id:
        return
    try:
        from app.services.activity_logger import log_activity
        detail: dict[str, Any] = {
            "task_id": task_id,
            "status": status,
            "trace_id": trace_id or "",
            "child_agent": child_agent_name or "",
            "timed_out": timed_out,
        }
        if result_preview:
            detail["result_preview"] = result_preview
        # Fire-and-forget async logging from sync context
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(log_activity(
                agent_id=uuid.UUID(str(parent_agent_id)),
                action_type="delegation_" + status,
                summary="Delegation " + status + ": " + (child_agent_name or task_id),
                detail=detail,
            ))
        except RuntimeError:
            logger.debug("[Orchestrator] No running event loop — delegation persistence skipped")
    except Exception as _persist_err:
        logger.debug("[Orchestrator] Delegation persistence failed: %s", _persist_err)


def _cleanup_stale_tasks() -> None:
    """Remove completed tasks that haven't been checked, to prevent unbounded growth."""
    if len(_async_tasks) <= _MAX_TRACKED_TASKS:
        return
    stale = [tid for tid, task in _async_tasks.items() if task.done()]
    for tid in stale:
        _async_tasks.pop(tid, None)
    if len(_async_tasks) > _MAX_TRACKED_TASKS:
        logger.warning("[Orchestrator] %d active async tasks exceeds cap %d", len(_async_tasks), _MAX_TRACKED_TASKS)


@dataclass(slots=True)
class AsyncDelegationHandle:
    task_id: str
    trace_id: str
    target_name: str


@dataclass(slots=True)
class AgentDelegationRequest:
    target: Any
    target_model: Any
    conversation_messages: list[dict]
    owner_id: uuid.UUID
    session_id: str
    tool_executor: ToolExecutor | None = None
    system_prompt_suffix: str = ""
    max_tool_rounds: int | None = None
    parent_agent_id: str | uuid.UUID | None = None
    parent_session_id: str | None = None
    trace_id: str | None = None
    depth: int = 1
    policy: OrchestrationPolicy = field(default_factory=OrchestrationPolicy)


@dataclass(slots=True)
class AgentDelegationResult:
    content: str
    child_session_id: str
    trace_id: str
    depth: int
    timed_out: bool = False
    depth_limited: bool = False
    failed: bool = False


async def delegate_to_agent(
    *,
    target: Any,
    target_model: Any,
    conversation_messages: list[dict],
    owner_id: uuid.UUID,
    session_id: str,
    tool_executor: ToolExecutor | None = None,
    system_prompt_suffix: str = "",
    max_tool_rounds: int | None = None,
    parent_agent_id: str | uuid.UUID | None = None,
    parent_session_id: str | None = None,
    trace_id: str | None = None,
    depth: int = 1,
    policy: OrchestrationPolicy | None = None,
) -> str:
    """Delegate one conversational turn to another agent through the runtime."""
    request = AgentDelegationRequest(
        target=target,
        target_model=target_model,
        conversation_messages=conversation_messages,
        owner_id=owner_id,
        session_id=session_id,
        tool_executor=tool_executor,
        system_prompt_suffix=system_prompt_suffix,
        max_tool_rounds=max_tool_rounds,
        parent_agent_id=parent_agent_id,
        parent_session_id=parent_session_id,
        trace_id=trace_id,
        depth=depth,
        policy=policy or OrchestrationPolicy(),
    )
    result = await _delegate(request)
    return result.content


async def _delegate(request: AgentDelegationRequest) -> AgentDelegationResult:
    trace_id = request.trace_id or uuid.uuid4().hex
    child_session_id = request.session_id or uuid.uuid4().hex

    if request.depth > request.policy.max_depth:
        return AgentDelegationResult(
            content=(
                f"⚠️ Delegation depth limit reached ({request.depth}/{request.policy.max_depth}). "
                "Refine the request instead of delegating further."
            ),
            child_session_id=child_session_id,
            trace_id=trace_id,
            depth=request.depth,
            depth_limited=True,
            failed=True,
        )

    invocation = AgentInvocationRequest(
        model=request.target_model,
        messages=request.conversation_messages,
        memory_messages=request.conversation_messages,
        memory_session_id=child_session_id,
        session_context=SessionContext(
            session_id=child_session_id,
            source="agent",
            channel="agent",
            metadata={
                "delegation": True,
                "delegation_depth": request.depth,
                "delegation_trace_id": trace_id,
                "delegation_parent_agent_id": (
                    str(request.parent_agent_id) if request.parent_agent_id is not None else None
                ),
                "delegation_parent_session_id": request.parent_session_id,
            },
        ),
        agent_name=request.target.name,
        role_description=request.target.role_description or "",
        agent_id=request.target.id,
        user_id=request.owner_id,
        system_prompt_suffix=request.system_prompt_suffix,
        tool_executor=request.tool_executor,
        core_tools_only=True,
        max_tool_rounds=request.max_tool_rounds,
    )

    try:
        result = await asyncio.wait_for(
            invoke_agent(invocation),
            timeout=max(request.policy.timeout_seconds, 0.01),
        )
    except asyncio.TimeoutError:
        return AgentDelegationResult(
            content=(
                f"⚠️ Delegation to {request.target.name} timed out after "
                f"{request.policy.timeout_seconds:.2f}s."
            ),
            child_session_id=child_session_id,
            trace_id=trace_id,
            depth=request.depth,
            timed_out=True,
            failed=True,
        )
    except Exception as exc:
        # M-22: Log full stack server-side; return only safe summary to LLM
        logger.error(
            "[Orchestrator] Child agent %s failed (depth=%d, trace=%s): %s",
            request.target.name, request.depth, trace_id, exc, exc_info=True,
        )
        return AgentDelegationResult(
            content=(
                f"⚠️ Delegation to {request.target.name} failed: {type(exc).__name__}: {str(exc)[:300]}\n"
                f"Trace: {trace_id}, depth: {request.depth}"
            ),
            child_session_id=child_session_id,
            trace_id=trace_id,
            depth=request.depth,
            failed=True,
        )

    return AgentDelegationResult(
        content=result.content or "",
        child_session_id=child_session_id,
        trace_id=trace_id,
        depth=request.depth,
    )


# ── Async (non-blocking) delegation ─────────────────────────────────


async def delegate_async(
    *,
    target: Any,
    target_model: Any,
    conversation_messages: list[dict],
    owner_id: uuid.UUID,
    session_id: str,
    tool_executor: ToolExecutor | None = None,
    system_prompt_suffix: str = "",
    max_tool_rounds: int | None = None,
    parent_agent_id: str | uuid.UUID | None = None,
    parent_session_id: str | None = None,
    trace_id: str | None = None,
    depth: int = 1,
    policy: OrchestrationPolicy | None = None,
) -> AsyncDelegationHandle:
    """Launch a child agent in the background and return immediately."""
    _cleanup_stale_tasks()
    request = AgentDelegationRequest(
        target=target,
        target_model=target_model,
        conversation_messages=conversation_messages,
        owner_id=owner_id,
        session_id=session_id,
        tool_executor=tool_executor,
        system_prompt_suffix=system_prompt_suffix,
        max_tool_rounds=max_tool_rounds,
        parent_agent_id=parent_agent_id,
        parent_session_id=parent_session_id,
        trace_id=trace_id,
        depth=depth,
        policy=policy or OrchestrationPolicy(timeout_seconds=120.0),
    )
    task_id = uuid.uuid4().hex
    real_trace_id = trace_id or uuid.uuid4().hex

    try:
        await create_runtime_task_record(
            task_id=task_id,
            task_type="delegation",
            status="running",
            parent_agent_id=_maybe_uuid(parent_agent_id),
            child_agent_id=getattr(target, "id", None),
            child_agent_name=getattr(target, "name", None),
            prompt=conversation_messages[-1].get("content", "") if conversation_messages else None,
            trace_id=real_trace_id,
            parent_session_id=parent_session_id,
            child_session_id=session_id,
            depth=depth,
            metadata_json={
                "message_count": len(conversation_messages),
                "system_prompt_suffix": bool(system_prompt_suffix),
            },
        )
    except Exception as exc:
        logger.warning("[Orchestrator] Failed to create runtime task record %s: %s", task_id, exc)

    async def _run() -> AgentDelegationResult:
        try:
            delegation_result = await _delegate(request)
            try:
                await update_runtime_task_record(
                    task_id,
                    status="failed" if delegation_result.failed else "completed",
                    result_summary=delegation_result.content,
                    trace_id=delegation_result.trace_id,
                    child_session_id=delegation_result.child_session_id,
                    metadata_json={
                        "timed_out": delegation_result.timed_out,
                        "depth_limited": delegation_result.depth_limited,
                    },
                )
            except Exception as exc:
                logger.warning("[Orchestrator] Failed to update runtime task %s: %s", task_id, exc)
            return delegation_result
        except Exception as exc:
            logger.error("[Orchestrator] Async delegation %s failed: %s", task_id, exc)
            try:
                await update_runtime_task_record(
                    task_id,
                    status="failed",
                    result_summary=f"Async task {task_id} failed: {exc}",
                    trace_id=real_trace_id,
                    child_session_id=session_id,
                    metadata_json={"timed_out": False, "depth_limited": False},
                )
            except Exception as update_exc:
                logger.warning("[Orchestrator] Failed to persist runtime task failure %s: %s", task_id, update_exc)
            return AgentDelegationResult(
                content=f"Async task {task_id} failed: {exc}",
                child_session_id=session_id,
                trace_id=real_trace_id,
                depth=depth,
                failed=True,
            )

    task = asyncio.create_task(_run(), name="async-delegation-" + task_id)
    _async_tasks[task_id] = task

    # P1.8: Persist delegation start to activity log for observability
    _persist_delegation_event(
        task_id=task_id,
        parent_agent_id=parent_agent_id,
        child_agent_name=target.name,
        trace_id=real_trace_id,
        status="started",
    )
    logger.info("[Orchestrator] Async delegation started: task_id=%s target=%s", task_id, target.name)
    return AsyncDelegationHandle(task_id=task_id, trace_id=real_trace_id, target_name=target.name)


async def check_async_delegation(task_id: str) -> dict[str, Any]:
    """Check status of an async delegation. Returns status + result if done."""
    task = _async_tasks.get(task_id)
    if task is None:
        try:
            persisted = await get_runtime_task_record(task_id)
        except Exception as exc:
            logger.warning("[Orchestrator] Failed to load runtime task %s: %s", task_id, exc)
            persisted = None
        if persisted is None:
            return {"task_id": task_id, "status": "not_found", "result": None}
        return {
            "task_id": task_id,
            "status": persisted.get("status", "not_found"),
            "result": persisted.get("result"),
            "timed_out": bool((persisted.get("metadata") or {}).get("timed_out", False)),
        }
    if not task.done():
        return {"task_id": task_id, "status": "running", "result": None}
    # Remove completed task from registry after reading
    _async_tasks.pop(task_id, None)
    try:
        delegation_result = task.result()
        # P1.8: Persist delegation completion
        _persist_delegation_event(
            task_id=task_id,
            status="failed" if delegation_result.failed else "completed",
            result_preview=delegation_result.content[:300] if delegation_result.content else "",
            timed_out=delegation_result.timed_out,
        )
        return {
            "task_id": task_id,
            "status": "failed" if delegation_result.failed else "completed",
            "result": delegation_result.content,
            "timed_out": delegation_result.timed_out,
        }
    except Exception as exc:
        _persist_delegation_event(task_id=task_id, status="error", result_preview=str(exc)[:300])
        return {"task_id": task_id, "status": "error", "result": str(exc)}


def list_async_delegations() -> list[dict[str, Any]]:
    """List all tracked async delegations with their status."""
    results: list[dict[str, Any]] = []
    for task_id, task in _async_tasks.items():
        status = "completed" if task.done() else "running"
        results.append({"task_id": task_id, "status": status})
    return results
