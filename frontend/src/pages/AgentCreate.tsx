import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi, enterpriseApi, skillApi } from '../services/api';
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
    permission_access_level: 'use' | 'manage';
    security_zone: 'standard' | 'restricted' | 'public';
}

/* ── Phase constants ──────────────────────────────────────────────── */

type Phase = 'identity' | 'abilities' | 'success';

export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [phase, setPhase] = useState<Phase>('identity');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const clearFieldError = (field: string) =>
        setFieldErrors((prev) => {
            const n = { ...prev };
            delete n[field];
            return n;
        });
    const [currentTenant] = useState<string | null>(() => localStorage.getItem('current_tenant_id'));
    const [createdAgentName, setCreatedAgentName] = useState('');
    const [createdAgentId, setCreatedAgentId] = useState('');

    const [form, setForm] = useState<AgentCreateFormState>({
        name: '',
        role_description: '',
        bio: '',
        avatar_url: '',
        welcome_message: '',
        personality: '',
        boundaries: '',
        primary_model_id: '' as string,
        fallback_model_id: '',
        skill_ids: [] as string[],
        permission_scope_type: 'company',
        permission_access_level: 'use',
        security_zone: 'standard',
    });

    /* ── Data fetching ────────────────────────────────────────────── */

    const { data: models = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: enterpriseApi.llmModels,
    });

    const { data: globalSkills = [] } = useQuery({
        queryKey: ['global-skills'],
        queryFn: skillApi.list,
    });

    // Auto-select first enabled model
    useEffect(() => {
        if (models.length > 0 && !form.primary_model_id) {
            const firstEnabled = (models as any[]).find((m: any) => m.enabled);
            if (firstEnabled) {
                setForm((prev) => ({ ...prev, primary_model_id: firstEnabled.id }));
            }
        }
    }, [models, form.primary_model_id]);

    // Auto-select default skills
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

    /* ── Validation ───────────────────────────────────────────────── */

    const validateIdentity = (): boolean => {
        const errors: Record<string, string> = {};
        const name = form.name.trim();
        if (!name) {
            errors.name = t('wizard.errors.nameRequired', '\u667A\u80FD\u4F53\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A');
        } else if (name.length < 2) {
            errors.name = t('wizard.errors.nameTooShort', '\u540D\u79F0\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26');
        } else if (name.length > 100) {
            errors.name = t('wizard.errors.nameTooLong', '\u540D\u79F0\u4E0D\u80FD\u8D85\u8FC7 100 \u4E2A\u5B57\u7B26');
        }
        if (form.role_description.length > 500) {
            errors.role_description = t('wizard.errors.roleDescTooLong', '\u89D2\u8272\u63CF\u8FF0\u4E0D\u80FD\u8D85\u8FC7 500 \u4E2A\u5B57\u7B26\uFF08\u5F53\u524D {{count}} \u5B57\u7B26\uFF09').replace(
                '{{count}}',
                String(form.role_description.length),
            );
        }
        const enabledModels = (models as any[]).filter((m: any) => m.enabled);
        if (enabledModels.length > 0 && !form.primary_model_id) {
            errors.primary_model_id = t('wizard.errors.modelRequired', '\u8BF7\u9009\u62E9\u4E00\u4E2A\u4E3B\u6A21\u578B');
        }
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleNextToAbilities = () => {
        setError('');
        if (!validateIdentity()) return;
        setPhase('abilities');
    };

    /* ── Submit ────────────────────────────────────────────────────── */

    const createMutation = useMutation({
        mutationFn: async (data: AgentCreateInput) => {
            return await agentApi.create(data);
        },
        onSuccess: async (agent: Agent) => {
            queryClient.invalidateQueries({ queryKey: ['agents'] });
            setCreatedAgentName(agent.name || form.name);
            setCreatedAgentId(agent.id);
            setPhase('success');
        },
        onError: (err: any) => setError(err.message),
    });

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
            permission_access_level: form.permission_access_level,
            tenant_id: currentTenant || undefined,
            security_zone: form.security_zone,
            agent_class: 'internal_tenant',
        });
    };

    /* ── Derived values ───────────────────────────────────────────── */

    const enabledModels = useMemo(() => (models as any[]).filter((m: any) => m.enabled), [models]);

    /* ── Render: Success Screen ───────────────────────────────────── */

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

    /* ── Render: Steps (identity / abilities) ─────────────────────── */

    const stepIndex = phase === 'identity' ? 0 : 1;
    const stepLabels = [t('wizard.steps.identity'), t('wizard.steps.abilities')];

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">{t('nav.newAgent')}</h1>
            </div>

            {/* Stepper — 2 steps */}
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

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '640px', marginBottom: '16px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px' }}>
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
                <div style={{ background: 'var(--error-subtle)', color: 'var(--error)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ maxWidth: '640px' }}>
                {/* Step 1: Identity — "Who is this?" */}
                {phase === 'identity' && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.step1New.title')}
                        </h3>

                        {/* Name */}
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

                        {/* Role */}
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

                        {/* Profile extras — collapsible */}
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

                        {/* Communication style — collapsible */}
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

                        {/* AI Model — single dropdown */}
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

                {/* Step 2: Abilities — "What can they do?" */}
                {phase === 'abilities' && (
                    <div>
                        <h3 style={{ marginBottom: '6px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.abilities.title')}
                        </h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {t('wizard.abilities.description')}
                        </p>

                        {/* Fallback model */}
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
