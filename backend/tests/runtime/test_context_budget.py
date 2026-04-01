"""Tests for model-aware, task-aware context budgets."""

from __future__ import annotations


def test_infer_task_profile_coding():
    from app.runtime.context_budget import infer_task_profile

    profile = infer_task_profile(
        "请修复 auth.py 里的 bug，补测试，并检查 API 响应是否回归",
    )

    assert profile.name == "coding"


def test_infer_task_profile_research():
    from app.runtime.context_budget import infer_task_profile

    profile = infer_task_profile(
        "请研究最新的竞品动态、行业新闻和公开资料，给我带来源链接的分析",
    )

    assert profile.name == "research"


def test_compute_context_budget_256k_research_is_more_aggressive():
    from app.runtime.context_budget import compute_context_budget

    budget = compute_context_budget(
        context_window_tokens=256000,
        query="请研究最新行业动态并给出带来源的深度分析",
        active_pack_count=2,
    )

    assert budget.system_prompt_budget_chars == 120000
    assert budget.retrieval_budget_chars >= 12000
    assert budget.knowledge_budget_chars >= 4000
    assert budget.active_packs_budget_chars >= 4000
    assert budget.memory_budget_chars >= 24000
    assert budget.restore_budget_chars >= 60000
    assert budget.skill_catalog_budget_chars >= 6000
    assert budget.semantic_limit >= 12
    assert budget.rerank_max_select >= 8


def test_compute_context_budget_small_model_stays_bounded():
    from app.runtime.context_budget import compute_context_budget

    budget = compute_context_budget(
        context_window_tokens=8000,
        query="请修复单个小 bug",
        active_pack_count=0,
    )

    assert budget.system_prompt_budget_chars == 15000
    assert budget.retrieval_budget_chars >= 3000
    assert budget.retrieval_budget_chars <= 6000
    assert budget.restore_budget_chars <= 30000
