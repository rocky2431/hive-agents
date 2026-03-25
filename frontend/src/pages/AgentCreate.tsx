import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi, enterpriseApi, orgApi, skillApi } from '../services/api';
import type { Agent, AgentCreateInput } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ModelSelector } from '@/components/domain/model-selector';

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
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <div className="text-5xl mb-4">&#10003;</div>
                <h2 className="text-xl font-semibold mb-3">
                    {t('wizard.success.title', { name: createdAgentName })}
                </h2>
                <div className="flex gap-3 mt-5">
                    <Button onClick={() => navigate(`/agents/${createdAgentId}`, { state: { openChat: true } })}>
                        {t('wizard.success.startChat')}
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/agents/${createdAgentId}`)}>
                        {t('wizard.success.connectChannel')}
                    </Button>
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
                    <div key={i} className="contents">
                        <div className={`wizard-step ${i === stepIndex ? 'active' : i < stepIndex ? 'completed' : ''}`}>
                            <div className="wizard-step-number">{i < stepIndex ? '\u2713' : i + 1}</div>
                            <span>{label}</span>
                        </div>
                        {i < stepLabels.length - 1 && <div className="wizard-connector" />}
                    </div>
                ))}
            </div>

            <div className="flex justify-between max-w-[760px] mb-4 sticky top-0 z-10 bg-surface-primary pt-1 pb-1">
                <Button
                    variant="secondary"
                    onClick={() => {
                        if (phase === 'identity') navigate(-1);
                        else if (phase === 'abilities') setPhase('identity');
                    }}
                    disabled={createMutation.isPending}
                >
                    {phase === 'identity' ? t('common.cancel') : t('wizard.prev')}
                </Button>
                {phase === 'identity' ? (
                    <Button onClick={handleNextToAbilities}>
                        {t('wizard.next')} &rarr;
                    </Button>
                ) : (
                    <Button onClick={handleCreate} loading={createMutation.isPending}>
                        {createMutation.isPending ? t('common.loading') : t('wizard.finish')}
                    </Button>
                )}
            </div>

            {error && (
                <div className="bg-error-subtle text-error px-3 py-2 rounded-md text-xs mb-4 max-w-[760px]">
                    {error}
                </div>
            )}

            <Card className="max-w-[760px]">
                <CardContent className="pt-4">
                    {phase === 'identity' && (
                        <div>
                            <h3 className="mb-5 font-semibold text-[15px]">
                                {t('wizard.step1New.title')}
                            </h3>

                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="agent-name" error={!!fieldErrors.name}>
                                        {t('agent.fields.name')} *
                                    </Label>
                                    <Input
                                        id="agent-name"
                                        error={!!fieldErrors.name}
                                        value={form.name}
                                        onChange={(e) => {
                                            setForm({ ...form, name: e.target.value });
                                            clearFieldError('name');
                                        }}
                                        placeholder={t('wizard.step1.namePlaceholder')}
                                        autoFocus
                                        autoComplete="off"
                                    />
                                    {fieldErrors.name && (
                                        <p className="text-error text-xs mt-1">{fieldErrors.name}</p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="agent-role" error={!!fieldErrors.role_description}>
                                        {t('agent.fields.role')} *
                                    </Label>
                                    <Textarea
                                        id="agent-role"
                                        error={!!fieldErrors.role_description}
                                        rows={2}
                                        value={form.role_description}
                                        onChange={(e) => {
                                            setForm({ ...form, role_description: e.target.value });
                                            clearFieldError('role_description');
                                        }}
                                        placeholder={t('wizard.roleHint')}
                                    />
                                    {fieldErrors.role_description && (
                                        <p className="text-error text-xs mt-1">{fieldErrors.role_description}</p>
                                    )}
                                </div>
                            </div>

                            <details className="mb-4 mt-4">
                                <summary className="cursor-pointer text-xs font-medium text-content-secondary mb-2">
                                    {t('wizard.identity.profileExtras', 'Profile extras (bio, avatar, welcome message)')}
                                </summary>
                                <div className="flex flex-col gap-3 pt-2">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="agent-bio">
                                            {t('wizard.step1.bio', 'Bio / Background')}{' '}
                                            <span className="text-[11px] text-content-tertiary font-normal">({t('common.optional', 'optional')})</span>
                                        </Label>
                                        <Textarea
                                            id="agent-bio"
                                            rows={2}
                                            value={form.bio}
                                            onChange={(e) => setForm({ ...form, bio: e.target.value })}
                                            placeholder={t('wizard.step1.bioPlaceholder', 'Brief background about this agent…')}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="agent-avatar">
                                            {t('wizard.step1.avatarUrl', 'Avatar URL')}{' '}
                                            <span className="text-[11px] text-content-tertiary font-normal">({t('common.optional', 'optional')})</span>
                                        </Label>
                                        <Input
                                            id="agent-avatar"
                                            value={form.avatar_url}
                                            onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                                            placeholder="https://…"
                                            autoComplete="url"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="agent-welcome">
                                            {t('wizard.step1.welcomeMessage', 'Welcome Message')}{' '}
                                            <span className="text-[11px] text-content-tertiary font-normal">({t('common.optional', 'optional')})</span>
                                        </Label>
                                        <Textarea
                                            id="agent-welcome"
                                            rows={2}
                                            value={form.welcome_message}
                                            onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
                                            placeholder={t('wizard.step1.welcomeMessagePlaceholder', 'Message shown when users first interact with this agent')}
                                        />
                                    </div>
                                </div>
                            </details>

                            <details className="mb-4">
                                <summary className="cursor-pointer text-xs font-medium text-content-secondary mb-2">
                                    {t('wizard.identity.communicationStyle')}
                                </summary>
                                <div className="flex flex-col gap-3 pt-2">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="agent-personality">{t('agent.fields.personality')}</Label>
                                        <Textarea
                                            id="agent-personality"
                                            rows={2}
                                            value={form.personality}
                                            onChange={(e) => setForm({ ...form, personality: e.target.value })}
                                            placeholder={t('wizard.step2.personalityPlaceholder')}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="agent-boundaries">{t('agent.fields.boundaries')}</Label>
                                        <Textarea
                                            id="agent-boundaries"
                                            rows={2}
                                            value={form.boundaries}
                                            onChange={(e) => setForm({ ...form, boundaries: e.target.value })}
                                            placeholder={t('wizard.step2.boundariesPlaceholder')}
                                        />
                                    </div>
                                </div>
                            </details>

                            <div className="space-y-1.5">
                                <ModelSelector
                                    value={form.primary_model_id}
                                    onChange={(modelId) => {
                                        setForm({ ...form, primary_model_id: modelId });
                                        clearFieldError('primary_model_id');
                                    }}
                                    label={`${t('wizard.identity.aiModel')} *`}
                                    error={!!fieldErrors.primary_model_id}
                                />
                                {fieldErrors.primary_model_id && (
                                    <p className="text-error text-xs mt-1">{fieldErrors.primary_model_id}</p>
                                )}
                                {enabledModels.length === 0 && (
                                    <div className="p-4 bg-surface-elevated rounded-lg text-xs text-content-tertiary text-center">
                                        {t('wizard.step1.noModels')}{' '}
                                        <span
                                            className="text-accent-primary cursor-pointer"
                                            onClick={() => navigate('/enterprise')}
                                        >
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
                            <h3 className="mb-1.5 font-semibold text-[15px]">
                                {t('wizard.abilities.title')}
                            </h3>
                            <p className="text-xs text-content-secondary mb-4">
                                {t('wizard.abilities.description')}
                            </p>

                            {enabledModels.length > 0 && (
                                <div className="mb-5">
                                    <ModelSelector
                                        value={form.fallback_model_id}
                                        onChange={(modelId) => setForm({ ...form, fallback_model_id: modelId })}
                                        label={t('wizard.step2.fallbackModel', 'Fallback Model')}
                                        description={t('common.optional', 'optional')}
                                    />
                                </div>
                            )}

                            <div className="mb-5 space-y-1.5">
                                <Label htmlFor="agent-class">{t('wizard.abilities.agentClass', 'Agent class')}</Label>
                                <Select
                                    value={form.agent_class}
                                    onValueChange={(val) => setForm({ ...form, agent_class: val as AgentCreateFormState['agent_class'] })}
                                >
                                    <SelectTrigger id="agent-class">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AGENT_CLASS_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {t(option.labelKey, option.fallbackLabel)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-content-tertiary mt-1.5">
                                    {t(
                                        AGENT_CLASS_OPTIONS.find((option) => option.value === form.agent_class)?.descKey || 'wizard.abilities.agentClassInternalTenantDesc',
                                        AGENT_CLASS_OPTIONS.find((option) => option.value === form.agent_class)?.fallbackDesc || '',
                                    )}
                                </p>
                            </div>

                            <div className="mb-5 space-y-1.5">
                                <Label htmlFor="security-zone">{t('wizard.abilities.securityZone', 'Security zone')}</Label>
                                <Select
                                    value={form.security_zone}
                                    onValueChange={(val) => setForm({ ...form, security_zone: val as AgentCreateFormState['security_zone'] })}
                                >
                                    <SelectTrigger id="security-zone">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {SECURITY_ZONE_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {t(option.labelKey, option.fallbackLabel)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-content-tertiary mt-1.5">
                                    {t(
                                        SECURITY_ZONE_OPTIONS.find((option) => option.value === form.security_zone)?.descKey || 'wizard.abilities.securityZoneStandardDesc',
                                        SECURITY_ZONE_OPTIONS.find((option) => option.value === form.security_zone)?.fallbackDesc || '',
                                    )}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-5">
                                <div className="space-y-1.5">
                                    <Label htmlFor="daily-limit">{t('wizard.abilities.dailyTokenLimit', 'Daily token limit')}</Label>
                                    <Input
                                        id="daily-limit"
                                        type="number"
                                        min={0}
                                        value={form.max_tokens_per_day}
                                        onChange={(e) => setForm({ ...form, max_tokens_per_day: e.target.value ? Number(e.target.value) : '' })}
                                        placeholder={t('wizard.abilities.unlimitedPlaceholder', 'Leave empty for unlimited')}
                                        autoComplete="off"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="monthly-limit">{t('wizard.abilities.monthlyTokenLimit', 'Monthly token limit')}</Label>
                                    <Input
                                        id="monthly-limit"
                                        type="number"
                                        min={0}
                                        value={form.max_tokens_per_month}
                                        onChange={(e) => setForm({ ...form, max_tokens_per_month: e.target.value ? Number(e.target.value) : '' })}
                                        placeholder={t('wizard.abilities.unlimitedPlaceholder', 'Leave empty for unlimited')}
                                        autoComplete="off"
                                    />
                                </div>
                            </div>

                            <div className="mb-5 space-y-2.5">
                                <Label>{t('wizard.abilities.permissionScope', 'Who can access this agent')}</Label>
                                <div className="flex flex-col gap-2.5">
                                    <label
                                        className={`flex gap-2.5 items-start p-3 rounded-lg border cursor-pointer ${
                                            form.permission_scope_type === 'company'
                                                ? 'border-accent-primary bg-accent-subtle'
                                                : 'border-edge-default bg-surface-elevated'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="permission_scope_type"
                                            checked={form.permission_scope_type === 'company'}
                                            onChange={() => setForm((prev) => ({ ...prev, permission_scope_type: 'company' }))}
                                        />
                                        <div>
                                            <div className="font-medium text-xs">{t('wizard.abilities.companyScope', 'Entire company')}</div>
                                            <div className="text-xs text-content-tertiary mt-0.5">
                                                {t('wizard.abilities.companyScopeDesc', 'Everyone in the current workspace can discover and use this agent.')}
                                            </div>
                                        </div>
                                    </label>
                                    <label
                                        className={`flex gap-2.5 items-start p-3 rounded-lg border cursor-pointer ${
                                            form.permission_scope_type === 'user'
                                                ? 'border-accent-primary bg-accent-subtle'
                                                : 'border-edge-default bg-surface-elevated'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="permission_scope_type"
                                            checked={form.permission_scope_type === 'user'}
                                            onChange={() => setForm((prev) => ({ ...prev, permission_scope_type: 'user' }))}
                                        />
                                        <div>
                                            <div className="font-medium text-xs">{t('wizard.abilities.shareWithUsers', 'Specific users only')}</div>
                                            <div className="text-xs text-content-tertiary mt-0.5">
                                                {t('wizard.abilities.shareWithUsersDesc', 'Select exactly who should have access. Leave the list empty to keep it creator-only.')}
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {form.permission_scope_type === 'user' && (
                                <Card className="mb-5">
                                    <CardContent className="p-3">
                                        <div className="flex justify-between gap-3 items-center mb-2.5">
                                            <div>
                                                <div className="text-xs font-semibold">{t('wizard.abilities.shareWithUsers', 'Specific users only')}</div>
                                                <div className="text-xs text-content-tertiary mt-1">
                                                    {t('wizard.abilities.creatorOnlyFallback', 'If you do not select anyone, only the creator will be granted manage access.')}
                                                </div>
                                            </div>
                                            <Input
                                                value={memberSearch}
                                                onChange={(e) => setMemberSearch(e.target.value)}
                                                placeholder={t('wizard.abilities.searchUsers', 'Search users by name or email')}
                                                className="max-w-[260px]"
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto">
                                            {filteredOrgUsers.map((user: any) => (
                                                <label
                                                    key={user.id}
                                                    className={`flex gap-2 items-start p-2.5 rounded-lg border ${
                                                        form.permission_scope_ids.includes(user.id)
                                                            ? 'bg-accent-subtle'
                                                            : 'bg-surface-elevated'
                                                    } border-edge-default`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={form.permission_scope_ids.includes(user.id)}
                                                        onChange={() => togglePermissionUser(user.id)}
                                                    />
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-medium">{user.display_name || user.username}</div>
                                                        <div className="text-[11px] text-content-tertiary overflow-hidden text-ellipsis">
                                                            {user.email}
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                            {filteredOrgUsers.length === 0 && (
                                                <div className="col-span-full p-4 text-center text-xs text-content-tertiary">
                                                    {t('wizard.abilities.noUsersFound', 'No matching users found in the current workspace.')}
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            <div className="mb-5 space-y-1.5">
                                <Label htmlFor="access-level">{t('wizard.abilities.defaultAccessLevel', 'Default access level')}</Label>
                                <Select
                                    value={form.permission_access_level}
                                    onValueChange={(val) => setForm({ ...form, permission_access_level: val as AgentCreateFormState['permission_access_level'] })}
                                >
                                    <SelectTrigger id="access-level">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="use">{t('wizard.abilities.accessUse', 'Use')}</SelectItem>
                                        <SelectItem value="manage">{t('wizard.abilities.accessManage', 'Manage')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-2">
                                {globalSkills.map((skill: any) => {
                                    const isDefault = skill.is_default;
                                    const isChecked = form.skill_ids.includes(skill.id);
                                    return (
                                        <label
                                            key={skill.id}
                                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                                                isChecked
                                                    ? 'bg-accent-subtle border-accent-primary'
                                                    : 'bg-surface-elevated border-edge-default'
                                            } ${isDefault ? 'cursor-default' : ''}`}
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
                                            <div className="text-lg">{skill.icon}</div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-medium text-xs">{skill.name}</span>
                                                    {isDefault && (
                                                        <Badge className="text-[10px] px-1.5 py-0">
                                                            {t('wizard.abilities.recommendedBadge')}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-content-tertiary mt-0.5">
                                                    {skill.description}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                                {globalSkills.length === 0 && (
                                    <div className="p-4 bg-surface-elevated rounded-lg text-xs text-content-tertiary text-center">
                                        {t('wizard.abilities.noSkills')}
                                    </div>
                                )}
                            </div>

                            <div className="mt-5 p-3 bg-surface-secondary rounded-lg text-xs text-content-secondary">
                                {t('wizard.abilities.approvalHint')}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
