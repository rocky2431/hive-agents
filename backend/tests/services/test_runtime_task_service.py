from __future__ import annotations

from uuid import uuid4

import pytest


class _FailingSession:
    def __init__(self, *, fail_on: str):
        self.fail_on = fail_on
        self.rollback_calls = 0
        self.added = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def add(self, value):
        self.added.append(value)

    async def execute(self, _query):
        if self.fail_on == "execute":
            raise RuntimeError("db execute failed")
        raise AssertionError("execute should not be called in this test")

    async def commit(self):
        if self.fail_on == "commit":
            raise RuntimeError("db commit failed")
        raise AssertionError("commit should not be called in this test")

    async def rollback(self):
        self.rollback_calls += 1


@pytest.mark.asyncio
async def test_create_runtime_task_record_rolls_back_on_commit_error(monkeypatch):
    from app.services.runtime_task_service import create_runtime_task_record

    fake_session = _FailingSession(fail_on="commit")
    monkeypatch.setattr("app.services.runtime_task_service.async_session", lambda: fake_session)

    with pytest.raises(RuntimeError, match="db commit failed"):
        await create_runtime_task_record(task_id=uuid4().hex)

    assert fake_session.rollback_calls == 1


@pytest.mark.asyncio
async def test_get_runtime_task_record_rolls_back_on_execute_error(monkeypatch):
    from app.services.runtime_task_service import get_runtime_task_record

    fake_session = _FailingSession(fail_on="execute")
    monkeypatch.setattr("app.services.runtime_task_service.async_session", lambda: fake_session)

    with pytest.raises(RuntimeError, match="db execute failed"):
        await get_runtime_task_record(uuid4().hex)

    assert fake_session.rollback_calls == 1


@pytest.mark.asyncio
async def test_list_runtime_task_records_rolls_back_on_execute_error(monkeypatch):
    from app.services.runtime_task_service import list_runtime_task_records

    fake_session = _FailingSession(fail_on="execute")
    monkeypatch.setattr("app.services.runtime_task_service.async_session", lambda: fake_session)

    with pytest.raises(RuntimeError, match="db execute failed"):
        await list_runtime_task_records(parent_agent_id=uuid4())

    assert fake_session.rollback_calls == 1
