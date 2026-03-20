"""Prompt assembly helpers for the unified runtime."""

from __future__ import annotations

import inspect
import uuid
from typing import Awaitable, Callable

from app.runtime.context import RuntimeContext
from app.services.agent_context import build_agent_context
from app.services.knowledge_inject import fetch_relevant_knowledge


BuildAgentContextFn = Callable[[uuid.UUID | None, str, str, str | None], Awaitable[str]]
KnowledgeLookupFn = Callable[[str, uuid.UUID | None], Awaitable[str] | str]


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def _render_active_packs(runtime_context: RuntimeContext | None) -> str:
    if not runtime_context or not runtime_context.session.active_packs:
        return ""

    lines = [
        "## Active Capability Packs",
        "These capability packs are already active for the current invocation. Use them directly when relevant.",
        "",
    ]
    for pack in runtime_context.session.active_packs:
        tools = ", ".join(pack.get("tools", []))
        summary = pack.get("summary", "")
        lines.append(f"- {pack.get('name', 'unknown_pack')}: {summary}")
        if tools:
            lines.append(f"  Tools: {tools}")
    return "\n".join(lines)


async def build_runtime_prompt(
    *,
    agent_id: uuid.UUID | None,
    agent_name: str,
    role_description: str,
    messages: list[dict],
    tenant_id: uuid.UUID | None,
    current_user_name: str | None,
    memory_context: str,
    system_prompt_suffix: str,
    runtime_context: RuntimeContext | None = None,
    build_agent_context_fn: BuildAgentContextFn | None = None,
    fetch_relevant_knowledge_fn: KnowledgeLookupFn | None = None,
) -> str:
    """Assemble the runtime system prompt from stable building blocks."""
    build_context = build_agent_context_fn or build_agent_context
    fetch_knowledge = fetch_relevant_knowledge_fn or fetch_relevant_knowledge

    prompt_parts: list[str] = [
        await build_context(
            agent_id,
            agent_name,
            role_description,
            current_user_name=current_user_name,
        )
    ]

    last_user_msg = next(
        (
            message["content"]
            for message in reversed(messages)
            if message.get("role") == "user" and isinstance(message.get("content"), str)
        ),
        None,
    )
    if agent_id and last_user_msg:
        knowledge = await _maybe_await(fetch_knowledge(last_user_msg, tenant_id))
        if knowledge:
            prompt_parts.append(knowledge)

    if memory_context:
        prompt_parts.append(memory_context)

    active_packs_section = _render_active_packs(runtime_context)
    if active_packs_section:
        prompt_parts.append(active_packs_section)

    if system_prompt_suffix:
        prompt_parts.append(system_prompt_suffix)

    return "\n\n".join(part for part in prompt_parts if part)
