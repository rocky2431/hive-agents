"""Tests for compute_history_limit — model-aware history loading."""

from __future__ import annotations


def test_compute_history_limit_anthropic_200k():
    """Anthropic 200k context → should allow ~333 messages (200000*0.5/300), clamped to 333."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("anthropic", "claude-sonnet-4-20250514")
    # 200000 * 0.5 / 300 = 333
    assert limit == 333


def test_compute_history_limit_openai_128k():
    """OpenAI 128k context → should allow ~213 messages."""
    from app.services.memory_service import compute_history_limit
    limit = compute_history_limit("openai", "gpt-4o")
    # 128000 * 0.5 / 300 = 213
    assert limit == 213


def test_compute_history_limit_small_model():
    """Small model with 8k context → should clamp to minimum 20."""
    from app.services.memory_service import compute_history_limit
    # 8000 * 0.5 / 300 = 13 → clamped to 20
    limit = compute_history_limit("openai", "gpt-4o", max_input_tokens_override=8000)
    assert limit == 20


def test_compute_history_limit_huge_model():
    """Huge context (1M) → should clamp to maximum 500."""
    from app.services.memory_service import compute_history_limit
    # 1000000 * 0.5 / 300 = 1666 → clamped to 500
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
    # 128000 * 0.5 / 300 = 213
    assert limit == 213
