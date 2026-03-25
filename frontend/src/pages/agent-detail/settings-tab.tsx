import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import ChannelConfig from '../../components/ChannelConfig';
import { agentApi, enterpriseApi, scheduleApi } from '../../services/api';
import { useAuthStore } from '../../stores';
import { formatTokens } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
    ConfigVersionHistory,
    PermissionUserPicker,
    CapabilityPolicyManager,
    schedToCron,
} from './index';

interface SettingsTabProps {
    agentId: string;
    agent: any;
    canManage: boolean;
}

export function SettingsTab({ agentId, agent, canManage }: SettingsTabProps) {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';

    // ── Settings form state ──────────────────────────────────────────────
    const [settingsForm, setSettingsForm] = useState({
        primary_model_id: '',
        fallback_model_id: '',
        agent_class: '',
        security_zone: 'standard',
        context_window_size: 100,
        max_tool_rounds: 50,
        max_tokens_per_day: '' as string | number,
        max_tokens_per_month: '' as string | number,
        max_triggers: 20,
        min_poll_interval_min: 5,
        webhook_rate_limit: 5,
        bio: '',
        avatar_url: '',
    });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [settingsError, setSettingsError] = useState('');
    const settingsInitRef = useRef(false);

    // Sync settings form from server data on load
    useEffect(() => {
        if (agent && !settingsInitRef.current) {
            setSettingsForm({
                primary_model_id: agent.primary_model_id || '',
                fallback_model_id: agent.fallback_model_id || '',
                agent_class: agent.agent_class || 'internal_tenant',
                security_zone: agent.security_zone || 'standard',
                context_window_size: agent.context_window_size ?? 100,
                max_tool_rounds: (agent as any).max_tool_rounds ?? 50,
                max_tokens_per_day: agent.max_tokens_per_day || '',
                max_tokens_per_month: agent.max_tokens_per_month || '',
                max_triggers: (agent as any).max_triggers ?? 20,
                min_poll_interval_min: (agent as any).min_poll_interval_min ?? 5,
                webhook_rate_limit: (agent as any).webhook_rate_limit ?? 5,
                bio: (agent as any).bio || '',
                avatar_url: (agent as any).avatar_url || '',
            });
            settingsInitRef.current = true;
        }
    }, [agent]);

    // Welcome message editor state
    const [wmDraft, setWmDraft] = useState('');
    const [wmSaved, setWmSaved] = useState(false);
    useEffect(() => { setWmDraft((agent as any)?.welcome_message || ''); }, [(agent as any)?.welcome_message]);

    // Reset cached state when switching to a different agent
    const prevIdRef = useRef(agentId);
    useEffect(() => {
        if (agentId && agentId !== prevIdRef.current) {
            prevIdRef.current = agentId;
            settingsInitRef.current = false;
            setSettingsSaved(false);
            setSettingsError('');
            setWmDraft('');
            setWmSaved(false);
        }
    }, [agentId]);

    // ── Schedule state & mutations ───────────────────────────────────────
    const schedDefaults = { freq: 'daily', interval: 1, time: '09:00', weekdays: [1, 2, 3, 4, 5] };
    const [showScheduleForm, setShowScheduleForm] = useState(false);
    const [schedForm, setSchedForm] = useState({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });
    const [uploadToast, setUploadToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setUploadToast({ message, type });
        setTimeout(() => setUploadToast(null), 3000);
    };

    const createScheduleMut = useMutation({
        mutationFn: () => {
            let sched: any;
            try { sched = JSON.parse(schedForm.schedule); } catch { sched = schedDefaults; }
            return scheduleApi.create(agentId, { name: schedForm.name, instruction: schedForm.instruction, cron_expr: schedToCron(sched) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            setShowScheduleForm(false);
            setSchedForm({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });
        },
        onError: (err: any) => {
            const msg = err?.detail || err?.message || String(err);
            alert(`Failed to create schedule: ${msg}`);
        },
    });

    const toggleScheduleMut = useMutation({
        mutationFn: ({ sid, enabled }: { sid: string; enabled: boolean }) =>
            scheduleApi.update(agentId, sid, { is_enabled: enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', agentId] }),
    });

    const deleteScheduleMut = useMutation({
        mutationFn: (sid: string) => scheduleApi.delete(agentId, sid),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', agentId] }),
    });

    const triggerScheduleMut = useMutation({
        mutationFn: async (sid: string) => {
            const res = await scheduleApi.trigger(agentId, sid);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            showToast('Schedule triggered -- executing in background', 'success');
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail || err?.message || 'Failed to trigger schedule';
            showToast(msg, 'error');
        },
    });

    // ── Queries ──────────────────────────────────────────────────────────
    const { data: llmModels = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: () => enterpriseApi.llmModels(),
    });

    const { data: permData } = useQuery({
        queryKey: ['agent-permissions', agentId],
        queryFn: () => agentApi.getPermissions(agentId),
        enabled: !!agentId,
    });

    const [selectedPermissionUserIds, setSelectedPermissionUserIds] = useState<string[]>([]);
    useEffect(() => {
        if (permData?.scope_type === 'user') {
            setSelectedPermissionUserIds(permData.scope_ids || []);
        } else {
            setSelectedPermissionUserIds([]);
        }
    }, [permData]);

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // ── Computed ─────────────────────────────────────────────────────────
    const hasChanges = (
        settingsForm.primary_model_id !== (agent?.primary_model_id || '') ||
        settingsForm.fallback_model_id !== (agent?.fallback_model_id || '') ||
        settingsForm.agent_class !== ((agent as any)?.agent_class || 'internal_tenant') ||
        settingsForm.security_zone !== ((agent as any)?.security_zone || 'standard') ||
        settingsForm.context_window_size !== (agent?.context_window_size ?? 100) ||
        settingsForm.max_tool_rounds !== ((agent as any)?.max_tool_rounds ?? 50) ||
        String(settingsForm.max_tokens_per_day) !== String(agent?.max_tokens_per_day || '') ||
        String(settingsForm.max_tokens_per_month) !== String(agent?.max_tokens_per_month || '') ||
        settingsForm.max_triggers !== ((agent as any)?.max_triggers ?? 20) ||
        settingsForm.min_poll_interval_min !== ((agent as any)?.min_poll_interval_min ?? 5) ||
        settingsForm.webhook_rate_limit !== ((agent as any)?.webhook_rate_limit ?? 5) ||
        settingsForm.bio !== ((agent as any)?.bio || '') ||
        settingsForm.avatar_url !== ((agent as any)?.avatar_url || '')
    );

    const handleSaveSettings = async () => {
        setSettingsSaving(true);
        setSettingsError('');
        try {
            const result: any = await agentApi.update(agentId, {
                primary_model_id: settingsForm.primary_model_id || null,
                fallback_model_id: settingsForm.fallback_model_id || null,
                agent_class: settingsForm.agent_class,
                security_zone: settingsForm.security_zone,
                context_window_size: settingsForm.context_window_size,
                max_tool_rounds: settingsForm.max_tool_rounds,
                max_tokens_per_day: settingsForm.max_tokens_per_day ? Number(settingsForm.max_tokens_per_day) : null,
                max_tokens_per_month: settingsForm.max_tokens_per_month ? Number(settingsForm.max_tokens_per_month) : null,
                max_triggers: settingsForm.max_triggers,
                min_poll_interval_min: settingsForm.min_poll_interval_min,
                webhook_rate_limit: settingsForm.webhook_rate_limit,
                bio: settingsForm.bio || null,
                avatar_url: settingsForm.avatar_url || null,
            } as any);
            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
            settingsInitRef.current = false;

            // Check if any values were clamped by company policy
            const clamped = result?._clamped_fields;
            if (clamped && clamped.length > 0) {
                const isCh = i18n.language?.startsWith('zh');
                const fieldNames: Record<string, string> = isCh
                    ? { min_poll_interval_min: 'Poll 最短间隔', webhook_rate_limit: 'Webhook 频率限制', heartbeat_interval_minutes: '心跳间隔' }
                    : { min_poll_interval_min: 'Min Poll Interval', webhook_rate_limit: 'Webhook Rate Limit', heartbeat_interval_minutes: 'Heartbeat Interval' };
                const msgs = clamped.map((c: any) => {
                    const name = fieldNames[c.field] || c.field;
                    return isCh
                        ? `${name}: ${c.requested} -> ${c.applied} (公司策略限制)`
                        : `${name}: ${c.requested} -> ${c.applied} (company policy)`;
                });
                setSettingsError((isCh ? 'Some values were adjusted:\n' : 'Some values were adjusted:\n') + msgs.join('\n'));
                setTimeout(() => setSettingsError(''), 5000);
            }

            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch (e: any) {
            setSettingsError(e?.message || 'Failed to save');
        } finally {
            setSettingsSaving(false);
        }
    };

    // ── Welcome message save ─────────────────────────────────────────────
    const saveWm = async () => {
        try {
            await agentApi.update(agentId, { welcome_message: wmDraft } as any);
            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
            setWmSaved(true);
            setTimeout(() => setWmSaved(false), 2000);
        } catch { /* silent */ }
    };

    // ── Permission handlers ──────────────────────────────────────────────
    const isOwner = permData?.is_owner ?? false;
    const currentScope = permData?.scope_type || 'company';
    const currentAccessLevel = permData?.access_level || 'use';
    const relationshipTenantId = localStorage.getItem('current_tenant_id') || '';

    const scopeLabels: Record<string, string> = {
        company: t('agent.settings.perm.company', 'Company-wide'),
        user: t('agent.settings.perm.specificUsers', 'Specific users'),
    };

    const handleScopeChange = async (newScope: string) => {
        try {
            await agentApi.updatePermissions(agentId, {
                scope_type: newScope,
                scope_ids: newScope === 'user' ? selectedPermissionUserIds : [],
                access_level: permData?.access_level || 'use',
            });
            queryClient.invalidateQueries({ queryKey: ['agent-permissions', agentId] });
            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
        } catch (e) {
            // permission update failed
        }
    };

    const handleAccessLevelChange = async (newLevel: string) => {
        try {
            await agentApi.updatePermissions(agentId, {
                scope_type: permData?.scope_type || 'company',
                scope_ids: (permData?.scope_type || 'company') === 'user' ? selectedPermissionUserIds : [],
                access_level: newLevel,
            });
            queryClient.invalidateQueries({ queryKey: ['agent-permissions', agentId] });
            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
        } catch (e) {
            // access level update failed
        }
    };

    const saveSpecificUsers = async () => {
        try {
            await agentApi.updatePermissions(agentId, {
                scope_type: 'user',
                scope_ids: selectedPermissionUserIds,
                access_level: permData?.access_level || 'use',
            });
            queryClient.invalidateQueries({ queryKey: ['agent-permissions', agentId] });
            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
        } catch (e) {
            // save specific users failed
        }
    };

    // Keep mutations/schedule vars accessible for future schedule UI
    void showScheduleForm;
    void createScheduleMut;
    void toggleScheduleMut;
    void deleteScheduleMut;
    void triggerScheduleMut;

    return (
        <>
            <div>
                {/* Sticky header with save button */}
                <div className="sticky top-0 z-10 flex items-center justify-between bg-surface-primary pt-1 pb-3 mb-4 border-b border-edge-subtle">
                    <h3 className="m-0">{t('agent.settings.title')}</h3>
                    <div className="flex items-center gap-2.5">
                        {settingsSaved && <span className="text-xs text-[var(--success)]" role="status" aria-live="polite">{t('agent.settings.saved', 'Saved')}</span>}
                        {settingsError && (
                            <span role="alert" className={`text-xs whitespace-pre-line ${settingsError.includes('adjusted') ? 'text-[var(--warning)]' : 'text-[var(--error)]'}`}>
                                {settingsError}
                            </span>
                        )}
                        <button
                            className={cn(
                                'btn btn-primary text-[13px] px-5 py-1.5',
                                !hasChanges && 'opacity-50 cursor-default',
                            )}
                            disabled={!hasChanges || settingsSaving}
                            onClick={handleSaveSettings}
                        >
                            {settingsSaving ? t('agent.settings.saving', 'Saving...') : t('agent.settings.save', 'Save')}
                        </button>
                    </div>
                </div>

                {/* Bio & Avatar */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.profile', 'Profile')}</h4>
                    <div className="flex flex-col gap-3">
                        <div>
                            <label htmlFor="settings-bio" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.bio', 'Bio / Background')}</label>
                            <textarea
                                id="settings-bio"
                                className="input w-full min-h-[60px] resize-y font-[inherit] text-[13px]"
                                rows={3}
                                value={settingsForm.bio}
                                onChange={(e) => setSettingsForm(f => ({ ...f, bio: e.target.value }))}
                                placeholder={t('agent.settings.bioPlaceholder', 'Describe this agent\'s background and expertise...')}
                            />
                        </div>
                        <div>
                            <label htmlFor="settings-avatar-url" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.avatarUrl', 'Avatar URL')}</label>
                            <input
                                id="settings-avatar-url"
                                className="input w-full"
                                type="text"
                                value={settingsForm.avatar_url}
                                onChange={(e) => setSettingsForm(f => ({ ...f, avatar_url: e.target.value }))}
                                placeholder="https://example.com/avatar.png"
                            />
                            <div className="text-[11px] text-content-tertiary mt-1">{t('agent.settings.avatarUrlDesc', 'Direct URL to an image. Leave empty to use the default avatar.')}</div>
                        </div>
                    </div>
                </div>

                {/* Governance */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.governance', 'Governance')}</h4>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="settings-agent-class" className="block text-[13px] font-medium mb-1.5">
                                {t('agent.settings.agentClass', 'Agent class')}
                            </label>
                            <select
                                id="settings-agent-class"
                                className="input"
                                value={settingsForm.agent_class}
                                onChange={(e) => setSettingsForm(f => ({ ...f, agent_class: e.target.value }))}
                            >
                                <option value="internal_tenant">{t('wizard.abilities.agentClassInternalTenant', 'Tenant employee')}</option>
                                <option value="internal_system">{t('wizard.abilities.agentClassInternalSystem', 'System agent')}</option>
                                <option value="external_gateway">{t('wizard.abilities.agentClassExternalGateway', 'Gateway worker')}</option>
                                <option value="external_api">{t('wizard.abilities.agentClassExternalApi', 'API-backed agent')}</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="settings-security-zone" className="block text-[13px] font-medium mb-1.5">
                                {t('agent.settings.securityZone', 'Security zone')}
                            </label>
                            <select
                                id="settings-security-zone"
                                className="input"
                                value={settingsForm.security_zone}
                                onChange={(e) => setSettingsForm(f => ({ ...f, security_zone: e.target.value }))}
                            >
                                <option value="public">{t('wizard.abilities.securityZonePublic', 'Public')}</option>
                                <option value="standard">{t('wizard.abilities.securityZoneStandard', 'Standard')}</option>
                                <option value="restricted">{t('wizard.abilities.securityZoneRestricted', 'Restricted')}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Model Selection -- native agents only */}
                {(agent as any)?.agent_type !== 'openclaw' && (
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.modelConfig')}</h4>
                    <div className="flex flex-col gap-3">
                        <div>
                            <label htmlFor="settings-primary-model" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.primaryModel')}</label>
                            <select
                                id="settings-primary-model"
                                className="input"
                                value={settingsForm.primary_model_id}
                                onChange={(e) => setSettingsForm(f => ({ ...f, primary_model_id: e.target.value }))}
                            >
                                <option value="">--</option>
                                {llmModels.map((m: any) => (
                                    <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                                ))}
                            </select>
                            <div className="text-[11px] text-content-tertiary mt-1">{t('agent.settings.primaryModel')}</div>
                        </div>
                        <div>
                            <label htmlFor="settings-fallback-model" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.fallbackModel')}</label>
                            <select
                                id="settings-fallback-model"
                                className="input"
                                value={settingsForm.fallback_model_id}
                                onChange={(e) => setSettingsForm(f => ({ ...f, fallback_model_id: e.target.value }))}
                            >
                                <option value="">--</option>
                                {llmModels.map((m: any) => (
                                    <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                                ))}
                            </select>
                            <div className="text-[11px] text-content-tertiary mt-1">{t('agent.settings.fallbackModel')}</div>
                        </div>
                    </div>
                </div>
                )}

                {/* Context Window + Max Tool Rounds -- native agents only */}
                {(agent as any)?.agent_type !== 'openclaw' && (<>
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.conversationContext')}</h4>
                    <div>
                        <label htmlFor="settings-max-rounds" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.maxRounds')}</label>
                        <input
                            id="settings-max-rounds"
                            className="input w-[120px]"
                            type="number"
                            min={10}
                            max={500}
                            value={settingsForm.context_window_size}
                            onChange={(e) => setSettingsForm(f => ({ ...f, context_window_size: Math.max(10, Math.min(500, parseInt(e.target.value) || 100)) }))}
                        />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('agent.settings.roundsDesc')}</div>
                    </div>
                </div>

                {/* Max Tool Call Rounds */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.maxToolRounds', 'Max Tool Call Rounds')}</h4>
                    <div>
                        <label htmlFor="settings-max-tool-rounds" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.maxToolRoundsLabel', 'Maximum rounds per message')}</label>
                        <input
                            id="settings-max-tool-rounds"
                            className="input w-[120px]"
                            type="number"
                            min={5}
                            max={200}
                            value={settingsForm.max_tool_rounds}
                            onChange={(e) => setSettingsForm(f => ({ ...f, max_tool_rounds: Math.max(5, Math.min(200, parseInt(e.target.value) || 50)) }))}
                        />
                        <div className="text-[11px] text-content-tertiary mt-1">{t('agent.settings.maxToolRoundsDesc', 'How many tool-calling rounds the agent can perform per message (search, write, etc). Default: 50')}</div>
                    </div>
                </div>
                </>)}

                {/* Token Limits */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.tokenLimits')}</h4>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="settings-daily-limit" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.dailyLimit')}</label>
                            <input
                                id="settings-daily-limit"
                                className="input"
                                type="number"
                                value={settingsForm.max_tokens_per_day}
                                onChange={(e) => setSettingsForm(f => ({ ...f, max_tokens_per_day: e.target.value }))}
                                placeholder={t("agent.settings.noLimit")}
                            />
                            <div className="text-[11px] text-content-tertiary mt-1">
                                {t('agent.settings.today')}: {formatTokens(agent?.tokens_used_today || 0)}
                            </div>
                        </div>
                        <div>
                            <label htmlFor="settings-monthly-limit" className="block text-[13px] font-medium mb-1.5">{t('agent.settings.monthlyLimit')}</label>
                            <input
                                id="settings-monthly-limit"
                                className="input"
                                type="number"
                                value={settingsForm.max_tokens_per_month}
                                onChange={(e) => setSettingsForm(f => ({ ...f, max_tokens_per_month: e.target.value }))}
                                placeholder={t("agent.settings.noLimit")}
                            />
                            <div className="text-[11px] text-content-tertiary mt-1">
                                {t('agent.settings.month')}: {formatTokens(agent?.tokens_used_month || 0)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Trigger Limits -- native agents only */}
                {(agent as any)?.agent_type !== 'openclaw' && (
                    <div className="card mb-3">
                        <h4 className="mb-1">{t('agentDetail.triggerLimits')}</h4>
                        <p className="text-xs text-content-tertiary mb-3">
                            {t('agentDetail.triggerLimitsDesc')}
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label htmlFor="settings-max-triggers" className="block text-[13px] font-medium mb-1.5">
                                    {t('agentDetail.maxTriggers')}
                                </label>
                                <input
                                    id="settings-max-triggers"
                                    className="input w-full"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={settingsForm.max_triggers}
                                    onChange={(e) => setSettingsForm(f => ({ ...f, max_triggers: Math.max(1, Math.min(100, parseInt(e.target.value) || 20)) }))}
                                />
                                <div className="text-[11px] text-content-tertiary mt-1">
                                    {t('agentDetail.maxTriggersHelp')}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="settings-min-poll" className="block text-[13px] font-medium mb-1.5">
                                    {t('agentDetail.minPollInterval')}
                                </label>
                                <input
                                    id="settings-min-poll"
                                    className="input w-full"
                                    type="number"
                                    min={1}
                                    max={60}
                                    value={settingsForm.min_poll_interval_min}
                                    onChange={(e) => setSettingsForm(f => ({ ...f, min_poll_interval_min: Math.max(1, Math.min(60, parseInt(e.target.value) || 5)) }))}
                                />
                                <div className="text-[11px] text-content-tertiary mt-1">
                                    {t('agentDetail.minPollIntervalHelp')}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="settings-webhook-rate" className="block text-[13px] font-medium mb-1.5">
                                    {t('agentDetail.webhookRateLimit')}
                                </label>
                                <input
                                    id="settings-webhook-rate"
                                    className="input w-full"
                                    type="number"
                                    min={1}
                                    max={60}
                                    value={settingsForm.webhook_rate_limit}
                                    onChange={(e) => setSettingsForm(f => ({ ...f, webhook_rate_limit: Math.max(1, Math.min(60, parseInt(e.target.value) || 5)) }))}
                                />
                                <div className="text-[11px] text-content-tertiary mt-1">
                                    {t('agentDetail.webhookRateLimitHelp')}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Welcome Message */}
                <div className="card mb-3">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="m-0">{t('agentDetail.welcomeMessage')}</h4>
                        {wmSaved && <span className="text-xs text-[var(--success)]" role="status" aria-live="polite">&#10003; {t('agentDetail.saved')}</span>}
                    </div>
                    <p className="text-xs text-content-tertiary mb-3">
                        {t('agentDetail.welcomeMessageDesc', 'Greeting message sent automatically when a user starts a new web conversation. Supports Markdown. Leave empty to disable.')}
                    </p>
                    <textarea
                        className="input w-full min-h-[80px] resize-y font-[inherit] text-[13px]"
                        rows={4}
                        value={wmDraft}
                        onChange={e => setWmDraft(e.target.value)}
                        onBlur={saveWm}
                        placeholder={t('agentDetail.welcomePlaceholder')}
                    />
                </div>

                {/* Capability Policy -- native agents only */}
                {(agent as any)?.agent_type !== 'openclaw' && (
                    <CapabilityPolicyManager agentId={agentId} />
                )}

                {/* Permission Management */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.perm.title', 'Access Permissions')}</h4>
                    <p className="text-xs text-content-tertiary mb-4">
                        {t('agent.settings.perm.description', 'Control who can see and interact with this agent. Only the creator or admin can change this.')}
                    </p>

                    {/* Scope Selection */}
                    <div className="flex flex-col gap-2 mb-4">
                        {(['company', 'user'] as const).map((scope) => (
                            <label
                                key={scope}
                                className={cn(
                                    'flex items-center gap-2.5 p-3 rounded-lg border transition-all duration-150',
                                    isOwner ? 'cursor-pointer' : 'cursor-default',
                                    currentScope === scope
                                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.06)]'
                                        : 'border-edge-subtle bg-transparent',
                                    !isOwner && 'opacity-70',
                                )}
                            >
                                <input
                                    type="radio"
                                    name="perm_scope"
                                    checked={currentScope === scope}
                                    disabled={!isOwner}
                                    onChange={() => handleScopeChange(scope)}
                                    className="accent-accent-primary"
                                />
                                <div>
                                    <div className="font-medium text-[13px]">{scopeLabels[scope]}</div>
                                    <div className="text-[11px] text-content-tertiary mt-0.5">
                                        {scope === 'company' && t('agent.settings.perm.companyDesc', 'All users in the organization can use this agent')}
                                        {scope === 'user' && t('agent.settings.perm.specificUsersDesc', 'Choose the exact users who should be able to use or manage this agent. Leave empty to keep it creator-only.')}
                                    </div>
                                </div>
                            </label>
                        ))}
                    </div>

                    {/* Access Level for company scope */}
                    {currentScope === 'company' && isOwner && (
                        <div className="border-t border-edge-subtle pt-3">
                            <label className="block text-[13px] font-medium mb-2">
                                {t('agent.settings.perm.accessLevel', 'Default Access Level')}
                            </label>
                            <div className="flex gap-2">
                                {[
                                    { val: 'use', label: t('agent.settings.perm.useLevel', 'Use'), desc: t('agent.settings.perm.useDesc', 'Task, Chat, Tools, Skills, Workspace') },
                                    { val: 'manage', label: t('agent.settings.perm.manageLevel', 'Manage'), desc: t('agent.settings.perm.manageDesc', 'Full access including Settings, Mind, Relationships') },
                                ].map(opt => (
                                    <label key={opt.val}
                                        className={`flex-1 p-2.5 rounded-lg cursor-pointer border transition-all duration-150 ${
                                            currentAccessLevel === opt.val
                                                ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.06)]'
                                                : 'border-edge-subtle bg-transparent'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <input type="radio" name="access_level" checked={currentAccessLevel === opt.val}
                                                onChange={() => handleAccessLevelChange(opt.val)}
                                                className="accent-accent-primary" />
                                            <span className="font-medium text-[13px]">{opt.label}</span>
                                        </div>
                                        <div className="text-[11px] text-content-tertiary mt-1 ml-5">{opt.desc}</div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {currentScope === 'user' && (
                        <PermissionUserPicker
                            tenantId={relationshipTenantId || undefined}
                            selectedPermissionUserIds={selectedPermissionUserIds}
                            onToggle={(userId) => {
                                if (!isOwner) return;
                                setSelectedPermissionUserIds((prev) =>
                                    prev.includes(userId)
                                        ? prev.filter((id) => id !== userId)
                                        : [...prev, userId],
                                );
                            }}
                            disabled={!isOwner}
                        />
                    )}

                    {currentScope === 'user' && isOwner && (
                        <div className="flex justify-end mt-3">
                            <button className="btn btn-primary" onClick={saveSpecificUsers}>
                                {t('agent.settings.perm.saveSpecificUsers', 'Save user access')}
                            </button>
                        </div>
                    )}

                    {currentScope !== 'company' && permData?.scope_names?.length > 0 && (
                        <div className="mt-3 text-xs text-content-secondary">
                            <span className="font-medium">{t('agent.settings.perm.currentAccess', 'Current access')}:</span>{' '}
                            {permData.scope_names.map((s: any) => s.name).join(', ')}
                        </div>
                    )}

                    {!isOwner && (
                        <div className="mt-3 text-[11px] text-content-tertiary italic">
                            {t('agent.settings.perm.readOnly', 'Only the creator or admin can change permissions')}
                        </div>
                    )}
                </div>

                {/* Timezone */}
                <div className="card mb-3">
                    <h4 className="mb-1 flex items-center gap-2">
                        {t('agent.settings.timezone.title', 'Timezone')}
                    </h4>
                    <p className="text-xs text-content-tertiary mb-4">
                        {t('agent.settings.timezone.description', 'The timezone used for this agent\'s scheduling, active hours, and time awareness. Defaults to the company timezone if not set.')}
                    </p>
                    <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                        <div>
                            <div className="font-medium text-[13px]">{t('agent.settings.timezone.current', 'Agent Timezone')}</div>
                            <div className="text-[11px] text-content-tertiary">
                                {agent?.timezone
                                    ? t('agent.settings.timezone.override', 'Custom timezone for this agent')
                                    : t('agent.settings.timezone.inherited', 'Using company default timezone')}
                            </div>
                        </div>
                        <select
                            className={cn('input w-[200px] text-xs', !canManage && 'opacity-60')}
                            disabled={!canManage}
                            value={agent?.timezone || ''}
                            onChange={async (e) => {
                                if (!canManage) return;
                                const val = e.target.value || null;
                                await agentApi.update(agentId, { timezone: val } as any);
                                queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                            }}
                        >
                            <option value="">{t('agent.settings.timezone.default', 'Company default')}</option>
                            {['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
                                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
                                'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                                'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland'].map(tz => (
                                    <option key={tz} value={tz}>{tz}</option>
                                ))}
                        </select>
                    </div>
                </div>

                {/* Heartbeat */}
                <div className="card mb-3">
                    <h4 className="mb-1 flex items-center gap-2">
                        {t('agent.settings.heartbeat.title', 'Heartbeat')}
                    </h4>
                    <p className="text-xs text-content-tertiary mb-4">
                        {t('agent.settings.heartbeat.description', 'Periodic awareness check -- agent proactively monitors the plaza and work environment.')}
                    </p>
                    <div className="flex flex-col gap-3.5">
                        {/* Enable toggle */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.enabled', 'Enable Heartbeat')}</div>
                                <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.enabledDesc', 'Agent will periodically check plaza and work status')}</div>
                            </div>
                            <label className={cn('relative inline-block w-[44px] h-[24px]', canManage ? 'cursor-pointer' : 'cursor-default')}>
                                <input
                                    type="checkbox"
                                    aria-label={t('agent.settings.heartbeat.enabled', 'Enable Heartbeat')}
                                    checked={agent?.heartbeat_enabled ?? true}
                                    disabled={!canManage}
                                    onChange={async (e) => {
                                        if (!canManage) return;
                                        await agentApi.update(agentId, { heartbeat_enabled: e.target.checked } as any);
                                        queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                    }}
                                    className="opacity-0 w-0 h-0"
                                />
                                <span
                                    className={cn(
                                        'absolute inset-0 rounded-xl transition-colors duration-200',
                                        (agent?.heartbeat_enabled ?? true) ? 'bg-accent-primary' : 'bg-surface-tertiary',
                                        !canManage && 'opacity-60',
                                    )}
                                >
                                    <span
                                        className="absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full transition-[left] duration-200"
                                        style={{ left: (agent?.heartbeat_enabled ?? true) ? '23px' : '3px' }}
                                    />
                                </span>
                            </label>
                        </div>

                        {/* Interval */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.interval', 'Check Interval')}</div>
                                <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.intervalDesc', 'How often the agent checks for updates')}</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="number"
                                    className={cn('input w-[80px] text-xs', !canManage && 'opacity-60')}
                                    disabled={!canManage}
                                    min={1}
                                    defaultValue={agent?.heartbeat_interval_minutes ?? 120}
                                    key={agent?.heartbeat_interval_minutes}
                                    onBlur={async (e) => {
                                        if (!canManage) return;
                                        const val = Math.max(1, Number(e.target.value) || 120);
                                        e.target.value = String(val);
                                        await agentApi.update(agentId, { heartbeat_interval_minutes: val } as any);
                                        queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                    }}
                                />
                                <span className="text-xs text-content-tertiary">{t('common.minutes', 'min')}</span>
                            </div>
                        </div>

                        {/* Active Hours */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.activeHours', 'Active Hours')}</div>
                                <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.activeHoursDesc', 'Only trigger heartbeat during these hours (HH:MM-HH:MM)')}</div>
                            </div>
                            <input
                                className={cn('input w-[140px] text-xs text-center', !canManage && 'opacity-60')}
                                disabled={!canManage}
                                value={agent?.heartbeat_active_hours ?? '09:00-18:00'}
                                onChange={async (e) => {
                                    if (!canManage) return;
                                    await agentApi.update(agentId, { heartbeat_active_hours: e.target.value } as any);
                                    queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                }}
                                placeholder="09:00-18:00"
                            />
                        </div>

                        {/* Last Heartbeat */}
                        {agent?.last_heartbeat_at && (
                            <div className="text-xs text-content-tertiary pl-1">
                                {t('agent.settings.heartbeat.lastRun', 'Last heartbeat')}: {new Date(agent.last_heartbeat_at).toLocaleString()}
                            </div>
                        )}
                    </div>
                </div>

                {/* Channel Config */}
                <div className="mb-3">
                    <ChannelConfig mode="edit" agentId={agentId} />
                </div>

                {/* Config Version History */}
                <ConfigVersionHistory agentId={agentId} />

                {/* Context Window Size -- read-only display */}
                <div className="card mb-3">
                    <h4 className="mb-3">{t('agent.settings.contextWindow', 'Context Window Size')}</h4>
                    <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                        <div>
                            <div className="font-medium text-[13px]">{t('agent.settings.contextWindowLabel', 'Current Window')}</div>
                            <div className="text-[11px] text-content-tertiary">{t('agent.settings.contextWindowDesc', 'The context window size configured for this agent\'s LLM model')}</div>
                        </div>
                        <div className="text-[15px] font-semibold text-content-primary">
                            {((agent as any)?.context_window_size ?? 100).toLocaleString()} {t('agent.settings.contextWindowTokens', 'rounds')}
                        </div>
                    </div>
                </div>

                {/* Admin Settings -- platform_admin / org_admin only */}
                {isAdmin && (
                <div className="card mb-3 border-warning">
                    <h4 className="mb-1">{t('agent.settings.admin.title', 'Admin Settings')}</h4>
                    <p className="text-xs text-content-tertiary mb-4">
                        {t('agent.settings.admin.description', 'These settings are only visible to platform and organization admins.')}
                    </p>
                    <div className="flex flex-col gap-3.5">
                        {/* Security Zone */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.securityZone', 'Security Zone')}</div>
                                <div className="text-[11px] text-content-tertiary">{t('agent.settings.securityZoneDesc', 'Controls the security sandbox level for this agent')}</div>
                            </div>
                            <select
                                className="input w-[160px] text-xs"
                                value={(agent as any)?.security_zone || 'standard'}
                                onChange={async (e) => {
                                    await agentApi.update(agentId, { security_zone: e.target.value } as any);
                                    queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                }}
                            >
                                <option value="public">{t('agent.zone.public', 'Public')}</option>
                                <option value="standard">{t('agent.zone.standard', 'Standard')}</option>
                                <option value="restricted">{t('agent.zone.restricted', 'Restricted')}</option>
                            </select>
                        </div>

                        {/* Agent Class */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.agentClass', 'Agent Class')}</div>
                                <div className="text-[11px] text-content-tertiary">{t('agent.settings.agentClassDesc', 'Classification that determines the agent\'s operational scope')}</div>
                            </div>
                            <select
                                className="input w-[180px] text-xs"
                                value={(agent as any)?.agent_class || 'internal_tenant'}
                                onChange={async (e) => {
                                    await agentApi.update(agentId, { agent_class: e.target.value } as any);
                                    queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                }}
                            >
                                <option value="internal_system">{t('agent.class.internal_system', 'System Agent')}</option>
                                <option value="internal_tenant">{t('agent.class.internal_tenant', 'Internal Agent')}</option>
                                <option value="external_gateway">{t('agent.class.external_gateway', 'Gateway Agent')}</option>
                                <option value="external_api">{t('agent.class.external_api', 'API Agent')}</option>
                            </select>
                        </div>

                        {/* Expires At */}
                        <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                            <div>
                                <div className="font-medium text-[13px]">{t('agent.settings.expiresAt', 'Service Expiry Date')}</div>
                                <div className="text-[11px] text-content-tertiary">
                                    {(agent as any)?.expires_at
                                        ? t('agent.settings.expiresAtCurrent', 'Expires: ') + new Date((agent as any).expires_at).toLocaleString()
                                        : t('agent.settings.expiresAtNone', 'No expiry set (never expires)')}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="datetime-local"
                                    className="input w-[200px] text-xs"
                                    defaultValue={(agent as any)?.expires_at ? new Date((agent as any).expires_at).toISOString().slice(0, 16) : ''}
                                    key={(agent as any)?.expires_at}
                                    onBlur={async (e) => {
                                        const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                                        await agentApi.update(agentId, { expires_at: val } as any);
                                        queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                    }}
                                />
                                {(agent as any)?.expires_at && (
                                    <button
                                        onClick={async () => {
                                            await agentApi.update(agentId, { expires_at: null } as any);
                                            queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
                                        }}
                                        className="px-2 py-1 rounded-md border border-edge-subtle bg-transparent cursor-pointer text-[11px] text-content-tertiary"
                                        title={t('agent.settings.clearExpiry', 'Clear expiry')}
                                    >
                                        {t('agent.settings.clearExpiry', 'Clear')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                )}

                {/* Danger Zone */}
                <div className="card border-error">
                    <h4 className="mb-3 text-error">{t('agent.settings.danger.title')}</h4>
                    <p className="text-[13px] text-content-secondary mb-3">
                        {t('agent.settings.danger.deleteWarning')}
                    </p>
                    {!showDeleteConfirm ? (
                        <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                            {t('agent.settings.danger.deleteAgent')}
                        </button>
                    ) : (
                        <div className="flex gap-2 items-center">
                            <span className="text-[13px] font-semibold text-error">{t('agent.settings.danger.deleteWarning')}</span>
                            <button className="btn btn-danger" onClick={async () => {
                                try {
                                    await agentApi.delete(agentId);
                                    queryClient.invalidateQueries({ queryKey: ['agents'] });
                                    navigate('/');
                                } catch (err: any) {
                                    alert(err?.message || 'Failed to delete agent');
                                }
                            }}>{t('agent.settings.danger.confirmDelete')}</button>
                            <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Toast notification */}
            {uploadToast && (
                <div
                    role="alert"
                    aria-live="assertive"
                    className={cn(
                        'fixed top-5 right-5 z-[20000] px-5 py-3 rounded-lg text-white text-sm font-medium shadow-lg',
                        uploadToast.type === 'success' ? 'bg-green-500/90' : 'bg-red-500/90',
                    )}
                >
                    {uploadToast.message}
                </div>
            )}
        </>
    );
}
