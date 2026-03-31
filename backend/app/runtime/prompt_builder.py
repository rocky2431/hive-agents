"""Prompt assembly helpers for the unified runtime.

Three-layer prompt architecture:
  1. Frozen Prefix — stable within a session (identity, soul, skills catalog, memory snapshot)
  2. Dynamic Suffix — changes per round (active packs, retrieval, compaction hints)
  3. Per-turn Messages — normal conversation messages
"""

from __future__ import annotations

import inspect
import uuid
from typing import Any, Awaitable, Callable

from app.runtime.context import RuntimeContext
from app.services.agent_context import build_agent_context
from app.services.knowledge_inject import fetch_relevant_knowledge


BuildAgentContextFn = Callable[[uuid.UUID | None, str, str, str | None], Awaitable[str]]
KnowledgeLookupFn = Callable[[str, uuid.UUID | None], Awaitable[str] | str]

_ACTIVE_PACKS_CHAR_BUDGET = 1200
_RETRIEVAL_CHAR_BUDGET = 2400


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def _trim_block(text: str, *, budget_chars: int) -> str:
    if not text or budget_chars <= 0:
        return ""
    stripped = text.strip()
    if len(stripped) <= budget_chars:
        return stripped

    lines = stripped.splitlines()
    kept: list[str] = []
    used = 0
    for line in lines:
        normalized = line.rstrip()
        if not normalized:
            continue
        line_cost = len(normalized) + 1
        if used + line_cost > budget_chars:
            break
        kept.append(normalized)
        used += line_cost

    if not kept:
        return stripped[: max(budget_chars - 3, 0)].rstrip() + "..."

    result = "\n".join(kept).rstrip()
    if len(result) < len(stripped):
        result += "\n..."
    return result


# ── Frozen Prefix (session-stable) ──────────────────────────────


def build_frozen_prompt_prefix(
    *,
    agent_context: str,
    memory_snapshot: str = "",
    skill_catalog: str = "",
) -> str:
    """Build the session-stable prompt prefix.

    Contains: agent identity/soul/role, kernel tools catalog,
    skill catalog, and session-start memory snapshot.
    These do NOT change within a single session.
    """
    parts = [agent_context]
    if memory_snapshot:
        parts.append(memory_snapshot)
    if skill_catalog:
        parts.append(skill_catalog)
    return "\n\n".join(parts)


# ── Dynamic Suffix (per-round) ──────────────────────────────────


def _render_active_packs(active_packs: list[dict[str, Any]]) -> str:
    if not active_packs:
        return ""
    lines = [
        "## Active Capability Packs",
        "These capability packs are already active for the current invocation. Use them directly when relevant.",
        "",
    ]
    for pack in active_packs:
        tools = ", ".join(pack.get("tools", []))
        summary = pack.get("summary", "")
        lines.append(f"- {pack.get('name', 'unknown_pack')}: {summary}")
        if tools:
            lines.append(f"  Tools: {tools}")
    return _trim_block("\n".join(lines), budget_chars=_ACTIVE_PACKS_CHAR_BUDGET)


def build_dynamic_prompt_suffix(
    *,
    active_packs: list[dict[str, Any]] | None = None,
    retrieval_context: str = "",
    system_prompt_suffix: str = "",
) -> str:
    """Build the per-round dynamic suffix.

    Contains: active capability packs, knowledge retrieval results,
    compaction hints, and request-specific suffix.
    These CAN change between rounds within the same session.
    """
    parts: list[str] = []

    packs_section = _render_active_packs(active_packs or [])
    if packs_section:
        parts.append(packs_section)

    if retrieval_context:
        parts.append(_trim_block(retrieval_context, budget_chars=_RETRIEVAL_CHAR_BUDGET))

    if system_prompt_suffix:
        parts.append(system_prompt_suffix)

    return "\n\n".join(parts)


# ── Assembly ────────────────────────────────────────────────────


# Maximum system prompt budget (chars). Overflow is trimmed from the end of frozen prefix.
_SYSTEM_PROMPT_CHAR_BUDGET = 60000  # ~18K tokens — safe for 32K+ context models


def assemble_runtime_prompt(frozen_prefix: str, dynamic_suffix: str) -> str:
    """Combine frozen prefix + dynamic suffix into final system prompt.

    If total exceeds budget, frozen prefix is trimmed (dynamic suffix preserved
    because it contains per-round retrieval and pack context).
    """
    import logging
    _logger = logging.getLogger(__name__)

    prompt = f"{frozen_prefix}\n\n{dynamic_suffix}" if dynamic_suffix else frozen_prefix
    if len(prompt) > _SYSTEM_PROMPT_CHAR_BUDGET:
        overshoot = len(prompt) - _SYSTEM_PROMPT_CHAR_BUDGET
        _logger.warning(
            "[PromptBuilder] System prompt exceeds budget: %d chars (budget=%d, overshoot=%d) — trimming frozen prefix",
            len(prompt), _SYSTEM_PROMPT_CHAR_BUDGET, overshoot,
        )
        # Trim frozen prefix from the end, preserve dynamic suffix
        dynamic_len = len(dynamic_suffix) + 2 if dynamic_suffix else 0  # +2 for "\n\n"
        max_frozen = _SYSTEM_PROMPT_CHAR_BUDGET - dynamic_len
        if max_frozen > 0:
            trimmed_frozen = frozen_prefix[:max_frozen] + "\n\n...(system prompt truncated to fit context window)"
            prompt = f"{trimmed_frozen}\n\n{dynamic_suffix}" if dynamic_suffix else trimmed_frozen
        else:
            prompt = dynamic_suffix[:_SYSTEM_PROMPT_CHAR_BUDGET]
    return prompt


# ── Legacy-compatible full builder (used by invoker.py) ─────────


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
    """Assemble the runtime system prompt from stable building blocks.

    Legacy-compatible entry point. Internally uses the frozen/dynamic split
    but does not cache — caching is managed by the kernel via SessionContext.
    """
    build_context = build_agent_context_fn or build_agent_context
    fetch_knowledge = fetch_relevant_knowledge_fn or fetch_relevant_knowledge

    agent_context = await build_context(
        agent_id,
        agent_name,
        role_description,
        current_user_name=current_user_name,
    )

    # Build frozen prefix
    frozen = build_frozen_prompt_prefix(
        agent_context=agent_context,
        memory_snapshot=memory_context,
    )

    # Build dynamic suffix
    last_user_msg = next(
        (
            message["content"]
            for message in reversed(messages)
            if message.get("role") == "user" and isinstance(message.get("content"), str)
        ),
        None,
    )
    retrieval = ""
    if agent_id and last_user_msg:
        knowledge = await _maybe_await(fetch_knowledge(last_user_msg, tenant_id))
        if knowledge:
            retrieval = knowledge

    active_packs = []
    if runtime_context and runtime_context.session.active_packs:
        active_packs = runtime_context.session.active_packs

    dynamic = build_dynamic_prompt_suffix(
        active_packs=active_packs,
        retrieval_context=retrieval,
        system_prompt_suffix=system_prompt_suffix,
    )

    return assemble_runtime_prompt(frozen, dynamic)
