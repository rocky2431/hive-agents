from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_feishu_doc_read_handler_allows_cli_without_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tools.handlers import feishu as feishu_handler

    async def fake_check_feishu_configured(_agent_id: uuid.UUID) -> bool:
        return False

    async def fake_check_feishu_office_access(_agent_id: uuid.UUID) -> bool:
        return True

    async def fake_doc_read(agent_id: uuid.UUID, arguments: dict) -> str:
        assert arguments == {"document_token": "doc-token"}
        return f"doc:{agent_id}"

    monkeypatch.setattr(feishu_handler, "_check_feishu_configured", fake_check_feishu_configured)
    monkeypatch.setattr(feishu_handler, "_check_feishu_office_access", fake_check_feishu_office_access)
    monkeypatch.setattr("app.services.agent_tools._feishu_doc_read", fake_doc_read)

    result = await feishu_handler.feishu_doc_read(uuid.uuid4(), {"document_token": "doc-token"})

    assert result.startswith("doc:")


@pytest.mark.asyncio
async def test_feishu_sheet_info_handler_allows_cli_without_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tools.handlers import feishu as feishu_handler

    async def fake_check_feishu_configured(_agent_id: uuid.UUID) -> bool:
        return False

    async def fake_check_feishu_office_access(_agent_id: uuid.UUID) -> bool:
        return True

    async def fake_sheet_info(agent_id: uuid.UUID, arguments: dict) -> str:
        assert arguments == {"spreadsheet_token": "sht-token"}
        return f"sheet:{agent_id}"

    monkeypatch.setattr(feishu_handler, "_check_feishu_configured", fake_check_feishu_configured)
    monkeypatch.setattr(feishu_handler, "_check_feishu_office_access", fake_check_feishu_office_access)
    monkeypatch.setattr("app.services.agent_tools._feishu_sheet_info", fake_sheet_info, raising=False)

    result = await feishu_handler.feishu_sheet_info(uuid.uuid4(), {"spreadsheet_token": "sht-token"})

    assert result.startswith("sheet:")
