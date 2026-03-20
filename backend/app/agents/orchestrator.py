"""Explicit multi-agent orchestration helpers."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.runtime.invoker import AgentInvocationRequest, invoke_agent
from app.runtime.session import SessionContext

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str] | str]


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
    )
    return await _delegate(request)


async def _delegate(request: AgentDelegationRequest) -> str:
    result = await invoke_agent(
        AgentInvocationRequest(
            model=request.target_model,
            messages=request.conversation_messages,
            memory_messages=request.conversation_messages,
            memory_session_id=request.session_id,
            session_context=SessionContext(
                session_id=request.session_id,
                source="agent",
                channel="agent",
                metadata={"delegation": True},
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
    )
    return result.content or ""
