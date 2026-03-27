import { useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';

import { enterpriseApi } from '../../api/domains/enterprise';

interface WorkspaceQuotaForm {
  default_message_limit: number;
  default_message_period: string;
  default_max_agents: number;
  default_agent_ttl_hours: number;
  default_max_llm_calls_per_day: number;
  min_heartbeat_interval_minutes: number;
  default_max_triggers: number;
  min_poll_interval_floor: number;
  max_webhook_rate_ceiling: number;
}

const DEFAULT_QUOTA_FORM: WorkspaceQuotaForm = {
  default_message_limit: 50,
  default_message_period: 'permanent',
  default_max_agents: 2,
  default_agent_ttl_hours: 48,
  default_max_llm_calls_per_day: 100,
  min_heartbeat_interval_minutes: 120,
  default_max_triggers: 20,
  min_poll_interval_floor: 5,
  max_webhook_rate_ceiling: 5,
};

export default function WorkspaceQuotasSection() {
  const { t } = useTranslation();
  const [quotaForm, setQuotaForm] = useState<WorkspaceQuotaForm>(DEFAULT_QUOTA_FORM);
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [quotaSaved, setQuotaSaved] = useState(false);

  useEffect(() => {
    enterpriseApi.getTenantQuotas().then((data) => {
      if (data && Object.keys(data).length > 0) {
        setQuotaForm((current) => ({ ...current, ...data }));
      }
    }).catch(() => {});
  }, []);

    const saveQuotas = async () => {
        setQuotaSaving(true);
        try {
      await enterpriseApi.updateTenantQuotas(quotaForm as unknown as Record<string, unknown>);
      setQuotaSaved(true);
      setTimeout(() => setQuotaSaved(false), 2000);
    } catch {
      alert('Failed to save');
    }
    setQuotaSaving(false);
  };

  return (
    <div>
      <h3 style={{ marginBottom: '4px' }}>{t('enterprise.quotas.defaultUserQuotas', 'Default User Quotas')}</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
        {t('enterprise.quotas.defaultsApply', 'These defaults apply to new users and agents in this company.')}
      </p>
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
          {t('enterprise.quotas.conversationLimits', 'Conversation Limits')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.messageLimit', 'Message Limit')}</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={quotaForm.default_message_limit}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_message_limit: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.maxMessagesPerPeriod', 'Maximum messages allowed in the selected period')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.messagePeriod', 'Message Period')}</label>
            <select
              className="form-input"
              value={quotaForm.default_message_period}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_message_period: event.target.value })}
            >
              <option value="permanent">{t('enterprise.quotas.permanent', 'Permanent')}</option>
              <option value="daily">{t('enterprise.quotas.daily', 'Daily')}</option>
              <option value="weekly">{t('enterprise.quotas.weekly', 'Weekly')}</option>
              <option value="monthly">{t('enterprise.quotas.monthly', 'Monthly')}</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
          {t('enterprise.quotas.agentLimits', 'Agent Limits')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.maxAgents', 'Max Agents')}</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={quotaForm.default_max_agents}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_max_agents: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.agentsUserCanCreate', 'How many agents a user can create')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.agentTTL', 'Agent TTL')}</label>
            <input
              className="form-input"
              type="number"
              min={1}
              value={quotaForm.default_agent_ttl_hours}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_agent_ttl_hours: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.agentAutoExpiry', 'Hours before inactive agents expire')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.dailyLLMCalls', 'Daily LLM Calls')}</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={quotaForm.default_max_llm_calls_per_day}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_max_llm_calls_per_day: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.maxLLMCallsPerDay', 'Max LLM calls per day')}
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
          {t('enterprise.quotas.system', 'System')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.minHeartbeatInterval', 'Min Heartbeat Interval')}</label>
            <input
              className="form-input"
              type="number"
              min={1}
              value={quotaForm.min_heartbeat_interval_minutes}
              onChange={(event) => setQuotaForm({ ...quotaForm, min_heartbeat_interval_minutes: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.minHeartbeatDesc', 'Minimum minutes between heartbeats')}
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
          {t('enterprise.quotas.triggerLimits', 'Trigger Limits')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.defaultMaxTriggers', 'Default Max Triggers')}</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={100}
              value={quotaForm.default_max_triggers}
              onChange={(event) => setQuotaForm({ ...quotaForm, default_max_triggers: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.defaultMaxTriggersDesc', 'Default trigger limit for new agents')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.minPollInterval', 'Min Poll Interval (min)')}</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={60}
              value={quotaForm.min_poll_interval_floor}
              onChange={(event) => setQuotaForm({ ...quotaForm, min_poll_interval_floor: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.minPollIntervalDesc', 'Company-wide floor: agents cannot poll faster than this')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('enterprise.quotas.maxWebhookRate', 'Max Webhook Rate (/min)')}</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={60}
              value={quotaForm.max_webhook_rate_ceiling}
              onChange={(event) => setQuotaForm({ ...quotaForm, max_webhook_rate_ceiling: Number(event.target.value) })}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {t('enterprise.quotas.maxWebhookRateDesc', 'Company-wide ceiling: max webhook hits per minute per agent')}
            </div>
          </div>
        </div>
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={saveQuotas} disabled={quotaSaving}>
            {quotaSaving ? t('common.loading', 'Loading') : t('common.save', 'Save')}
          </button>
          {quotaSaved ? <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ Saved</span> : null}
        </div>
      </div>
    </div>
  );
}
