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

# Budgets as proportions of total system prompt budget (coordinated allocation)
# Total: 60K chars → packs ~3%, retrieval ~5%, agent context ~72%, memory ~20%
_ACTIVE_PACKS_CHAR_BUDGET = 2000   # ~3% of 60K
_RETRIEVAL_CHAR_BUDGET = 3000      # ~5% of 60K


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


# Default system prompt budget when no model context window is known.
_DEFAULT_SYSTEM_PROMPT_CHAR_BUDGET = 60000  # ~18K tokens — safe for 32K+ context models
# System prompt should not exceed this proportion of the model's context window.
_SYSTEM_PROMPT_CONTEXT_RATIO = 0.20  # 20% of effective context
# Chars-per-token estimate (aligned with token_tracker.py: 3.5 chars/token).
_CHARS_PER_TOKEN = 3.5
# Hard floor/ceiling for dynamic budget (chars).
_MIN_SYSTEM_PROMPT_BUDGET = 15000   # ~4.3K tokens — minimum for small models
_MAX_SYSTEM_PROMPT_BUDGET = 120000  # ~34K tokens — ceiling for very large context


def _compute_system_prompt_budget(context_window_tokens: int | None) -> int:
    """Derive system prompt char budget from model context window.

    Returns _DEFAULT_SYSTEM_PROMPT_CHAR_BUDGET when context window is unknown.
    """
    if not context_window_tokens or context_window_tokens <= 0:
        return _DEFAULT_SYSTEM_PROMPT_CHAR_BUDGET
    budget_chars = int(context_window_tokens * _SYSTEM_PROMPT_CONTEXT_RATIO * _CHARS_PER_TOKEN)
    return max(_MIN_SYSTEM_PROMPT_BUDGET, min(budget_chars, _MAX_SYSTEM_PROMPT_BUDGET))


def assemble_runtime_prompt(
    frozen_prefix: str,
    dynamic_suffix: str,
    context_window_tokens: int | None = None,
) -> str:
    """Combine frozen prefix + dynamic suffix into final system prompt.

    If total exceeds budget, frozen prefix is trimmed (dynamic suffix preserved
    because it contains per-round retrieval and pack context).

    Args:
        context_window_tokens: Model's context window in tokens. When provided,
            the budget scales proportionally instead of using the fixed 60K default.
    """
    import logging
    _logger = logging.getLogger(__name__)

    budget = _compute_system_prompt_budget(context_window_tokens)
    prompt = f"{frozen_prefix}\n\n{dynamic_suffix}" if dynamic_suffix else frozen_prefix

    # P0.4 Observability: log prompt budget metrics
    _frozen_len = len(frozen_prefix)
    _dynamic_len = len(dynamic_suffix) if dynamic_suffix else 0
    _total_len = len(prompt)
    _logger.debug(
        "[PromptBuilder] Prompt budget: %d/%d chars (%d frozen + %d dynamic, ctx_window=%s)",
        _total_len, budget, _frozen_len, _dynamic_len, context_window_tokens or "default",
        extra={
            "metric": "prompt_budget",
            "frozen_chars": _frozen_len,
            "dynamic_chars": _dynamic_len,
            "total_chars": _total_len,
            "budget_chars": budget,
            "utilization_pct": round(_total_len / budget * 100, 1) if budget else 0,
        },
    )

    if len(prompt) > budget:
        overshoot = len(prompt) - budget
        _logger.warning(
            "[PromptBuilder] System prompt exceeds budget: %d chars (budget=%d, ctx_window=%s, overshoot=%d) — trimming frozen prefix",
            len(prompt), budget, context_window_tokens or "default", overshoot,
        )
        # Trim frozen prefix from the end, preserve dynamic suffix
        dynamic_len = len(dynamic_suffix) + 2 if dynamic_suffix else 0  # +2 for "\n\n"
        max_frozen = budget - dynamic_len
        if max_frozen > 0:
            trimmed_frozen = frozen_prefix[:max_frozen] + "\n\n...(system prompt truncated to fit context window)"
            prompt = f"{trimmed_frozen}\n\n{dynamic_suffix}" if dynamic_suffix else trimmed_frozen
        else:
            prompt = dynamic_suffix[:budget]
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
