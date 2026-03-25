from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar(self):
        return self._value


class _ListResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)


class _FakeDB:
    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.deleted = []
        self.committed = False
        self.statements = []

    async def execute(self, _stmt):
        self.statements.append(_stmt)
        return self._results.pop(0)

    def add(self, value):
        self.added.append(value)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        return None

    async def refresh(self, _value):
        return None


@pytest.mark.asyncio
async def test_platform_admin_can_update_selected_tenant_quotas():
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    target_tenant = SimpleNamespace(
        id=target_tenant_id,
        default_message_limit=50,
        default_message_period="permanent",
        default_max_agents=2,
        default_agent_ttl_hours=48,
        default_max_llm_calls_per_day=100,
        min_heartbeat_interval_minutes=120,
        default_max_triggers=20,
        min_poll_interval_floor=5,
        max_webhook_rate_ceiling=5,
    )
    db = _FakeDB([_ScalarResult(target_tenant)])

    result = await enterprise_api.update_tenant_quotas(
        data=enterprise_api.TenantQuotaUpdate(default_message_limit=80, default_max_agents=6),
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(id=uuid4(), role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    assert result["message"] == "Tenant quotas updated"
    assert target_tenant.default_message_limit == 80
    assert target_tenant.default_max_agents == 6
    assert db.committed is True


@pytest.mark.asyncio
async def test_platform_admin_can_update_other_tenant_user_quota():
    import app.api.users as users_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    user = SimpleNamespace(
        id=uuid4(),
        tenant_id=target_tenant_id,
        username="alice",
        email="alice@example.com",
        display_name="Alice",
        role="member",
        is_active=True,
        quota_message_limit=50,
        quota_message_period="permanent",
        quota_messages_used=0,
        quota_max_agents=2,
        quota_agent_ttl_hours=48,
    )
    db = _FakeDB([_ScalarResult(user), _ScalarResult(1)])

    result = await users_api.update_user_quota(
        user_id=user.id,
        data=users_api.UserQuotaUpdate(quota_message_limit=120),
        current_user=SimpleNamespace(role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    assert result.quota_message_limit == 120
    assert user.quota_message_limit == 120
    assert db.committed is True


@pytest.mark.asyncio
async def test_platform_admin_can_update_selected_tenant_memory_config():
    import app.api.memory as memory_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    # Two DB calls: 1) lookup existing TenantSetting, 2) validate summary_model_id
    db = _FakeDB([_ScalarResult(None), _ScalarResult(uuid4())])

    result = await memory_api.update_memory_config(
        data=memory_api.MemoryConfigUpdate(summary_model_id="model-1", keep_recent=20),
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    assert result["summary_model_id"] == "model-1"
    assert result["keep_recent"] == 20
    assert db.added[0].tenant_id == target_tenant_id
    assert db.committed is True


@pytest.mark.asyncio
async def test_platform_admin_can_get_selected_tenant_oidc_config():
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    setting = SimpleNamespace(value={
        "issuer_url": "https://issuer.example.com",
        "client_id": "client-id",
        "client_secret": "secret",
        "scopes": "openid profile email",
        "auto_provision": True,
        "display_name": "SSO",
    })
    db = _FakeDB([_ScalarResult(setting)])

    result = await enterprise_api.get_oidc_config(
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    assert result["configured"] is True
    assert result["client_id"] == "client-id"


@pytest.mark.asyncio
async def test_platform_admin_can_create_invitation_codes_for_selected_tenant():
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    db = _FakeDB([])

    result = await enterprise_api.create_invitation_codes(
        data=enterprise_api.InvitationCodeCreate(count=2, max_uses=3),
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(id=uuid4(), role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    assert result["created"] == 2
    assert len(db.added) == 2
    assert {code.tenant_id for code in db.added} == {target_tenant_id}
    assert db.committed is True


@pytest.mark.asyncio
async def test_platform_admin_can_test_selected_tenant_llm_model(monkeypatch):
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    target_model_id = uuid4()
    db = _FakeDB([_ScalarResult(SimpleNamespace(api_key="target-secret"))])

    class _FakeClient:
        async def complete(self, messages, max_tokens):
            assert messages[0].content == "Say 'ok' and nothing else."
            assert max_tokens == 16
            return SimpleNamespace(content="ok")

    def fake_create_llm_client(provider, model, api_key, base_url):
        assert provider == "openai"
        assert model == "gpt-4o-mini"
        assert api_key == "target-secret"
        assert base_url is None
        return _FakeClient()

    async def fake_write_audit_event(*args, **kwargs):
        return None

    monkeypatch.setattr("app.services.llm_client.create_llm_client", fake_create_llm_client)
    monkeypatch.setattr("app.core.policy.write_audit_event", fake_write_audit_event)

    result = await enterprise_api.test_llm_model(
        data=enterprise_api.LLMTestRequest(
            provider="openai",
            model="gpt-4o-mini",
            model_id=str(target_model_id),
        ),
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(id=uuid4(), role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    params = db.statements[0].compile().params
    assert target_tenant_id in params.values()
    assert own_tenant_id not in params.values()
    assert result["success"] is True
    assert result["reply"] == "ok"


@pytest.mark.asyncio
async def test_platform_admin_can_update_selected_tenant_llm_model(monkeypatch):
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    model_id = uuid4()
    model = SimpleNamespace(
        id=model_id,
        provider="openai",
        model="gpt-4o-mini",
        base_url=None,
        label="Target model",
        api_key_encrypted="encrypted-key",
        max_tokens_per_day=1000,
        enabled=True,
        supports_vision=False,
        max_output_tokens=2048,
        max_input_tokens=8192,
        created_at=datetime.now(timezone.utc),
    )
    db = _FakeDB([_ScalarResult(model)])

    async def fake_write_audit_event(*args, **kwargs):
        return None

    monkeypatch.setattr("app.core.policy.write_audit_event", fake_write_audit_event)

    result = await enterprise_api.update_llm_model(
        model_id=model_id,
        tenant_id=str(target_tenant_id),
        data=enterprise_api.LLMModelUpdate(label="Updated target model"),
        current_user=SimpleNamespace(id=uuid4(), role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    params = db.statements[0].compile().params
    assert target_tenant_id in params.values()
    assert own_tenant_id not in params.values()
    assert model.label == "Updated target model"
    assert result.label == "Updated target model"
    assert db.committed is True


class _RowsResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


@pytest.mark.asyncio
async def test_platform_admin_can_delete_selected_tenant_llm_model(monkeypatch):
    import app.api.enterprise as enterprise_api

    own_tenant_id = uuid4()
    target_tenant_id = uuid4()
    model_id = uuid4()
    model = SimpleNamespace(
        id=model_id,
        provider="openai",
        model="gpt-4o-mini",
    )
    db = _FakeDB([_ScalarResult(model), _RowsResult([])])

    async def fake_write_audit_event(*args, **kwargs):
        return None

    monkeypatch.setattr("app.core.policy.write_audit_event", fake_write_audit_event)

    await enterprise_api.remove_llm_model(
        model_id=model_id,
        tenant_id=str(target_tenant_id),
        current_user=SimpleNamespace(id=uuid4(), role="platform_admin", tenant_id=own_tenant_id),
        db=db,
    )

    params = db.statements[0].compile().params
    assert target_tenant_id in params.values()
    assert own_tenant_id not in params.values()
    assert db.deleted == [model]
    assert db.committed is True
