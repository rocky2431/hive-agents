"""Runtime service for governed tool execution."""

from __future__ import annotations

import asyncio
import inspect
import json as _json
import logging
import traceback
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.tools.governance import EventCallback, GovernanceDependencies, ToolGovernanceContext
from app.tools.runtime import ToolExecutionContext, ToolExecutionRegistry, ToolExecutionRequest


RuntimeResolver = Callable[..., Awaitable[ToolExecutionContext] | ToolExecutionContext]
GovernanceRunner = Callable[
    [ToolGovernanceContext, GovernanceDependencies],
    Awaitable[str | None] | str | None,
]
FallbackExecutor = Callable[[str, dict, ToolExecutionContext], Awaitable[str] | str]
ActivityLogger = Callable[..., Awaitable[None] | None]
EnsureRegistry = Callable[[], None]


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


@dataclass(slots=True)
class ToolRuntimeService:
    runtime_resolver: Any
    governance_resolver: Any
    registry: ToolExecutionRegistry
    ensure_registry: EnsureRegistry
    governance_runner: Callable[..., Awaitable[str | None] | str | None]
    fallback_executor: FallbackExecutor
    direct_fallback_executor: FallbackExecutor
    activity_logger: ActivityLogger | None = None

    async def execute(
        self,
        tool_name: str,
        arguments: dict,
        *,
        agent_id: uuid.UUID,
        user_id: uuid.UUID,
        event_callback: EventCallback | None = None,
    ) -> str:
        runtime_context = await self.runtime_resolver.resolve(agent_id=agent_id, user_id=user_id)
        governance_context = await self.governance_resolver.build_context(
            runtime_context=runtime_context,
            tool_name=tool_name,
            arguments=arguments,
        )
        governance_dependencies = self.governance_resolver.build_dependencies()
        governance_block = await _maybe_await(
            self.governance_runner(
                governance_context,
                governance_dependencies,
                event_callback=event_callback,
            )
        )
        if governance_block:
            return governance_block

        _TOOL_TIMEOUTS: dict[str, float] = {
            "execute_code": 120.0,
            "create_digital_employee": 120.0,
            "jina_read": 60.0,
            "web_search": 60.0,
            "read_document": 60.0,
            "send_feishu_message": 45.0,
            "feishu_doc_read": 45.0,
            "feishu_wiki_read": 45.0,
        }
        timeout_seconds = _TOOL_TIMEOUTS.get(tool_name, 30.0)
        try:
            result = await asyncio.wait_for(
                self.execute_with_context(tool_name, arguments, runtime_context),
                timeout=timeout_seconds,
            )
            if self.activity_logger and tool_name not in ("list_files", "read_file", "read_document"):
                await _maybe_await(
                    self.activity_logger(
                        agent_id,
                        "tool_call",
                        f"Called tool {tool_name}: {result[:80]}",
                        detail={
                            "tool": tool_name,
                            "args": {k: (_json.dumps(v, ensure_ascii=False, default=str)[:100] if isinstance(v, (dict, list)) else str(v)[:100]) for k, v in arguments.items()},
                            "result": result[:300],
                        },
                    )
                )
            return result
        except asyncio.TimeoutError:
            return f"[Tool Timeout] {tool_name} exceeded {int(timeout_seconds)} second time limit. Try a simpler operation."
        except Exception as exc:
            traceback.print_exc()
            return f"Tool execution error ({tool_name}): {type(exc).__name__}: {str(exc)[:500]}\n\nHint: Check tool arguments and try again with simpler input."

    async def execute_direct(
        self,
        tool_name: str,
        arguments: dict,
        *,
        agent_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> str:
        """Execute a tool after approval, with basic validation.

        Governance is intentionally skipped (approval already granted), but
        we validate the tool exists and log the execution for audit.
        """
        _logger = logging.getLogger(__name__)

        self.ensure_registry()

        resolved_user_id = user_id or agent_id
        _logger.info("[ToolService] execute_direct: tool=%s agent=%s user=%s", tool_name, agent_id, resolved_user_id)

        runtime_context = await self.runtime_resolver.resolve(agent_id=agent_id, user_id=resolved_user_id)
        try:
            direct_result = await _maybe_await(
                self.registry.try_execute(
                    ToolExecutionRequest(
                        tool_name=tool_name,
                        arguments=arguments,
                        context=runtime_context,
                    )
                )
            )
            if direct_result is not None:
                result = direct_result
            else:
                result = await _maybe_await(self.direct_fallback_executor(tool_name, arguments, runtime_context))
            # Activity log for audit trail (mirrors execute() behavior)
            if self.activity_logger and tool_name not in ("list_files", "read_file", "read_document"):
                try:
                    await _maybe_await(
                        self.activity_logger(
                            agent_id, "tool_call_direct",
                            f"Direct-executed {tool_name}: {result[:80]}",
                            detail={"tool": tool_name, "result": result[:300], "approved": True},
                        )
                    )
                except Exception as _log_err:
                    _logger.warning("[ToolService] Activity logging failed for execute_direct: %s", _log_err)
            return result
        except Exception as exc:
            _logger.error("[ToolService] execute_direct failed: tool=%s agent=%s error=%s", tool_name, agent_id, exc)
            return f"Error executing {tool_name}: {exc}"

    async def execute_with_context(
        self,
        tool_name: str,
        arguments: dict,
        context: ToolExecutionContext,
    ) -> str:
        self.ensure_registry()
        registry_result = await _maybe_await(
            self.registry.try_execute(
                ToolExecutionRequest(
                    tool_name=tool_name,
                    arguments=arguments,
                    context=context,
                )
            )
        )
        if registry_result is not None:
            return registry_result
        return await _maybe_await(self.fallback_executor(tool_name, arguments, context))
