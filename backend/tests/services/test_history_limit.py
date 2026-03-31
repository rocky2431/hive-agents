"""Tests for compute_history_limit — model-aware history loading."""

from __future__ import annotations


def test_compute_history_limit_anthropic_200k():
    """Anthropic 200k context → dynamic budget after reserves."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("anthropic", "claude-sonnet-4-20250514")
    # 200000 - 3000(prompt) - 1500(tools) - 8000(gen) = 187500 / 300 = 625 → clamped to 500
    assert limit == 500


def test_compute_history_limit_openai_128k():
    """OpenAI 128k context → dynamic budget after reserves."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("openai", "gpt-4o")
    # 128000 - 12500 = 115500 / 300 = 385
    assert limit == 385


def test_compute_history_limit_small_model():
    """Small model with 8k context → should clamp to minimum 20."""
    from app.services.memory_service import compute_history_limit
    # 8000 - 12500 < 0 → falls back to 8000/4 = 2000 / 300 = 6 → clamped to 20
    limit = compute_history_limit("openai", "gpt-4o", max_input_tokens_override=8000)
    assert limit == 20


def test_compute_history_limit_huge_model():
    """Huge context (1M) → should clamp to maximum 500."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("anthropic", "claude-opus-4-20250514", max_input_tokens_override=1_000_000)
    assert limit == 500


def test_compute_history_limit_override_takes_precedence():
    """max_input_tokens_override should override provider default."""
    from app.services.memory_service import compute_history_limit
    limit_default = compute_history_limit("deepseek", "deepseek-chat")  # 64k default
    limit_override = compute_history_limit("deepseek", "deepseek-chat", max_input_tokens_override=200_000)
    assert limit_override > limit_default


def test_compute_history_limit_unknown_provider_uses_128k_fallback():
    """Unknown provider should fallback to 128k context."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("some_unknown_provider", "some-model")
    # 128000 - 12500 = 115500 / 300 = 385
    assert limit == 385


def test_compute_history_limit_with_real_prompt_tokens():
    """When real system_prompt_tokens provided, budget is more accurate."""
    from app.services.memory_service import compute_history_limit
    # With large prompt: 128000 - 8000(prompt) - 3000(tools) - 8000(gen) = 109000 / 300 = 363
    limit = compute_history_limit(
        "openai", "gpt-4o",
        system_prompt_tokens=8000,
        tool_definitions_tokens=3000,
    )
    assert limit == 363
