"""Tests for the runtime hook/event bus."""

from __future__ import annotations

import pytest

from app.runtime.hooks import HookContext, HookEvent, HookRegistry, HookResult


@pytest.fixture
def registry():
    reg = HookRegistry()
    yield reg
    reg.clear()


class TestHookRegistry:
    """Core hook registration and emission."""

    @pytest.mark.asyncio
    async def test_sync_handler_called(self, registry) -> None:
        calls = []

        def handler(ctx: HookContext):
            calls.append(ctx.tool_name)

        registry.register(HookEvent.POST_TOOL_USE, handler)
        await registry.emit(HookContext(event=HookEvent.POST_TOOL_USE, tool_name="read_file"))
        assert calls == ["read_file"]

    @pytest.mark.asyncio
    async def test_async_handler_called(self, registry) -> None:
        calls = []

        async def handler(ctx: HookContext):
            calls.append(ctx.tool_name)

        registry.register(HookEvent.POST_TOOL_USE, handler)
        await registry.emit(HookContext(event=HookEvent.POST_TOOL_USE, tool_name="write_file"))
        assert calls == ["write_file"]

    @pytest.mark.asyncio
    async def test_pre_tool_use_can_block(self, registry) -> None:
        def blocker(ctx: HookContext):
            return HookResult(block=True, reason="dangerous tool")

        registry.register(HookEvent.PRE_TOOL_USE, blocker)
        result = await registry.emit(HookContext(event=HookEvent.PRE_TOOL_USE, tool_name="execute_code"))
        assert result is not None
        assert result.block is True
        assert "dangerous" in result.reason

    @pytest.mark.asyncio
    async def test_pre_tool_use_allows_when_no_block(self, registry) -> None:
        def allower(ctx: HookContext):
            return HookResult(block=False)

        registry.register(HookEvent.PRE_TOOL_USE, allower)
        result = await registry.emit(HookContext(event=HookEvent.PRE_TOOL_USE, tool_name="read_file"))
        assert result is None  # Non-blocking results are not returned

    @pytest.mark.asyncio
    async def test_multiple_handlers_run_in_order(self, registry) -> None:
        order = []

        def first(ctx):
            order.append(1)

        def second(ctx):
            order.append(2)

        registry.register(HookEvent.SESSION_START, first)
        registry.register(HookEvent.SESSION_START, second)
        await registry.emit(HookContext(event=HookEvent.SESSION_START))
        assert order == [1, 2]

    @pytest.mark.asyncio
    async def test_handler_exception_does_not_crash(self, registry) -> None:
        calls = []

        def crasher(ctx):
            raise ValueError("boom")

        def survivor(ctx):
            calls.append("survived")

        registry.register(HookEvent.POST_TOOL_USE, crasher)
        registry.register(HookEvent.POST_TOOL_USE, survivor)
        await registry.emit(HookContext(event=HookEvent.POST_TOOL_USE))
        assert calls == ["survived"]

    @pytest.mark.asyncio
    async def test_no_handlers_returns_none(self, registry) -> None:
        result = await registry.emit(HookContext(event=HookEvent.SESSION_END))
        assert result is None

    def test_unregister_removes_handler(self, registry) -> None:
        def handler(ctx):
            pass

        registry.register(HookEvent.POST_TOOL_USE, handler)
        assert registry.handler_count(HookEvent.POST_TOOL_USE) == 1
        registry.unregister(HookEvent.POST_TOOL_USE, handler)
        assert registry.handler_count(HookEvent.POST_TOOL_USE) == 0

    def test_clear_removes_all(self, registry) -> None:
        registry.register(HookEvent.PRE_TOOL_USE, lambda ctx: None)
        registry.register(HookEvent.POST_TOOL_USE, lambda ctx: None)
        registry.clear()
        assert registry.handler_count(HookEvent.PRE_TOOL_USE) == 0
        assert registry.handler_count(HookEvent.POST_TOOL_USE) == 0

    @pytest.mark.asyncio
    async def test_modified_args_returned_for_pre_tool(self, registry) -> None:
        def modifier(ctx: HookContext):
            return HookResult(block=False, modified_args={"path": "/safe/path"})

        registry.register(HookEvent.PRE_TOOL_USE, modifier)
        result = await registry.emit(HookContext(event=HookEvent.PRE_TOOL_USE, tool_name="read_file"))
        assert result is not None
        assert result.block is False
        assert result.modified_args == {"path": "/safe/path"}

    @pytest.mark.asyncio
    async def test_pre_tool_use_modifiers_chain_in_order(self, registry) -> None:
        def first(ctx: HookContext):
            return HookResult(block=False, modified_args={"path": "/safe/path"})

        def second(ctx: HookContext):
            assert ctx.tool_args == {"path": "/safe/path"}
            return HookResult(block=False, modified_args={"path": "/safer/path"})

        registry.register(HookEvent.PRE_TOOL_USE, first)
        registry.register(HookEvent.PRE_TOOL_USE, second)
        result = await registry.emit(
            HookContext(
                event=HookEvent.PRE_TOOL_USE,
                tool_name="read_file",
                tool_args={"path": "/unsafe/path"},
            )
        )
        assert result is not None
        assert result.modified_args == {"path": "/safer/path"}


class TestHookContext:
    """HookContext data structure."""

    def test_all_fields_optional_except_event(self) -> None:
        ctx = HookContext(event=HookEvent.SESSION_START)
        assert ctx.event == HookEvent.SESSION_START
        assert ctx.agent_id is None
        assert ctx.tool_name is None
        assert ctx.metadata == {}

    def test_metadata_default_factory(self) -> None:
        ctx1 = HookContext(event=HookEvent.SESSION_START)
        ctx2 = HookContext(event=HookEvent.SESSION_END)
        ctx1.metadata["key"] = "val"
        assert "key" not in ctx2.metadata
