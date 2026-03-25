import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchJson } from './shared';

const DEFAULT_QUOTA_FORM = {
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

export function QuotasTab({ selectedTenantId }: { selectedTenantId?: string }) {
    const { t } = useTranslation();

    const [quotaForm, setQuotaForm] = useState(DEFAULT_QUOTA_FORM);
    const [quotaSaving, setQuotaSaving] = useState(false);
    const [quotaSaved, setQuotaSaved] = useState(false);

    useEffect(() => {
        setQuotaForm(DEFAULT_QUOTA_FORM);
        fetchJson<any>(`/enterprise/tenant-quotas${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`)
            .then(d => {
                if (d && Object.keys(d).length) setQuotaForm(f => ({ ...f, ...d }));
            })
            .catch(() => { /* non-critical: quota form uses defaults if fetch fails */ });
    }, [selectedTenantId]);

    const saveQuotas = async () => {
        setQuotaSaving(true);
        try {
            await fetchJson(`/enterprise/tenant-quotas${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'PATCH', body: JSON.stringify(quotaForm) });
            setQuotaSaved(true);
            setTimeout(() => setQuotaSaved(false), 2000);
        } catch {
            alert('Failed to save');
        }
        setQuotaSaving(false);
    };

    return (
        <div>
            <h3 className="mb-1">{t('enterprise.quotas.title', 'Default User Quotas')}</h3>
            <p className="text-xs text-content-tertiary mb-4">
                {t('enterprise.quotas.description', 'These defaults apply to newly registered users. Existing users are not affected.')}
            </p>
            <div className="card p-4">
                {/* Conversation Limits */}
                <div className="text-xs font-semibold text-content-secondary mb-2.5">{t('enterprise.quotas.conversationLimits', 'Conversation Limits')}</div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                    <div className="form-group">
                        <label htmlFor="quota-msg-limit" className="form-label">{t('enterprise.quotas.messageLimit', 'Message Limit')}</label>
                        <input id="quota-msg-limit" className="form-input" type="number" min={0} value={quotaForm.default_message_limit}
                            onChange={e => setQuotaForm({ ...quotaForm, default_message_limit: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.messageLimitDesc', 'Max messages per period')}</div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="quota-msg-period" className="form-label">{t('enterprise.quotas.messagePeriod', 'Message Period')}</label>
                        <select id="quota-msg-period" className="form-input" value={quotaForm.default_message_period}
                            onChange={e => setQuotaForm({ ...quotaForm, default_message_period: e.target.value })}>
                            <option value="permanent">{t('enterprise.quotas.permanent', 'Permanent')}</option>
                            <option value="daily">{t('enterprise.quotas.daily', 'Daily')}</option>
                            <option value="weekly">{t('enterprise.quotas.weekly', 'Weekly')}</option>
                            <option value="monthly">{t('enterprise.quotas.monthly', 'Monthly')}</option>
                        </select>
                    </div>
                </div>

                {/* Agent Limits */}
                <div className="text-xs font-semibold text-content-secondary mb-2.5">{t('enterprise.quotas.agentLimits', 'Agent Limits')}</div>
                <div className="grid grid-cols-3 gap-4 mb-5">
                    <div className="form-group">
                        <label htmlFor="quota-max-agents" className="form-label">{t('enterprise.quotas.maxAgents', 'Max Agents')}</label>
                        <input id="quota-max-agents" className="form-input" type="number" min={0} value={quotaForm.default_max_agents}
                            onChange={e => setQuotaForm({ ...quotaForm, default_max_agents: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.maxAgentsDesc', 'Agents a user can create')}</div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="quota-agent-ttl" className="form-label">{t('enterprise.quotas.agentTTL', 'Agent TTL (hours)')}</label>
                        <input id="quota-agent-ttl" className="form-input" type="number" min={1} value={quotaForm.default_agent_ttl_hours}
                            onChange={e => setQuotaForm({ ...quotaForm, default_agent_ttl_hours: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.agentTTLDesc', 'Agent auto-expiry time from creation')}</div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="quota-daily-llm" className="form-label">{t('enterprise.quotas.dailyLLMCalls', 'Daily LLM Calls / Agent')}</label>
                        <input id="quota-daily-llm" className="form-input" type="number" min={0} value={quotaForm.default_max_llm_calls_per_day}
                            onChange={e => setQuotaForm({ ...quotaForm, default_max_llm_calls_per_day: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.dailyLLMCallsDesc', 'Max LLM calls per agent per day')}</div>
                    </div>
                </div>

                {/* System Limits */}
                <div className="text-xs font-semibold text-content-secondary mb-2.5">{t('enterprise.quotas.system', 'System')}</div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="form-group">
                        <label htmlFor="quota-heartbeat" className="form-label">{t('enterprise.quotas.minHeartbeat', 'Min Heartbeat Interval (min)')}</label>
                        <input id="quota-heartbeat" className="form-input" type="number" min={1} value={quotaForm.min_heartbeat_interval_minutes}
                            onChange={e => setQuotaForm({ ...quotaForm, min_heartbeat_interval_minutes: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.minHeartbeatDesc', 'Minimum heartbeat interval for all agents')}</div>
                    </div>
                </div>

                {/* Trigger Limits */}
                <div className="text-xs font-semibold text-content-secondary mb-2.5 mt-5">Trigger Limits</div>
                <div className="grid grid-cols-3 gap-4 mb-5">
                    <div className="form-group">
                        <label htmlFor="quota-max-triggers" className="form-label">{t('enterprise.quotas.defaultMaxTriggers', 'Default Max Triggers')}</label>
                        <input id="quota-max-triggers" className="form-input" type="number" min={1} max={100} value={quotaForm.default_max_triggers}
                            onChange={e => setQuotaForm({ ...quotaForm, default_max_triggers: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.defaultMaxTriggersDesc', 'Default trigger limit for new agents')}</div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="quota-poll-interval" className="form-label">{t('enterprise.quotas.minPollInterval', 'Min Poll Interval (min)')}</label>
                        <input id="quota-poll-interval" className="form-input" type="number" min={1} max={60} value={quotaForm.min_poll_interval_floor}
                            onChange={e => setQuotaForm({ ...quotaForm, min_poll_interval_floor: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.minPollIntervalDesc', 'Company-wide floor: agents cannot poll faster than this')}</div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="quota-webhook-rate" className="form-label">{t('enterprise.quotas.maxWebhookRate', 'Max Webhook Rate (/min)')}</label>
                        <input id="quota-webhook-rate" className="form-input" type="number" min={1} max={60} value={quotaForm.max_webhook_rate_ceiling}
                            onChange={e => setQuotaForm({ ...quotaForm, max_webhook_rate_ceiling: Number(e.target.value) })} autoComplete="off" />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('enterprise.quotas.maxWebhookRateDesc', 'Company-wide ceiling: max webhook hits per minute per agent')}</div>
                    </div>
                </div>

                <div className="mt-4 flex gap-2 items-center">
                    <button className="btn btn-primary" onClick={saveQuotas} disabled={quotaSaving}>
                        {quotaSaving ? t('common.loading') : t('common.save', 'Save')}
                    </button>
                    {quotaSaved && <span className="text-[var(--success)] text-xs">Saved</span>}
                </div>
            </div>
        </div>
    );
}
