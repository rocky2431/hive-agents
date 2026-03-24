"""Explicit multi-agent orchestration helpers."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext

logger = logging.getLogger(__name__)

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str] | str]


@dataclass(slots=True)
class OrchestrationPolicy:
    max_depth: int = 2
    timeout_seconds: float = 30.0


# ── Async delegation registry (in-process, per-worker) ──────────────
_async_tasks: dict[str, asyncio.Task[AgentDelegationResult]] = {}


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

    async def _run() -> AgentDelegationResult:
        try:
            return await _delegate(request)
        except Exception as exc:
            logger.error("[Orchestrator] Async delegation %s failed: %s", task_id, exc)
            return AgentDelegationResult(
                content=f"Async task {task_id} failed: {exc}",
                child_session_id=session_id,
                trace_id=real_trace_id,
                depth=depth,
            )

    task = asyncio.create_task(_run(), name=f"async-delegation-{task_id}")
    _async_tasks[task_id] = task
    logger.info("[Orchestrator] Async delegation started: task_id=%s target=%s", task_id, target.name)
    return AsyncDelegationHandle(task_id=task_id, trace_id=real_trace_id, target_name=target.name)


async def check_async_delegation(task_id: str) -> dict[str, Any]:
    """Check status of an async delegation. Returns status + result if done."""
    task = _async_tasks.get(task_id)
    if task is None:
        return {"task_id": task_id, "status": "not_found", "result": None}
    if not task.done():
        return {"task_id": task_id, "status": "running", "result": None}
    # Remove completed task from registry after reading
    _async_tasks.pop(task_id, None)
    try:
        delegation_result = task.result()
        return {
            "task_id": task_id,
            "status": "completed",
            "result": delegation_result.content,
            "timed_out": delegation_result.timed_out,
        }
    except Exception as exc:
        return {"task_id": task_id, "status": "error", "result": str(exc)}


def list_async_delegations() -> list[dict[str, Any]]:
    """List all tracked async delegations with their status."""
    results: list[dict[str, Any]] = []
    for task_id, task in _async_tasks.items():
        status = "completed" if task.done() else "running"
        results.append({"task_id": task_id, "status": status})
    return results
