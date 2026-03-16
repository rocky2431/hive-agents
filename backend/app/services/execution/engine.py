"""Agent execution engine — middleware-wrapped tool loop.

Replaces the monolithic call_llm function in websocket.py with a composable,
middleware-driven execution model inspired by deer-flow's architecture.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ── Callbacks for real-time streaming ──────────────────────

@dataclass
class ExecutionCallbacks:
    """Callbacks for streaming execution events to the client."""

    on_chunk: Callable[[str], Coroutine] | None = None           # Text delta
    on_tool_call: Callable[[str, dict, str], Coroutine] | None = None  # name, args, status
    on_thinking: Callable[[str], Coroutine] | None = None        # Reasoning delta
    on_info: Callable[[str], Coroutine] | None = None            # Info messages
    on_progress: Callable[[str, float, str], Coroutine] | None = None  # tool, progress, message


# ── Execution state shared across middleware ───────────────

@dataclass
class ExecutionState:
    """Mutable context passed through the middleware chain."""

    agent_id: uuid.UUID
    tenant_id: uuid.UUID | None
    user_id: uuid.UUID | None
    messages: list[dict]              # Full conversation [{role, content, ...}]
    tools: list[dict]                 # Available tool definitions
    system_prompt: str                # Assembled system prompt
    llm_config: dict                  # provider, model, api_key, base_url, etc.
    fallback_llm_config: dict | None = None
    round_number: int = 0
    max_rounds: int = 30
    accumulated_tokens: int = 0
    context_budget: int = 8000        # Max tokens for context window
    metadata: dict[str, Any] = field(default_factory=dict)  # Middleware storage
    callbacks: ExecutionCallbacks = field(default_factory=ExecutionCallbacks)
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)


# ── Middleware protocol ────────────────────────────────────

@runtime_checkable
class AgentMiddleware(Protocol):
    """Composable middleware for agent execution.

    Each method is optional (defaults to no-op).
    Middleware is called in order for before_agent/after_tool_call,
    and in reverse order for after_agent/on_error.
    """

    async def before_agent(self, state: ExecutionState) -> ExecutionState | None:
        """Called before LLM invocation. Can modify state or short-circuit (return None to skip)."""
        ...

    async def after_tool_call(
        self, state: ExecutionState, tool_name: str, tool_args: dict, result: str,
    ) -> str | None:
        """Called after each tool execution. Return modified result or None for unchanged."""
        ...

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        """Called after LLM produces final response. For async side effects."""
        ...

    async def on_error(self, state: ExecutionState, error: Exception) -> str | None:
        """Called on error. Return string to substitute response, None to re-raise."""
        ...


class BaseMiddleware:
    """No-op base class for middleware — override only the hooks you need."""

    async def before_agent(self, state: ExecutionState) -> ExecutionState | None:
        return state

    async def after_tool_call(
        self, state: ExecutionState, tool_name: str, tool_args: dict, result: str,
    ) -> str | None:
        return None

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        pass

    async def on_error(self, state: ExecutionState, error: Exception) -> str | None:
        return None


# ── Execution engine ───────────────────────────────────────

class AgentExecutionEngine:
    """Middleware-wrapped agent execution loop.

    Usage:
        engine = AgentExecutionEngine(middlewares=[...])
        result = await engine.execute(state)
    """

    def __init__(self, middlewares: list[BaseMiddleware] | None = None) -> None:
        self.middlewares = middlewares or []

    async def execute(self, state: ExecutionState) -> str:
        """Run the agent execution loop with middleware hooks.

        Returns the final assistant response content.
        """
        from app.services.llm_client import create_llm_client

        # Run before_agent hooks
        for mw in self.middlewares:
            result = await mw.before_agent(state)
            if result is None:
                logger.info("Middleware %s short-circuited execution", type(mw).__name__)
                return ""
            state = result

        # Create LLM client
        client = create_llm_client(**state.llm_config)
        final_content = ""

        try:
            for round_i in range(state.max_rounds):
                if state.cancelled.is_set():
                    logger.info("Execution cancelled for agent %s at round %d", state.agent_id, round_i)
                    break

                state.round_number = round_i

                # Call LLM
                response = await client.chat(
                    messages=[{"role": "system", "content": state.system_prompt}] + state.messages,
                    tools=state.tools if state.tools else None,
                )

                # Extract content and tool calls
                content = response.get("content", "")
                tool_calls = response.get("tool_calls", [])

                if content and state.callbacks.on_chunk:
                    await state.callbacks.on_chunk(content)

                # No tool calls — we're done
                if not tool_calls:
                    final_content = content
                    break

                # Process tool calls
                state.messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})

                for tc in tool_calls:
                    tool_name = tc.get("function", {}).get("name", "")
                    tool_args = tc.get("function", {}).get("arguments", {})
                    tool_id = tc.get("id", "")

                    if state.callbacks.on_tool_call:
                        await state.callbacks.on_tool_call(tool_name, tool_args, "running")

                    # Execute tool (placeholder — wired to existing execute_tool in websocket.py)
                    from app.services.agent_tools import execute_tool
                    tool_result = await execute_tool(
                        tool_name, tool_args,
                        agent_id=state.agent_id,
                        user_id=state.user_id,
                    )

                    # Run after_tool_call hooks
                    for mw in self.middlewares:
                        modified = await mw.after_tool_call(state, tool_name, tool_args, tool_result)
                        if modified is not None:
                            tool_result = modified

                    if state.callbacks.on_tool_call:
                        await state.callbacks.on_tool_call(tool_name, tool_args, "done")

                    state.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": tool_result,
                    })

                # Track tokens
                usage = response.get("usage", {})
                state.accumulated_tokens += usage.get("total_tokens", 0)
            else:
                final_content = content if content else "I've reached the maximum number of tool call rounds."

        except Exception as e:
            # Run on_error hooks (reverse order)
            for mw in reversed(self.middlewares):
                recovery = await mw.on_error(state, e)
                if recovery is not None:
                    final_content = recovery
                    break
            else:
                raise

        # Run after_agent hooks
        for mw in self.middlewares:
            await mw.after_agent(state, final_content)

        return final_content
