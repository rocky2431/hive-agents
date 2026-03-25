import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi, enterpriseApi, orgApi, skillApi } from '../services/api';
import type { Agent, AgentCreateInput } from '../types';

interface AgentCreateFormState {
    name: string;
    role_description: string;
    bio: string;
    avatar_url: string;
    welcome_message: string;
    personality: string;
    boundaries: string;
    primary_model_id: string;
    fallback_model_id: string;
    skill_ids: string[];
    permission_scope_type: 'company' | 'user';
    permission_scope_ids: string[];
    permission_access_level: 'use' | 'manage';
    max_tokens_per_day: string | number;
    max_tokens_per_month: string | number;
    agent_class: 'internal_tenant' | 'external_gateway' | 'external_api' | 'internal_system';
    security_zone: 'standard' | 'restricted' | 'public';
}

type Phase = 'identity' | 'abilities' | 'success';

const AGENT_CLASS_OPTIONS: Array<{
    value: AgentCreateFormState['agent_class'];
    labelKey: string;
    descKey: string;
    fallbackLabel: string;
    fallbackDesc: string;
}> = [
    {
        value: 'internal_tenant',
        labelKey: 'wizard.abilities.agentClassInternalTenant',
        descKey: 'wizard.abilities.agentClassInternalTenantDesc',
        fallbackLabel: 'Tenant employee',
        fallbackDesc: 'Runs as a company-managed internal employee.',
    },
    {
        value: 'internal_system',
        labelKey: 'wizard.abilities.agentClassInternalSystem',
        descKey: 'wizard.abilities.agentClassInternalSystemDesc',
        fallbackLabel: 'System agent',
        fallbackDesc: 'Reserved for platform-managed system workflows.',
    },
    {
        value: 'external_gateway',
        labelKey: 'wizard.abilities.agentClassExternalGateway',
        descKey: 'wizard.abilities.agentClassExternalGatewayDesc',
        fallbackLabel: 'Gateway worker',
        fallbackDesc: 'Connected through an external gateway runtime.',
    },
    {
        value: 'external_api',
        labelKey: 'wizard.abilities.agentClassExternalApi',
        descKey: 'wizard.abilities.agentClassExternalApiDesc',
        fallbackLabel: 'API-backed agent',
        fallbackDesc: 'Backed by an external API or integration.',
    },
];

const SECURITY_ZONE_OPTIONS: Array<{
    value: AgentCreateFormState['security_zone'];
    labelKey: string;
    descKey: string;
    fallbackLabel: string;
    fallbackDesc: string;
}> = [
    {
        value: 'public',
        labelKey: 'wizard.abilities.securityZonePublic',
        descKey: 'wizard.abilities.securityZonePublicDesc',
        fallbackLabel: 'Public',
        fallbackDesc: 'Appropriate for broad discovery and low-risk usage.',
    },
    {
        value: 'standard',
        labelKey: 'wizard.abilities.securityZoneStandard',
        descKey: 'wizard.abilities.securityZoneStandardDesc',
        fallbackLabel: 'Standard',
        fallbackDesc: 'Default company security posture.',
    },
    {
        value: 'restricted',
        labelKey: 'wizard.abilities.securityZoneRestricted',
        descKey: 'wizard.abilities.securityZoneRestrictedDesc',
        fallbackLabel: 'Restricted',
        fallbackDesc: 'For sensitive or tightly governed workloads.',
    },
];

export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [phase, setPhase] = useState<Phase>('identity');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [memberSearch, setMemberSearch] = useState('');
    const [currentTenant] = useState<string | null>(() => localStorage.getItem('current_tenant_id'));
    const [createdAgentName, setCreatedAgentName] = useState('');
    const [createdAgentId, setCreatedAgentId] = useState('');

    const clearFieldError = (field: string) =>
        setFieldErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });

    const [form, setForm] = useState<AgentCreateFormState>({
        name: '',
        role_description: '',
        bio: '',
        avatar_url: '',
        welcome_message: '',
        personality: '',
        boundaries: '',
        primary_model_id: '',
        fallback_model_id: '',
        skill_ids: [],
        permission_scope_type: 'company',
        permission_scope_ids: [],
        permission_access_level: 'use',
        max_tokens_per_day: '' as string | number,
        max_tokens_per_month: '' as string | number,
        agent_class: 'internal_tenant',
        security_zone: 'standard',
    });

    const { data: models = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: enterpriseApi.llmModels,
    });

    const { data: globalSkills = [] } = useQuery({
        queryKey: ['global-skills'],
        queryFn: skillApi.list,
    });

    const { data: orgUsers = [] } = useQuery({
        queryKey: ['agent-create-org-users', currentTenant],
        queryFn: () => orgApi.listUsers(currentTenant ? { tenant_id: currentTenant } : {}),
        enabled: !!currentTenant,
    });

    useEffect(() => {
        if (models.length > 0 && !form.primary_model_id) {
            const firstEnabled = (models as any[]).find((m: any) => m.enabled);
            if (firstEnabled) {
                setForm((prev) => ({ ...prev, primary_model_id: firstEnabled.id }));
            }
        }
    }, [models, form.primary_model_id]);

    useEffect(() => {
        if (globalSkills.length > 0) {
            const defaultIds = globalSkills.filter((s: any) => s.is_default).map((s: any) => s.id);
            if (defaultIds.length > 0) {
                setForm((prev) => ({
                    ...prev,
                    skill_ids: Array.from(new Set([...prev.skill_ids, ...defaultIds])),
                }));
            }
        }
    }, [globalSkills]);

    const enabledModels = useMemo(() => (models as any[]).filter((m: any) => m.enabled), [models]);
    const filteredOrgUsers = useMemo(() => {
        if (!memberSearch.trim()) return orgUsers;
        const query = memberSearch.trim().toLowerCase();
        return (orgUsers as any[]).filter((user: any) =>
            [user.display_name, user.username, user.email]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query)),
        );
    }, [memberSearch, orgUsers]);

    const validateIdentity = (): boolean => {
        const errors: Record<string, string> = {};
        const name = form.name.trim();

        if (!name) {
            errors.name = t('wizard.errors.nameRequired', '智能体名称不能为空');
        } else if (name.length < 2) {
            errors.name = t('wizard.errors.nameTooShort', '名称至少需要 2 个字符');
        } else if (name.length > 100) {
            errors.name = t('wizard.errors.nameTooLong', '名称不能超过 100 个字符');
        }

        if (form.role_description.length > 500) {
            errors.role_description = t(
                'wizard.errors.roleDescTooLong',
                '角色描述不能超过 500 个字符（当前 {{count}} 字符）',
            ).replace('{{count}}', String(form.role_description.length));
        }

        if (enabledModels.length > 0 && !form.primary_model_id) {
            errors.primary_model_id = t('wizard.errors.modelRequired', '请选择一个主模型');
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleNextToAbilities = () => {
        setError('');
        if (!validateIdentity()) return;
        setPhase('abilities');
    };

    const createMutation = useMutation({
        mutationFn: async (data: AgentCreateInput) => agentApi.create(data),
        onSuccess: async (agent: Agent) => {
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            setCreatedAgentName(agent.name || form.name);
            setCreatedAgentId(agent.id);
            setPhase('success');
        },
        onError: (err: any) => setError(err.message),
    });

    const togglePermissionUser = (userId: string) => {
        setForm((prev) => ({
            ...prev,
            permission_scope_ids: prev.permission_scope_ids.includes(userId)
                ? prev.permission_scope_ids.filter((id) => id !== userId)
                : [...prev.permission_scope_ids, userId],
        }));
    };

    const handleCreate = () => {
        setError('');
        createMutation.mutate({
            name: form.name,
            role_description: form.role_description,
            bio: form.bio || undefined,
            welcome_message: form.welcome_message || undefined,
            avatar_url: form.avatar_url || undefined,
            personality: form.personality,
            boundaries: form.boundaries,
            primary_model_id: form.primary_model_id || undefined,
            fallback_model_id: form.fallback_model_id || undefined,
            skill_ids: form.skill_ids,
            permission_scope_type: form.permission_scope_type,
            permission_scope_ids: form.permission_scope_type === 'user' ? form.permission_scope_ids : [],
            permission_access_level: form.permission_access_level,
            tenant_id: currentTenant || undefined,
            max_tokens_per_day: form.max_tokens_per_day === '' ? undefined : Number(form.max_tokens_per_day),
            max_tokens_per_month: form.max_tokens_per_month === '' ? undefined : Number(form.max_tokens_per_month),
            security_zone: form.security_zone,
            agent_class: form.agent_class,
        });
    };

    if (phase === 'success') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10003;</div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '12px' }}>
                    {t('wizard.success.title', { name: createdAgentName })}
                </h2>
                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button
                        className="btn btn-primary"
                        onClick={() => navigate(`/agents/${createdAgentId}`, { state: { openChat: true } })}
                    >
                        {t('wizard.success.startChat')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => navigate(`/agents/${createdAgentId}`)}
                    >
                        {t('wizard.success.connectChannel')}
                    </button>
                </div>
            </div>
        );
    }

    const stepIndex = phase === 'identity' ? 0 : 1;
    const stepLabels = [t('wizard.steps.identity'), t('wizard.steps.abilities')];

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">{t('nav.newAgent')}</h1>
            </div>

            <div className="wizard-steps">
                {stepLabels.map((label, i) => (
                    <div key={i} style={{ display: 'contents' }}>
                        <div className={`wizard-step ${i === stepIndex ? 'active' : i < stepIndex ? 'completed' : ''}`}>
                            <div className="wizard-step-number">{i < stepIndex ? '\u2713' : i + 1}</div>
                            <span>{label}</span>
                        </div>
                        {i < stepLabels.length - 1 && <div className="wizard-connector" />}
                    </div>
                ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '760px', marginBottom: '16px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px' }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        if (phase === 'identity') navigate(-1);
                        else if (phase === 'abilities') setPhase('identity');
                    }}
                    disabled={createMutation.isPending}
                >
                    {phase === 'identity' ? t('common.cancel') : t('wizard.prev')}
                </button>
                {phase === 'identity' ? (
                    <button className="btn btn-primary" onClick={handleNextToAbilities}>
                        {t('wizard.next')} &rarr;
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={handleCreate} disabled={createMutation.isPending}>
                        {createMutation.isPending ? t('common.loading') : t('wizard.finish')}
                    </button>
                )}
            </div>

            {error && (
                <div style={{ background: 'var(--error-subtle)', color: 'var(--error)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px', maxWidth: '760px' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ maxWidth: '760px' }}>
                {phase === 'identity' && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.step1New.title')}
                        </h3>

                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.name')} *</label>
                            <input
                                className={`form-input${fieldErrors.name ? ' input-error' : ''}`}
                                value={form.name}
                                onChange={(e) => {
                                    setForm({ ...form, name: e.target.value });
                                    clearFieldError('name');
                                }}
                                placeholder={t('wizard.step1.namePlaceholder')}
                                autoFocus
                            />
                            {fieldErrors.name && (
                                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.name}</div>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.role')} *</label>
                            <textarea
                                className={`form-textarea${fieldErrors.role_description ? ' input-error' : ''}`}
                                rows={2}
                                value={form.role_description}
                                onChange={(e) => {
                                    setForm({ ...form, role_description: e.target.value });
                                    clearFieldError('role_description');
                                }}
                                placeholder={t('wizard.roleHint')}
                            />
                            {fieldErrors.role_description && (
                                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.role_description}</div>
                            )}
                        </div>

                        <details style={{ marginBottom: '16px' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {t('wizard.identity.profileExtras', 'Profile extras (bio, avatar, welcome message)')}
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">
                                        {t('wizard.step1.bio', 'Bio / Background')}{' '}
                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({t('common.optional', 'optional')})</span>
                                    </label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.bio}
                                        onChange={(e) => setForm({ ...form, bio: e.target.value })}
                                        placeholder={t('wizard.step1.bioPlaceholder', 'Brief background about this agent...')}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">
                                        {t('wizard.step1.avatarUrl', 'Avatar URL')}{' '}
                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({t('common.optional', 'optional')})</span>
                                    </label>
                                    <input
                                        className="form-input"
                                        value={form.avatar_url}
                                        onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                                        placeholder="https://..."
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">
                                        {t('wizard.step1.welcomeMessage', 'Welcome Message')}{' '}
                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({t('common.optional', 'optional')})</span>
                                    </label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.welcome_message}
                                        onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
                                        placeholder={t('wizard.step1.welcomeMessagePlaceholder', 'Message shown when users first interact with this agent')}
                                    />
                                </div>
                            </div>
                        </details>

                        <details style={{ marginBottom: '16px' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {t('wizard.identity.communicationStyle')}
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">{t('agent.fields.personality')}</label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.personality}
                                        onChange={(e) => setForm({ ...form, personality: e.target.value })}
                                        placeholder={t('wizard.step2.personalityPlaceholder')}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">{t('agent.fields.boundaries')}</label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.boundaries}
                                        onChange={(e) => setForm({ ...form, boundaries: e.target.value })}
                                        placeholder={t('wizard.step2.boundariesPlaceholder')}
                                    />
                                </div>
                            </div>
                        </details>

                        <div className="form-group">
                            <label className="form-label">{t('wizard.identity.aiModel')} *</label>
                            {enabledModels.length > 0 ? (
                                <>
                                    <select
                                        className={`form-input${fieldErrors.primary_model_id ? ' input-error' : ''}`}
                                        value={form.primary_model_id}
                                        onChange={(e) => {
                                            setForm({ ...form, primary_model_id: e.target.value });
                                            clearFieldError('primary_model_id');
                                        }}
                                    >
                                        <option value="">{t('wizard.identity.selectModel')}</option>
                                        {enabledModels.map((m: any) => (
                                            <option key={m.id} value={m.id}>
                                                {m.label} ({m.provider}/{m.model})
                                            </option>
                                        ))}
                                    </select>
                                    {fieldErrors.primary_model_id && (
                                        <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.primary_model_id}</div>
                                    )}
                                </>
                            ) : (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.step1.noModels')}{' '}
                                    <span style={{ color: 'var(--accent-primary)', cursor: 'pointer' }} onClick={() => navigate('/enterprise')}>
                                        {t('wizard.step1.enterpriseSettings')}
                                    </span>{' '}
                                    {t('wizard.step1.addModels')}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {phase === 'abilities' && (
                    <div>
                        <h3 style={{ marginBottom: '6px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.abilities.title')}
                        </h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {t('wizard.abilities.description')}
                        </p>

                        {enabledModels.length > 0 && (
                            <div className="form-group" style={{ marginBottom: '20px' }}>
                                <label className="form-label">
                                    {t('wizard.step2.fallbackModel', 'Fallback Model')}{' '}
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({t('common.optional', 'optional')})</span>
                                </label>
                                <select
                                    className="form-select"
                                    value={form.fallback_model_id}
                                    onChange={(e) => setForm({ ...form, fallback_model_id: e.target.value })}
                                >
                                    <option value="">{t('wizard.step2.fallbackNone', 'None')}</option>
                                    {enabledModels.map((m: any) => (
                                        <option key={m.id} value={m.id}>
                                            {m.label} ({m.provider}/{m.model})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label className="form-label">{t('wizard.abilities.agentClass', 'Agent class')}</label>
                            <select
                                className="form-select"
                                value={form.agent_class}
                                onChange={(e) => setForm({ ...form, agent_class: e.target.value as AgentCreateFormState['agent_class'] })}
                            >
                                {AGENT_CLASS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {t(option.labelKey, option.fallbackLabel)}
                                    </option>
                                ))}
                            </select>
                            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t(
                                    AGENT_CLASS_OPTIONS.find((option) => option.value === form.agent_class)?.descKey || 'wizard.abilities.agentClassInternalTenantDesc',
                                    AGENT_CLASS_OPTIONS.find((option) => option.value === form.agent_class)?.fallbackDesc || '',
                                )}
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label className="form-label">{t('wizard.abilities.securityZone', 'Security zone')}</label>
                            <select
                                className="form-select"
                                value={form.security_zone}
                                onChange={(e) => setForm({ ...form, security_zone: e.target.value as AgentCreateFormState['security_zone'] })}
                            >
                                {SECURITY_ZONE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {t(option.labelKey, option.fallbackLabel)}
                                    </option>
                                ))}
                            </select>
                            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t(
                                    SECURITY_ZONE_OPTIONS.find((option) => option.value === form.security_zone)?.descKey || 'wizard.abilities.securityZoneStandardDesc',
                                    SECURITY_ZONE_OPTIONS.find((option) => option.value === form.security_zone)?.fallbackDesc || '',
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">{t('wizard.abilities.dailyTokenLimit', 'Daily token limit')}</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    min={0}
                                    value={form.max_tokens_per_day}
                                    onChange={(e) => setForm({ ...form, max_tokens_per_day: e.target.value ? Number(e.target.value) : '' })}
                                    placeholder={t('wizard.abilities.unlimitedPlaceholder', 'Leave empty for unlimited')}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">{t('wizard.abilities.monthlyTokenLimit', 'Monthly token limit')}</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    min={0}
                                    value={form.max_tokens_per_month}
                                    onChange={(e) => setForm({ ...form, max_tokens_per_month: e.target.value ? Number(e.target.value) : '' })}
                                    placeholder={t('wizard.abilities.unlimitedPlaceholder', 'Leave empty for unlimited')}
                                />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label className="form-label">{t('wizard.abilities.permissionScope', 'Who can access this agent')}</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px', borderRadius: '8px', border: form.permission_scope_type === 'company' ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)', background: form.permission_scope_type === 'company' ? 'var(--accent-subtle)' : 'var(--bg-elevated)' }}>
                                    <input
                                        type="radio"
                                        name="permission_scope_type"
                                        checked={form.permission_scope_type === 'company'}
                                        onChange={() => setForm((prev) => ({ ...prev, permission_scope_type: 'company' }))}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('wizard.abilities.companyScope', 'Entire company')}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                            {t('wizard.abilities.companyScopeDesc', 'Everyone in the current workspace can discover and use this agent.')}
                                        </div>
                                    </div>
                                </label>
                                <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px', borderRadius: '8px', border: form.permission_scope_type === 'user' ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)', background: form.permission_scope_type === 'user' ? 'var(--accent-subtle)' : 'var(--bg-elevated)' }}>
                                    <input
                                        type="radio"
                                        name="permission_scope_type"
                                        checked={form.permission_scope_type === 'user'}
                                        onChange={() => setForm((prev) => ({ ...prev, permission_scope_type: 'user' }))}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('wizard.abilities.shareWithUsers', 'Specific users only')}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                            {t('wizard.abilities.shareWithUsersDesc', 'Select exactly who should have access. Leave the list empty to keep it creator-only.')}
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {form.permission_scope_type === 'user' && (
                            <div className="card" style={{ marginBottom: '20px', padding: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{t('wizard.abilities.shareWithUsers', 'Specific users only')}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                            {t('wizard.abilities.creatorOnlyFallback', 'If you do not select anyone, only the creator will be granted manage access.')}
                                        </div>
                                    </div>
                                    <input
                                        className="form-input"
                                        value={memberSearch}
                                        onChange={(e) => setMemberSearch(e.target.value)}
                                        placeholder={t('wizard.abilities.searchUsers', 'Search users by name or email')}
                                        style={{ maxWidth: '260px' }}
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                                    {filteredOrgUsers.map((user: any) => (
                                        <label key={user.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-default)', background: form.permission_scope_ids.includes(user.id) ? 'var(--accent-subtle)' : 'var(--bg-elevated)' }}>
                                            <input
                                                type="checkbox"
                                                checked={form.permission_scope_ids.includes(user.id)}
                                                onChange={() => togglePermissionUser(user.id)}
                                            />
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: '13px', fontWeight: 500 }}>{user.display_name || user.username}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {user.email}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                    {filteredOrgUsers.length === 0 && (
                                        <div style={{ gridColumn: '1 / -1', padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                            {t('wizard.abilities.noUsersFound', 'No matching users found in the current workspace.')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label className="form-label">{t('wizard.abilities.defaultAccessLevel', 'Default access level')}</label>
                            <select
                                className="form-select"
                                value={form.permission_access_level}
                                onChange={(e) => setForm({ ...form, permission_access_level: e.target.value as AgentCreateFormState['permission_access_level'] })}
                            >
                                <option value="use">{t('wizard.abilities.accessUse', 'Use')}</option>
                                <option value="manage">{t('wizard.abilities.accessManage', 'Manage')}</option>
                            </select>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {globalSkills.map((skill: any) => {
                                const isDefault = skill.is_default;
                                const isChecked = form.skill_ids.includes(skill.id);
                                return (
                                    <label
                                        key={skill.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '12px',
                                            background: isChecked ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                            border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                            borderRadius: '8px',
                                            cursor: isDefault ? 'default' : 'pointer',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            disabled={isDefault}
                                            onChange={(e) => {
                                                if (isDefault) return;
                                                if (e.target.checked) {
                                                    setForm({ ...form, skill_ids: [...form.skill_ids, skill.id] });
                                                } else {
                                                    setForm({ ...form, skill_ids: form.skill_ids.filter((id: string) => id !== skill.id) });
                                                }
                                            }}
                                        />
                                        <div style={{ fontSize: '18px' }}>{skill.icon}</div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: 500, fontSize: '13px' }}>{skill.name}</span>
                                                {isDefault && (
                                                    <span
                                                        style={{
                                                            fontSize: '10px',
                                                            padding: '1px 6px',
                                                            borderRadius: '4px',
                                                            background: 'var(--accent-primary)',
                                                            color: '#fff',
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {t('wizard.abilities.recommendedBadge')}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                {skill.description}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                            {globalSkills.length === 0 && (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.abilities.noSkills')}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {t('wizard.abilities.approvalHint')}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
