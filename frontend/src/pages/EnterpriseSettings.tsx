import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
import { adminApi, enterpriseApi, auditApi, capabilityApi, onboardingApi, oidcApi, packApi } from '../services/api';
import PromptModal from '../components/PromptModal';
import { saveAccentColor, getSavedAccentColor, resetAccentColor, PRESET_COLORS } from '../utils/theme';
import { useAuthStore } from '../stores';
import { canEditCompanyProfile, canManageCompanyLifecycle } from '../lib/companyPermissions';
import UserManagement from './UserManagement';
import InvitationCodes from './InvitationCodes';
import {
    OrgTab,
    ThemeColorPicker,
    PlatformSettings,
    EnterpriseKBBrowser,
    SkillsTab,
    NotificationBarConfig,
    CompanyNameEditor,
    CompanyTimezoneEditor,
    FeatureFlagsTab,
    MemoryTab,
    FALLBACK_LLM_PROVIDERS,
    fetchJson,
    type LLMModel,
    type LLMProviderSpec,
} from './enterprise';

export default function EnterpriseSettings() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const TAB_KEYS = ['info', 'llm', 'org', 'approvals', 'audit', 'mcp', 'skills', 'quotas', 'users', 'flags', 'invites', 'memory', 'sso', 'capabilities', 'config', 'kb'] as const;
    type TabKey = (typeof TAB_KEYS)[number];

    interface SidebarGroup {
        key: string;
        tabs: TabKey[];
    }

    const SIDEBAR_GROUPS: SidebarGroup[] = [
        { key: 'overview', tabs: ['info'] },
        { key: 'team', tabs: ['users', 'invites', 'org', 'sso', 'quotas'] },
        { key: 'ai', tabs: ['llm', 'skills', 'mcp', 'memory'] },
        { key: 'security', tabs: ['capabilities', 'approvals', 'audit'] },
        { key: 'platform', tabs: ['config', 'kb', 'flags'] },
    ];

    const [activeTab, setActiveTab] = useQueryState(
        'tab',
        parseAsStringLiteral(TAB_KEYS).withDefault('info'),
    );

    // OpenViking status for KB tab
    const { data: vikingStatus } = useQuery({
        queryKey: ['openviking-status'],
        queryFn: enterpriseApi.openvikingStatus,
        refetchInterval: 60000,
        retry: false,
    });

    // Track selected tenant as state so page refreshes on company switch
    const [selectedTenantId, setSelectedTenantId] = useState(localStorage.getItem('current_tenant_id') || '');
    const [companyLifecycleSaving, setCompanyLifecycleSaving] = useState(false);
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === 'current_tenant_id') {
                setSelectedTenantId(e.newValue || '');
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);
    const { data: selectedTenant } = useQuery({
        queryKey: ['tenant-detail', selectedTenantId],
        queryFn: () => fetchJson<any>(`/tenants/${selectedTenantId}`),
        enabled: !!selectedTenantId && canEditCompanyProfile(user?.role),
    });

    // Tenant quota defaults
    const defaultQuotaForm = {
        default_message_limit: 50, default_message_period: 'permanent',
        default_max_agents: 2, default_agent_ttl_hours: 48,
        default_max_llm_calls_per_day: 100, min_heartbeat_interval_minutes: 120,
        default_max_triggers: 20, min_poll_interval_floor: 5, max_webhook_rate_ceiling: 5,
    };
    const [quotaForm, setQuotaForm] = useState(defaultQuotaForm);
    const [quotaSaving, setQuotaSaving] = useState(false);
    const [quotaSaved, setQuotaSaved] = useState(false);
    useEffect(() => {
        if (activeTab === 'quotas') {
            setQuotaForm(defaultQuotaForm);
            fetchJson<any>(`/enterprise/tenant-quotas${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`).then(d => {
                if (d && Object.keys(d).length) setQuotaForm(f => ({ ...f, ...d }));
            }).catch(() => { /* non-critical: quota form uses defaults if fetch fails */ });
        }
    }, [activeTab, selectedTenantId]);
    const saveQuotas = async () => {
        setQuotaSaving(true);
        try {
            await fetchJson(`/enterprise/tenant-quotas${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'PATCH', body: JSON.stringify(quotaForm) });
            setQuotaSaved(true); setTimeout(() => setQuotaSaved(false), 2000);
        } catch (e) { alert('Failed to save'); }
        setQuotaSaving(false);
    };
    const [companyIntro, setCompanyIntro] = useState('');
    const [companyIntroSaving, setCompanyIntroSaving] = useState(false);
    const [companyIntroSaved, setCompanyIntroSaved] = useState(false);

    // Company intro key: always per-tenant scoped
    const companyIntroKey = selectedTenantId ? `company_intro_${selectedTenantId}` : 'company_intro';

    // Load Company Intro (tenant-scoped only, no fallback to global)
    useEffect(() => {
        setCompanyIntro('');
        if (!selectedTenantId) return;
        const tenantKey = `company_intro_${selectedTenantId}`;
        fetchJson<any>(`/enterprise/system-settings/${tenantKey}`)
            .then(d => {
                if (d?.value?.content) {
                    setCompanyIntro(d.value.content);
                }
                // No fallback — each company starts empty with placeholder watermark
            })
            .catch(() => { /* non-critical: company intro starts empty if fetch fails */ });
    }, [selectedTenantId]);

    const saveCompanyIntro = async () => {
        setCompanyIntroSaving(true);
        try {
            await fetchJson(`/enterprise/system-settings/${companyIntroKey}`, {
                method: 'PUT', body: JSON.stringify({ value: { content: companyIntro } }),
            });
            setCompanyIntroSaved(true);
            setTimeout(() => setCompanyIntroSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setCompanyIntroSaving(false);
    };
    const handleToggleCompanyLifecycle = async () => {
        if (!selectedTenantId || !selectedTenant || !canManageCompanyLifecycle(user?.role)) return;
        const isDisabling = selectedTenant.is_active !== false;
        const confirmMessage = isDisabling
            ? t('enterprise.companyLifecycle.disableConfirm', 'Disable this company? Its users will lose access and running digital employees will be paused.')
            : t('enterprise.companyLifecycle.enableConfirm', 'Enable this company again? Users will be able to access it again.');
        if (!confirm(confirmMessage)) return;
        setCompanyLifecycleSaving(true);
        try {
            await adminApi.toggleCompany(selectedTenantId);
            qc.invalidateQueries({ queryKey: ['tenant-detail', selectedTenantId] });
            qc.invalidateQueries({ queryKey: ['tenants'] });
        } catch (e: any) {
            alert(e.message || t('enterprise.companyLifecycle.toggleFailed', 'Failed to update company status'));
        }
        setCompanyLifecycleSaving(false);
    };
    const [auditFilter, setAuditFilter] = useState<'all' | 'background' | 'actions'>('all');
    // ─── New Audit state (rich search/filter/pagination)
    const [auditSearch, setAuditSearch] = useState('');
    const [auditEventType, setAuditEventType] = useState('');
    const [auditSeverity, setAuditSeverity] = useState('');
    const [auditDateFrom, setAuditDateFrom] = useState('');
    const [auditDateTo, setAuditDateTo] = useState('');
    const [auditPage, setAuditPage] = useState(1);
    const [auditPageSize] = useState(20);
    const [auditChainResult, setAuditChainResult] = useState<Record<string, { valid: boolean; event_hash: string; computed_hash: string } | null>>({});

    // ─── SSO state
    const [ssoForm, setSsoForm] = useState({ issuer_url: '', client_id: '', client_secret: '', scopes: 'openid profile email', auto_provision: false, display_name: '' });
    const [ssoSaving, setSsoSaving] = useState(false);
    const [ssoSaved, setSsoSaved] = useState(false);
    const [ssoLoaded, setSsoLoaded] = useState(false);

    // ─── Capabilities state
    const [capSaving, setCapSaving] = useState<string | null>(null);
    const [packSaving, setPackSaving] = useState<string | null>(null);
    const [mcpForm, setMcpForm] = useState({ server_id: '', mcp_url: '', server_name: '', api_key: '' });
    const [mcpError, setMcpError] = useState('');

    const [infoRefresh, setInfoRefresh] = useState(0);
    const [kbPromptModal, setKbPromptModal] = useState(false);
    const [kbToast, setKbToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const showKbToast = (message: string, type: 'success' | 'error' = 'success') => {
        setKbToast({ message, type });
        setTimeout(() => setKbToast(null), 3000);
    };

    // ─── Stats (scoped to selected tenant)
    const { data: stats } = useQuery({
        queryKey: ['enterprise-stats', selectedTenantId],
        queryFn: () => fetchJson<any>(`/enterprise/stats${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
    });

    // ─── LLM Models
    const { data: models = [] } = useQuery({
        queryKey: ['llm-models', selectedTenantId],
        queryFn: () => fetchJson<LLMModel[]>(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
        enabled: activeTab === 'llm',
    });
    const [showAddModel, setShowAddModel] = useState(false);
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const [modelForm, setModelForm] = useState({ provider: 'anthropic', model: '', api_key: '', base_url: '', label: '', supports_vision: false, max_output_tokens: '' as string, max_input_tokens: '' as string });
    const { data: providerSpecs = [] } = useQuery({
        queryKey: ['llm-provider-specs'],
        queryFn: () => fetchJson<LLMProviderSpec[]>('/enterprise/llm-providers'),
        enabled: activeTab === 'llm',
    });
    const providerOptions = providerSpecs.length > 0 ? providerSpecs : FALLBACK_LLM_PROVIDERS;
    const addModel = useMutation({
        mutationFn: (data: any) => fetchJson(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'POST', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); setShowAddModel(false); setEditingModelId(null); },
    });
    const updateModel = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => fetchJson(`/enterprise/llm-models/${id}${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); setShowAddModel(false); setEditingModelId(null); },
    });
    const deleteModel = useMutation({
        mutationFn: async ({ id, force = false }: { id: string; force?: boolean }) => {
            const url = force
                ? `/enterprise/llm-models/${id}${selectedTenantId ? `?force=true&tenant_id=${selectedTenantId}` : '?force=true'}`
                : `/enterprise/llm-models/${id}${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`;
            const res = await fetch(`/api${url}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            if (res.status === 409) {
                const data = await res.json();
                const agents = data.detail?.agents || [];
                const msg = `This model is used by ${agents.length} agent(s):\n\n${agents.join(', ')}\n\nDelete anyway? (their model config will be cleared)`;
                if (confirm(msg)) {
                    // Retry with force
                    const retryUrl = selectedTenantId
                        ? `/api/v1/enterprise/llm-models/${id}?force=true&tenant_id=${selectedTenantId}`
                        : `/api/v1/enterprise/llm-models/${id}?force=true`;
                    const r2 = await fetch(retryUrl, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                    });
                    if (!r2.ok && r2.status !== 204) throw new Error('Delete failed');
                }
                return;
            }
            if (!res.ok && res.status !== 204) throw new Error('Delete failed');
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }),
    });

    // ─── Approvals
    const { data: approvals = [] } = useQuery({
        queryKey: ['approvals', selectedTenantId],
        queryFn: () => fetchJson<any[]>(`/enterprise/approvals${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
        enabled: activeTab === 'approvals',
    });
    const resolveApproval = useMutation({
        mutationFn: ({ id, action }: { id: string; action: string }) =>
            fetchJson(`/enterprise/approvals/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', selectedTenantId] }),
    });

    // ─── Audit Logs (rich query via auditApi)
    const auditQueryParams = {
        search: auditSearch || undefined,
        event_type: auditEventType || undefined,
        severity: auditSeverity || undefined,
        date_from: auditDateFrom || undefined,
        date_to: auditDateTo || undefined,
        page: auditPage,
        page_size: auditPageSize,
    };
    const { data: auditData } = useQuery({
        queryKey: ['audit-events', auditSearch, auditEventType, auditSeverity, auditDateFrom, auditDateTo, auditPage, auditPageSize],
        queryFn: () => auditApi.query(auditQueryParams),
        enabled: activeTab === 'audit',
    });
    const auditEvents = auditData?.items || [];
    const auditTotal = auditData?.total || 0;
    const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

    const handleAuditExport = async () => {
        const res = await auditApi.exportCsv({
            search: auditSearch || undefined,
            event_type: auditEventType || undefined,
            severity: auditSeverity || undefined,
            date_from: auditDateFrom || undefined,
            date_to: auditDateTo || undefined,
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleVerifyChain = async (eventId: string) => {
        try {
            const result = await auditApi.verifyChain(eventId);
            setAuditChainResult(prev => ({ ...prev, [eventId]: result }));
        } catch {
            setAuditChainResult(prev => ({ ...prev, [eventId]: null }));
        }
    };

    // ─── SSO Config
    useEffect(() => {
        if (activeTab === 'sso') {
            setSsoLoaded(false);
            oidcApi.getConfig(selectedTenantId || undefined).then((cfg: any) => {
                if (cfg) {
                    setSsoForm(f => ({
                        ...f,
                        issuer_url: cfg.issuer_url || '',
                        client_id: cfg.client_id || '',
                        client_secret: '',
                        scopes: cfg.scopes || 'openid profile email',
                        auto_provision: cfg.auto_provision ?? false,
                        display_name: cfg.display_name || '',
                    }));
                }
                setSsoLoaded(true);
            }).catch(() => { setSsoLoaded(true); /* non-critical: SSO form shows empty config if fetch fails */ });
        }
    }, [activeTab, selectedTenantId]);

    const saveSsoConfig = async () => {
        setSsoSaving(true);
        try {
            await oidcApi.updateConfig(ssoForm, selectedTenantId || undefined);
            setSsoSaved(true);
            setTimeout(() => setSsoSaved(false), 2000);
        } catch {
            // error handling
        }
        setSsoSaving(false);
    };

    // ─── Packs
    const { data: packCatalog = [], isLoading: packsLoading } = useQuery({
        queryKey: ['pack-catalog'],
        queryFn: () => packApi.catalog(),
        enabled: activeTab === 'mcp',
    });
    const { data: tenantMcpServers = [], isLoading: mcpLoading } = useQuery({
        queryKey: ['tenant-mcp-registry'],
        queryFn: () => packApi.mcpRegistry(),
        enabled: activeTab === 'mcp',
    });
    const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});

    // ─── Capabilities
    const { data: capDefinitions = [] } = useQuery({
        queryKey: ['cap-definitions'],
        queryFn: () => capabilityApi.definitions(),
        enabled: activeTab === 'capabilities',
    });
    const { data: capPolicies = [] } = useQuery({
        queryKey: ['cap-policies'],
        queryFn: () => capabilityApi.list(),
        enabled: activeTab === 'capabilities',
    });

    const handleCapUpsert = async (capability: string, allowed: boolean, requiresApproval: boolean) => {
        setCapSaving(capability);
        try {
            await capabilityApi.upsert({ capability, allowed, requires_approval: requiresApproval });
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
        setCapSaving(null);
    };

    const handleCapDelete = async (policyId: string) => {
        try {
            await capabilityApi.delete(policyId);
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
    };

    const handlePackPolicy = async (packName: string, enabled: boolean) => {
        setPackSaving(packName);
        try {
            await packApi.updatePolicy(packName, enabled);
            qc.invalidateQueries({ queryKey: ['pack-catalog'] });
        } finally {
            setPackSaving(null);
        }
    };

    const handleImportMcp = async () => {
        setMcpError('');
        try {
            const payload = {
                server_id: mcpForm.server_id.trim() || undefined,
                mcp_url: mcpForm.mcp_url.trim() || undefined,
                server_name: mcpForm.server_name.trim() || undefined,
                config: mcpForm.api_key.trim() ? { api_key: mcpForm.api_key.trim() } : undefined,
            };
            await packApi.importMcp(payload);
            setMcpForm({ server_id: '', mcp_url: '', server_name: '', api_key: '' });
            qc.invalidateQueries({ queryKey: ['tenant-mcp-registry'] });
            qc.invalidateQueries({ queryKey: ['pack-catalog'] });
        } catch (e: any) {
            setMcpError(e?.message || 'Import failed');
        }
    };

    const handleDeleteMcp = async (serverKey: string) => {
        await packApi.deleteMcp(serverKey);
        qc.invalidateQueries({ queryKey: ['tenant-mcp-registry'] });
        qc.invalidateQueries({ queryKey: ['pack-catalog'] });
    };

    // ─── Onboarding
    const { data: onboardingData } = useQuery({
        queryKey: ['onboarding-status'],
        queryFn: () => onboardingApi.status(),
        enabled: activeTab === 'info',
    });

    return (
        <>
            <div>
                <div className="page-header">
                    <div>
                        <h1 className="page-title">{t('nav.enterprise')}</h1>
                        {stats && (
                            <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                                <span className="badge badge-info">{t('enterprise.stats.users', { count: stats.total_users })}</span>
                                <span className="badge badge-success">{t('enterprise.stats.runningAgents', { running: stats.running_agents, total: stats.total_agents })}</span>
                                {stats.pending_approvals > 0 && <span className="badge badge-warning">{stats.pending_approvals} {t('enterprise.tabs.approvals')}</span>}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0', marginTop: '4px' }}>
                {/* ── Left Sidebar Navigation ── */}
                <nav style={{
                    width: '200px',
                    minWidth: '200px',
                    borderRight: '1px solid var(--border-subtle)',
                    padding: '16px 0',
                    position: 'sticky',
                    top: 0,
                    alignSelf: 'flex-start',
                }}>
                    {SIDEBAR_GROUPS.map(group => (
                        <div key={group.key} style={{ marginBottom: '8px' }}>
                            <div style={{
                                padding: '8px 16px',
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'uppercase' as const,
                                color: 'var(--text-tertiary)',
                                letterSpacing: '0.5px',
                            }}>
                                {t(`enterprise.groups.${group.key}`, group.key)}
                            </div>
                            {group.tabs.map(tab => (
                                <div
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    style={{
                                        padding: '6px 16px 6px 28px',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        borderRadius: '6px',
                                        margin: '0 8px',
                                        transition: 'background 0.12s ease',
                                        ...(activeTab === tab
                                            ? { background: 'var(--accent-subtle, rgba(99,102,241,0.08))', color: 'var(--accent-primary, #6366f1)', fontWeight: 500 }
                                            : { color: 'var(--text-secondary)' }),
                                    }}
                                    onMouseEnter={e => { if (activeTab !== tab) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.04)'; }}
                                    onMouseLeave={e => { if (activeTab !== tab) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                >
                                    {t(`enterprise.tabs.${tab}`, tab)}
                                </div>
                            ))}
                        </div>
                    ))}
                </nav>

                {/* ── Content Area ── */}
                <div style={{ flex: 1, minWidth: 0, padding: '0 0 0 24px' }}>

                {/* ── LLM Model Pool ── */}
                {activeTab === 'llm' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                            <button className="btn btn-primary" onClick={() => {
                                setEditingModelId(null);
                                const defaultSpec = providerOptions[0];
                                setModelForm({
                                    provider: defaultSpec?.provider || 'anthropic',
                                    model: '', api_key: '',
                                    base_url: defaultSpec?.default_base_url || '',
                                    label: '', supports_vision: false,
                                    max_output_tokens: defaultSpec ? String(defaultSpec.default_max_tokens) : '4096',
                                    max_input_tokens: '',
                                });
                                setShowAddModel(true);
                            }}>+ {t('enterprise.llm.addModel')}</button>
                        </div>

                        {/* Add Model form — only shown at top when adding new */}
                        {showAddModel && !editingModelId && (
                            <div className="card" style={{ marginBottom: '16px' }}>
                                <h3 style={{ marginBottom: '16px' }}>{t('enterprise.llm.addModel')}</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div className="form-group">
                                        <label className="form-label">Provider</label>
                                        <select className="form-input" value={modelForm.provider} onChange={e => {
                                            const newProvider = e.target.value;
                                            const spec = providerOptions.find(p => p.provider === newProvider);
                                            const updates: any = { provider: newProvider };
                                            if (spec?.default_base_url) {
                                                updates.base_url = spec.default_base_url;
                                            } else {
                                                updates.base_url = '';
                                            }
                                            if (spec) {
                                                updates.max_output_tokens = String(spec.default_max_tokens);
                                            }
                                            setModelForm(f => ({ ...f, ...updates }));
                                        }}>
                                            {providerOptions.map((p) => (
                                                <option key={p.provider} value={p.provider}>{p.display_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Model</label>
                                        <input className="form-input" placeholder="claude-sonnet-4-5" value={modelForm.model} onChange={e => setModelForm({ ...modelForm, model: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('enterprise.llm.label')}</label>
                                        <input className="form-input" placeholder="Claude Sonnet" value={modelForm.label} onChange={e => setModelForm({ ...modelForm, label: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('enterprise.llm.baseUrl')}</label>
                                        <input className="form-input" placeholder="https://api.custom.com/v1" value={modelForm.base_url} onChange={e => setModelForm({ ...modelForm, base_url: e.target.value })} />
                                    </div>
                                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                        <label className="form-label">API Key</label>
                                        <input className="form-input" type="password" placeholder="Enter API Key" value={modelForm.api_key} onChange={e => setModelForm({ ...modelForm, api_key: e.target.value })} />
                                    </div>
                                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                            <input type="checkbox" checked={modelForm.supports_vision} onChange={e => setModelForm({ ...modelForm, supports_vision: e.target.checked })} />
                                            👁 Supports Vision (Multimodal)
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>— Enable for models that can analyze images (GPT-4o, Claude, Qwen-VL, etc.)</span>
                                        </label>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Max Output Tokens</label>
                                        <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_output_tokens} onChange={e => setModelForm({ ...modelForm, max_output_tokens: e.target.value })} />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the default output token limit. Auto-filled from provider; adjust as needed.</div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Max Input Tokens (Context Window)</label>
                                        <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_input_tokens} onChange={e => setModelForm({ ...modelForm, max_input_tokens: e.target.value })} />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the context window size. Used for conversation compression timing.</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <button className="btn btn-secondary" onClick={() => { setShowAddModel(false); setEditingModelId(null); }}>{t('common.cancel')}</button>
                                    <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} disabled={!modelForm.model || !modelForm.api_key} onClick={async () => {
                                        const btn = document.activeElement as HTMLButtonElement;
                                        const origText = btn?.textContent || '';
                                        if (btn) btn.textContent = 'Testing...';
                                        try {
                                            const testData: any = { provider: modelForm.provider, model: modelForm.model, base_url: modelForm.base_url || undefined };
                                            if (modelForm.api_key) testData.api_key = modelForm.api_key;
                                            const result = await enterpriseApi.llmTest(testData, selectedTenantId || undefined);
                                            if (result.success) {
                                                if (btn) { btn.textContent = `OK (${result.latency_ms}ms)`; btn.style.color = 'var(--success)'; }
                                                setTimeout(() => { if (btn) { btn.textContent = origText; btn.style.color = ''; } }, 3000);
                                            } else {
                                                alert(`Test failed: ${result.error || 'Unknown error'}\n\nLatency: ${result.latency_ms}ms`);
                                                if (btn) btn.textContent = origText;
                                            }
                                        } catch (e: any) {
                                            alert(`Test error: ${e.message}`);
                                            if (btn) btn.textContent = origText;
                                        }
                                    }}>Test</button>
                                    <button className="btn btn-primary" onClick={() => {
                                        const data = { ...modelForm, max_output_tokens: modelForm.max_output_tokens ? Number(modelForm.max_output_tokens) : null, max_input_tokens: modelForm.max_input_tokens ? Number(modelForm.max_input_tokens) : null };
                                        addModel.mutate(data);
                                    }} disabled={!modelForm.model || !modelForm.api_key}>
                                        {t('common.save')}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {models.map((m) => (
                                <div key={m.id}>
                                    {editingModelId === m.id ? (
                                        /* Inline edit form */
                                        <div className="card" style={{ border: '1px solid var(--accent-primary)' }}>
                                            <h3 style={{ marginBottom: '16px' }}>Edit Model</h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                <div className="form-group">
                                                    <label className="form-label">Provider</label>
                                                    <select className="form-input" value={modelForm.provider} onChange={e => {
                                                        const newProvider = e.target.value;
                                                        setModelForm(f => ({ ...f, provider: newProvider }));
                                                    }}>
                                                        {providerOptions.map((p) => (
                                                            <option key={p.provider} value={p.provider}>{p.display_name}</option>
                                                        ))}
                                                        {!providerOptions.some((p) => p.provider === modelForm.provider) && (
                                                            <option value={modelForm.provider}>{modelForm.provider}</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Model</label>
                                                    <input className="form-input" placeholder="claude-sonnet-4-5" value={modelForm.model} onChange={e => setModelForm({ ...modelForm, model: e.target.value })} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">{t('enterprise.llm.label')}</label>
                                                    <input className="form-input" placeholder="Claude Sonnet" value={modelForm.label} onChange={e => setModelForm({ ...modelForm, label: e.target.value })} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">{t('enterprise.llm.baseUrl')}</label>
                                                    <input className="form-input" placeholder="https://api.custom.com/v1" value={modelForm.base_url} onChange={e => setModelForm({ ...modelForm, base_url: e.target.value })} />
                                                </div>
                                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                                    <label className="form-label">API Key</label>
                                                    <input className="form-input" type="password" placeholder="•••••••• (Leave blank to keep unchanged)" value={modelForm.api_key} onChange={e => setModelForm({ ...modelForm, api_key: e.target.value })} />
                                                </div>
                                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                                        <input type="checkbox" checked={modelForm.supports_vision} onChange={e => setModelForm({ ...modelForm, supports_vision: e.target.checked })} />
                                                        👁 Supports Vision (Multimodal)
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>— Enable for models that can analyze images (GPT-4o, Claude, Qwen-VL, etc.)</span>
                                                    </label>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Max Output Tokens</label>
                                                    <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_output_tokens} onChange={e => setModelForm({ ...modelForm, max_output_tokens: e.target.value })} />
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the default output token limit. Auto-filled from provider; adjust as needed.</div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <button className="btn btn-secondary" onClick={() => { setShowAddModel(false); setEditingModelId(null); }}>{t('common.cancel')}</button>
                                                <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} disabled={!modelForm.model} onClick={async () => {
                                                    const btn = document.activeElement as HTMLButtonElement;
                                                    const origText = btn?.textContent || '';
                                                    if (btn) btn.textContent = 'Testing...';
                                                    try {
                                                        const testData: any = { provider: modelForm.provider, model: modelForm.model, base_url: modelForm.base_url || undefined };
                                                        if (modelForm.api_key) testData.api_key = modelForm.api_key;
                                                        testData.model_id = editingModelId;
                                                        const result = await enterpriseApi.llmTest(testData, selectedTenantId || undefined);
                                                        if (result.success) {
                                                            if (btn) { btn.textContent = `OK (${result.latency_ms}ms)`; btn.style.color = 'var(--success)'; }
                                                            setTimeout(() => { if (btn) { btn.textContent = origText; btn.style.color = ''; } }, 3000);
                                                        } else {
                                                            alert(`Test failed: ${result.error || 'Unknown error'}\n\nLatency: ${result.latency_ms}ms`);
                                                            if (btn) btn.textContent = origText;
                                                        }
                                                    } catch (e: any) {
                                                        alert(`Test error: ${e.message}`);
                                                        if (btn) btn.textContent = origText;
                                                    }
                                                }}>Test</button>
                                                <button className="btn btn-primary" onClick={() => {
                                                    const data = { ...modelForm, max_output_tokens: modelForm.max_output_tokens ? Number(modelForm.max_output_tokens) : null, max_input_tokens: modelForm.max_input_tokens ? Number(modelForm.max_input_tokens) : null };
                                                    updateModel.mutate({ id: editingModelId!, data });
                                                }} disabled={!modelForm.model}>
                                                    {t('common.save')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Normal model row */
                                        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{m.label}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                                    {m.provider}/{m.model}
                                                    {m.base_url && <span> · {m.base_url}</span>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span className={`badge ${m.enabled ? 'badge-success' : 'badge-warning'}`}>
                                                    {m.enabled ? t('enterprise.llm.enabled') : t('enterprise.llm.disabled')}
                                                </span>
                                                {m.supports_vision && <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: 'rgb(99,102,241)', fontSize: '10px' }}>👁 Vision</span>}
                                                <button className="btn btn-ghost" onClick={() => {
                                                    setEditingModelId(m.id);
                                                    setModelForm({ provider: m.provider, model: m.model, label: m.label, base_url: m.base_url || '', api_key: m.api_key_masked || '', supports_vision: m.supports_vision || false, max_output_tokens: m.max_output_tokens ? String(m.max_output_tokens) : '', max_input_tokens: m.max_input_tokens ? String(m.max_input_tokens) : '' });
                                                    setShowAddModel(true);
                                                }} style={{ fontSize: '12px' }}>✏️ Edit</button>
                                                <button className="btn btn-ghost" onClick={() => deleteModel.mutate({ id: m.id })} style={{ color: 'var(--error)' }}>{t('common.delete')}</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {models.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                        </div>
                    </div>
                )}

                {/* ── Org Structure ── */}
                {activeTab === 'org' && <OrgTab tenantId={selectedTenantId || undefined} />}

                {/* ── Approvals ── */}
                {activeTab === 'approvals' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {approvals.map((a: any) => (
                            <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontWeight: 500 }}>{a.action_type}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                        {a.agent_name || `Agent ${a.agent_id.slice(0, 8)}`} · {new Date(a.created_at).toLocaleString()}
                                    </div>
                                </div>
                                {a.status === 'pending' ? (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-primary" onClick={() => resolveApproval.mutate({ id: a.id, action: 'approve' })}>{t('common.confirm')}</button>
                                        <button className="btn btn-danger" onClick={() => resolveApproval.mutate({ id: a.id, action: 'reject' })}>Reject</button>
                                    </div>
                                ) : (
                                    <span className={`badge ${a.status === 'approved' ? 'badge-success' : 'badge-error'}`}>
                                        {a.status === 'approved' ? 'Approved' : 'Rejected'}
                                    </span>
                                )}
                            </div>
                        ))}
                        {approvals.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                    </div>
                )}

                {/* ── Audit Logs (Rich) ── */}
                {activeTab === 'audit' && (
                    <div>
                        {/* Search & Filters */}
                        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div style={{ flex: '2 1 200px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.search')}</label>
                                    <input className="input" value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditPage(1); }} placeholder={t('enterprise.audit.search')} style={{ fontSize: '13px' }} />
                                </div>
                                <div style={{ flex: '1 1 160px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.eventType')}</label>
                                    <select className="input" value={auditEventType} onChange={e => { setAuditEventType(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }}>
                                        <option value="">{t('enterprise.audit.filterAll')}</option>
                                        {['auth.login', 'auth.login_failed', 'auth.oidc_login', 'agent.created', 'agent.deleted', 'agent.started', 'agent.stopped', 'approval.resolved', 'capability.denied', 'tool.installed', 'tool.removed', 'model.created', 'model.deleted', 'settings.updated'].map(et => (
                                            <option key={et} value={et}>{et}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ flex: '1 1 120px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.severity')}</label>
                                    <select className="input" value={auditSeverity} onChange={e => { setAuditSeverity(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }}>
                                        <option value="">{t('enterprise.audit.filterAll')}</option>
                                        <option value="info">Info</option>
                                        <option value="warn">Warn</option>
                                        <option value="error">Error</option>
                                    </select>
                                </div>
                                <div style={{ flex: '1 1 140px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.dateRange')}</label>
                                    <input type="date" className="input" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }} />
                                </div>
                                <div style={{ flex: '1 1 140px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>&nbsp;</label>
                                    <input type="date" className="input" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }} />
                                </div>
                                <button className="btn btn-secondary" onClick={handleAuditExport} style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
                                    {t('enterprise.audit.export')}
                                </button>
                            </div>
                        </div>

                        {/* Results count */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t('enterprise.audit.records', { count: auditTotal })}
                            </span>
                        </div>

                        {/* Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                                <thead>
                                    <tr>
                                        <th style={{ whiteSpace: 'nowrap' }}>{t('enterprise.audit.time')}</th>
                                        <th>{t('enterprise.audit.eventType')}</th>
                                        <th>{t('enterprise.audit.severity')}</th>
                                        <th>{t('enterprise.audit.user')}</th>
                                        <th>{t('enterprise.audit.action')}</th>
                                        <th>{t('enterprise.audit.identity')}</th>
                                        <th>{t('enterprise.audit.target')}</th>
                                        <th style={{ width: '80px' }}>{t('enterprise.audit.chain')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditEvents.map((ev: any) => {
                                        const severityColors: Record<string, { bg: string; color: string }> = {
                                            info: { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent-color, #6366f1)' },
                                            warn: { bg: 'rgba(255,159,10,0.12)', color: 'var(--warning, #ff9f0a)' },
                                            error: { bg: 'rgba(255,59,48,0.12)', color: 'var(--error, #ff3b30)' },
                                        };
                                        const sc = severityColors[ev.severity] || severityColors.info;
                                        const chainRes = auditChainResult[ev.id];
                                        const isBot = ev.execution_identity === 'bot' || ev.execution_identity === 'agent';
                                        return (
                                            <tr key={ev.id}>
                                                <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {new Date(ev.created_at || ev.timestamp).toLocaleString()}
                                                </td>
                                                <td>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--bg-tertiary, rgba(255,255,255,0.05))' }}>
                                                        {ev.event_type || ev.action || '-'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: sc.bg, color: sc.color }}>
                                                        {ev.severity || 'info'}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>{ev.actor || ev.user_email || '-'}</td>
                                                <td style={{ fontSize: '12px', fontWeight: 500 }}>{ev.action || ev.event_type || '-'}</td>
                                                <td>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                        <span>{isBot ? '\u{1F916}' : '\u{1F464}'}</span>
                                                        {isBot ? t('enterprise.audit.identityBot') : t('enterprise.audit.identityUser')}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {ev.details ? (typeof ev.details === 'string' ? ev.details.slice(0, 80) : JSON.stringify(ev.details).slice(0, 80)) : '-'}
                                                </td>
                                                <td>
                                                    {chainRes === undefined ? (
                                                        <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '2px 6px' }} onClick={() => handleVerifyChain(ev.id)}>
                                                            {t('enterprise.audit.chain')}
                                                        </button>
                                                    ) : chainRes === null ? (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>-</span>
                                                    ) : (
                                                        <span style={{ fontSize: '11px', color: chainRes.valid ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)' }}>
                                                            {chainRes.valid ? t('enterprise.audit.chainValid') : t('enterprise.audit.chainInvalid')}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {auditEvents.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}

                        {/* Pagination */}
                        {auditTotalPages > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
                                <button className="btn btn-ghost" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)} style={{ fontSize: '12px' }}>
                                    &laquo;
                                </button>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{auditPage} / {auditTotalPages}</span>
                                <button className="btn btn-ghost" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage(p => p + 1)} style={{ fontSize: '12px' }}>
                                    &raquo;
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SSO Tab ── */}
                {activeTab === 'sso' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.sso.title')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.sso.description')}
                        </p>
                        <div className="card" style={{ padding: '16px' }}>
                            {/* Status indicator */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                <span style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: ssoLoaded && ssoForm.issuer_url ? 'var(--success, #34c759)' : 'var(--text-tertiary)',
                                }} />
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {ssoLoaded && ssoForm.issuer_url ? t('enterprise.sso.configured') : t('enterprise.sso.notConfigured')}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.issuerUrl')}</label>
                                    <input className="form-input" value={ssoForm.issuer_url} onChange={e => setSsoForm(f => ({ ...f, issuer_url: e.target.value }))} placeholder={t('enterprise.sso.issuerUrlPlaceholder')} />
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">{t('enterprise.sso.clientId')}</label>
                                        <input className="form-input" value={ssoForm.client_id} onChange={e => setSsoForm(f => ({ ...f, client_id: e.target.value }))} placeholder={t('enterprise.sso.clientIdPlaceholder')} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">{t('enterprise.sso.clientSecret')}</label>
                                        <input className="form-input" type="password" value={ssoForm.client_secret} onChange={e => setSsoForm(f => ({ ...f, client_secret: e.target.value }))} placeholder={t('enterprise.sso.clientSecretPlaceholder')} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.scopes')}</label>
                                    <input className="form-input" value={ssoForm.scopes} onChange={e => setSsoForm(f => ({ ...f, scopes: e.target.value }))} placeholder={t('enterprise.sso.scopesPlaceholder')} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.displayName')}</label>
                                    <input className="form-input" value={ssoForm.display_name} onChange={e => setSsoForm(f => ({ ...f, display_name: e.target.value }))} placeholder={t('enterprise.sso.displayNamePlaceholder')} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="checkbox" id="sso-auto-provision" checked={ssoForm.auto_provision} onChange={e => setSsoForm(f => ({ ...f, auto_provision: e.target.checked }))} />
                                    <label htmlFor="sso-auto-provision" style={{ fontSize: '13px', cursor: 'pointer' }}>{t('enterprise.sso.autoProvision')}</label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.sso.autoProvisionDesc')}</span>
                                </div>
                            </div>
                            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveSsoConfig} disabled={ssoSaving || !ssoForm.issuer_url || !ssoForm.client_id}>
                                    {ssoSaving ? t('common.loading') : t('enterprise.sso.save')}
                                </button>
                                {ssoSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>{t('enterprise.sso.saved')}</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Capabilities Tab ── */}
                {activeTab === 'capabilities' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.capabilities.title')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.capabilities.description')}
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                                <thead>
                                    <tr>
                                        <th>{t('enterprise.capabilities.capability')}</th>
                                        <th>{t('enterprise.capabilities.tools')}</th>
                                        <th style={{ width: '120px' }}>{t('enterprise.audit.severity')}</th>
                                        <th style={{ width: '140px' }}>{t('enterprise.capabilities.requiresApproval')}</th>
                                        <th style={{ width: '100px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {capDefinitions.map((def: any) => {
                                        const policy = capPolicies.find((p: any) => p.capability === def.capability);
                                        const isAllowed = policy ? policy.allowed : true;
                                        const requiresApproval = policy?.requires_approval ?? false;
                                        const isSaving = capSaving === def.capability;
                                        return (
                                            <tr key={def.capability}>
                                                <td style={{ fontWeight: 500 }}>{def.capability}</td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {def.tools?.join(', ') || '-'}
                                                </td>
                                                <td>
                                                    <button
                                                        className="btn btn-ghost"
                                                        disabled={isSaving}
                                                        onClick={() => handleCapUpsert(def.capability, !isAllowed, requiresApproval)}
                                                        style={{
                                                            fontSize: '11px', padding: '2px 10px', borderRadius: '4px',
                                                            background: isAllowed ? 'rgba(34,197,94,0.12)' : 'rgba(255,59,48,0.12)',
                                                            color: isAllowed ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)',
                                                            border: 'none', cursor: 'pointer',
                                                        }}
                                                    >
                                                        {isAllowed ? t('enterprise.capabilities.allowed') : t('enterprise.capabilities.denied')}
                                                    </button>
                                                </td>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={requiresApproval}
                                                        disabled={isSaving}
                                                        onChange={e => handleCapUpsert(def.capability, isAllowed, e.target.checked)}
                                                    />
                                                </td>
                                                <td>
                                                    {policy && (
                                                        <button className="btn btn-ghost" onClick={() => handleCapDelete(policy.id)} style={{ fontSize: '11px', color: 'var(--text-tertiary)', padding: '2px 6px' }}>
                                                            {t('enterprise.capabilities.delete')}
                                                        </button>
                                                    )}
                                                    {!policy && (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.capabilities.noPolicy')}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {capDefinitions.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                    </div>
                )}

                {/* ── Company Management ── */}
                {activeTab === 'info' && (
                    <div>

                        {/* ── Onboarding Progress ── */}
                        {onboardingData && onboardingData.total > 0 && (
                            <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h4 style={{ margin: 0 }}>{t('enterprise.onboarding.title')}</h4>
                                    <span style={{ fontSize: '12px', color: onboardingData.completed === onboardingData.total ? 'var(--success, #34c759)' : 'var(--text-secondary)' }}>
                                        {onboardingData.completed === onboardingData.total
                                            ? t('enterprise.onboarding.allDone')
                                            : t('enterprise.onboarding.completed', { completed: onboardingData.completed, total: onboardingData.total })}
                                    </span>
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                    {t('enterprise.onboarding.description')}
                                </p>
                                {/* Progress bar */}
                                <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-tertiary, rgba(255,255,255,0.06))', marginBottom: '12px', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', borderRadius: '4px',
                                        width: `${(onboardingData.completed / onboardingData.total) * 100}%`,
                                        background: onboardingData.completed === onboardingData.total ? 'var(--success, #34c759)' : 'var(--accent-primary, #6366f1)',
                                        transition: 'width 0.3s ease',
                                    }} />
                                </div>
                                {/* Onboarding items */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {onboardingData.items.map((item: any, idx: number) => (
                                        <div
                                            key={idx}
                                            onClick={() => {
                                                if (item.link) {
                                                    if (item.link.startsWith('/')) {
                                                        window.location.href = item.link;
                                                    } else if (item.tab) {
                                                        setActiveTab(item.tab);
                                                    }
                                                }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '8px 12px', borderRadius: '6px',
                                                background: item.completed ? 'rgba(34,197,94,0.06)' : 'transparent',
                                                border: '1px solid var(--border-subtle)',
                                                cursor: item.link || item.tab ? 'pointer' : 'default',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <span style={{
                                                width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '12px', flexShrink: 0,
                                                background: item.completed ? 'rgba(34,197,94,0.15)' : 'var(--bg-tertiary, rgba(255,255,255,0.06))',
                                                color: item.completed ? 'var(--success, #34c759)' : 'var(--text-tertiary)',
                                            }}>
                                                {item.completed ? '\u2713' : (idx + 1)}
                                            </span>
                                            <span style={{ fontSize: '13px', color: item.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: item.completed ? 'line-through' : 'none' }}>
                                                {t(`enterprise.onboarding.step_${item.key}`, item.title || item.key) as string}
                                            </span>
                                            {(item.link || item.tab) && !item.completed && (
                                                <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent-primary, #6366f1)' }}>&rarr;</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── 0. Company Name ── */}
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.companyName.title', 'Company Name')}</h3>
                        <CompanyNameEditor key={`name-${selectedTenantId}`} />

                        {/* ── 0.5. Company Timezone ── */}
                        <CompanyTimezoneEditor key={`tz-${selectedTenantId}`} />

                        {/* ── 1. Company Intro ── */}
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.companyIntro.title', 'Company Intro')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                            {t('enterprise.companyIntro.description', 'Describe your company\'s mission, products, and culture. This information is included in every agent conversation as context.')}
                        </p>
                        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
                            <textarea
                                className="form-input"
                                value={companyIntro}
                                onChange={e => setCompanyIntro(e.target.value)}
                                placeholder={`# Company Name\nClawith\n\n# About\nOpenClaw\uD83E\uDD9E For Teams\nOpen Source \u00B7 Multi-OpenClaw Collaboration\n\nOpenClaw empowers individuals.\nClawith scales it to frontier organizations.`}
                                style={{
                                    minHeight: '200px', resize: 'vertical',
                                    fontFamily: 'var(--font-mono)', fontSize: '13px',
                                    lineHeight: '1.6', whiteSpace: 'pre-wrap',
                                }}
                            />
                            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveCompanyIntro} disabled={companyIntroSaving}>
                                    {companyIntroSaving ? t('common.loading') : t('common.save', 'Save')}
                                </button>
                                {companyIntroSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ {t('enterprise.config.saved', 'Saved')}</span>}
                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                    💡 {t('enterprise.companyIntro.hint', 'This content appears in every agent\'s system prompt')}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Quotas Tab ── */}
                {activeTab === 'quotas' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.quotas.title', 'Default User Quotas')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.quotas.description', 'These defaults apply to newly registered users. Existing users are not affected.')}
                        </p>
                        <div className="card" style={{ padding: '16px' }}>
                            {/* ── Conversation Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.conversationLimits', 'Conversation Limits')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.messageLimit', 'Message Limit')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_message_limit}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_message_limit: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.messageLimitDesc', 'Max messages per period')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.messagePeriod', 'Message Period')}</label>
                                    <select className="form-input" value={quotaForm.default_message_period}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_message_period: e.target.value })}>
                                        <option value="permanent">{t('enterprise.quotas.permanent', 'Permanent')}</option>
                                        <option value="daily">{t('enterprise.quotas.daily', 'Daily')}</option>
                                        <option value="weekly">{t('enterprise.quotas.weekly', 'Weekly')}</option>
                                        <option value="monthly">{t('enterprise.quotas.monthly', 'Monthly')}</option>
                                    </select>
                                </div>
                            </div>

                            {/* ── Agent Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.agentLimits', 'Agent Limits')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.maxAgents', 'Max Agents')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_max_agents}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_agents: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.maxAgentsDesc', 'Agents a user can create')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.agentTTL', 'Agent TTL (hours)')}</label>
                                    <input className="form-input" type="number" min={1} value={quotaForm.default_agent_ttl_hours}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_agent_ttl_hours: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.agentTTLDesc', 'Agent auto-expiry time from creation')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.dailyLLMCalls', 'Daily LLM Calls / Agent')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_max_llm_calls_per_day}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_llm_calls_per_day: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.dailyLLMCallsDesc', 'Max LLM calls per agent per day')}</div>
                                </div>
                            </div>

                            {/* ── System Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.system', 'System')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.minHeartbeat', 'Min Heartbeat Interval (min)')}</label>
                                    <input className="form-input" type="number" min={1} value={quotaForm.min_heartbeat_interval_minutes}
                                        onChange={e => setQuotaForm({ ...quotaForm, min_heartbeat_interval_minutes: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.minHeartbeatDesc', 'Minimum heartbeat interval for all agents')}</div>
                                </div>
                            </div>

                            {/* ── Trigger Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>Trigger Limits</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.defaultMaxTriggers', 'Default Max Triggers')}</label>
                                    <input className="form-input" type="number" min={1} max={100} value={quotaForm.default_max_triggers}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_triggers: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.defaultMaxTriggersDesc', 'Default trigger limit for new agents')}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.minPollInterval', 'Min Poll Interval (min)')}</label>
                                    <input className="form-input" type="number" min={1} max={60} value={quotaForm.min_poll_interval_floor}
                                        onChange={e => setQuotaForm({ ...quotaForm, min_poll_interval_floor: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.minPollIntervalDesc', 'Company-wide floor: agents cannot poll faster than this')}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.maxWebhookRate', 'Max Webhook Rate (/min)')}</label>
                                    <input className="form-input" type="number" min={1} max={60} value={quotaForm.max_webhook_rate_ceiling}
                                        onChange={e => setQuotaForm({ ...quotaForm, max_webhook_rate_ceiling: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.maxWebhookRateDesc', 'Company-wide ceiling: max webhook hits per minute per agent')}
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveQuotas} disabled={quotaSaving}>
                                    {quotaSaving ? t('common.loading') : t('common.save', 'Save')}
                                </button>
                                {quotaSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ Saved</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Users Tab ── */}
                {activeTab === 'users' && (
                    <UserManagement key={selectedTenantId} />
                )}

                {activeTab === 'mcp' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div className="card">
                            <h3 style={{ marginBottom: '4px' }}>{t('enterprise.importedTools.title')}</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                {t('enterprise.importedTools.description')}
                            </p>
                            <div style={{ marginBottom: '16px' }}>
                                <h4 style={{ marginBottom: '4px' }}>{t('enterprise.importedTools.connectTitle')}</h4>
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.importedTools.connectDesc')}</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.importedTools.smitheryId')}</label>
                                    <input className="form-input" value={mcpForm.server_id} onChange={e => setMcpForm(f => ({ ...f, server_id: e.target.value }))} placeholder="github / gmail / notion" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.importedTools.directUrl')}</label>
                                    <input className="form-input" value={mcpForm.mcp_url} onChange={e => setMcpForm(f => ({ ...f, mcp_url: e.target.value }))} placeholder="https://example.com/mcp" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.importedTools.displayName')}</label>
                                    <input className="form-input" value={mcpForm.server_name} onChange={e => setMcpForm(f => ({ ...f, server_name: e.target.value }))} placeholder="GitHub MCP" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.importedTools.apiKey')}</label>
                                    <input className="form-input" type="password" value={mcpForm.api_key} onChange={e => setMcpForm(f => ({ ...f, api_key: e.target.value }))} placeholder="Optional server credential" />
                                </div>
                            </div>
                            {mcpError ? <div style={{ color: 'var(--error)', fontSize: '12px', marginBottom: '8px' }}>{mcpError}</div> : null}
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn btn-primary" onClick={handleImportMcp}>{t('enterprise.importedTools.importAction')}</button>
                            </div>
                        </div>

                        <div className="card">
                            <h4 style={{ marginBottom: '12px' }}>{t('enterprise.importedTools.installedTitle')}</h4>
                            {mcpLoading ? (
                                <div style={{ color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                            ) : tenantMcpServers.length === 0 ? (
                                <div style={{ color: 'var(--text-tertiary)' }}>{t('enterprise.importedTools.installedEmpty')}</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {tenantMcpServers.map((server: any) => (
                                        <div key={server.server_key} style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px 14px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{server.server_name}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{server.server_url || server.server_key}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        {t('enterprise.importedTools.installedSummary', { toolCount: server.tool_count, agentCount: server.agent_count })}
                                                    </div>
                                                </div>
                                                <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => handleDeleteMcp(server.server_key)}>
                                                    {t('common.delete')}
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '10px' }}>
                                                {(server.tools || []).map((tool: string) => (
                                                    <span key={tool} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                                                        {tool}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <details className="card">
                            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ transition: 'transform 0.15s', display: 'inline-block', fontSize: '12px' }}>&#x25B6;</span>
                                {t('enterprise.importedTools.systemExtensionsTitle')}
                            </summary>
                            <div style={{ marginTop: '12px' }}>
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                    {t('enterprise.importedTools.systemExtensionsDesc')}
                                </p>
                                {packsLoading ? (
                                    <div style={{ color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                                ) : packCatalog.length === 0 ? (
                                    <div style={{ color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                                        {packCatalog.map((pack: any) => {
                                            const isExpanded = expandedPacks[pack.name] ?? false;
                                            const sourceBadgeColors: Record<string, { bg: string; color: string }> = {
                                                system: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
                                                channel: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
                                                mcp: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
                                                skill: { bg: 'rgba(251,146,60,0.15)', color: '#fb923c' },
                                            };
                                            const badge = sourceBadgeColors[pack.source] || sourceBadgeColors.system;
                                            const sourceLabel = String(t(`enterprise.packs.source${pack.source.charAt(0).toUpperCase() + pack.source.slice(1)}`, pack.source));
                                            return (
                                                <div key={pack.name} className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{pack.summary || pack.name}</span>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <span style={{
                                                                fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '10px',
                                                                background: badge.bg, color: badge.color,
                                                            }}>{sourceLabel}</span>
                                                            <button
                                                                className="btn btn-secondary"
                                                                style={{ fontSize: '11px', padding: '4px 10px' }}
                                                                disabled={packSaving === pack.name}
                                                                onClick={() => handlePackPolicy(pack.name, !pack.enabled)}
                                                            >
                                                                {packSaving === pack.name ? '...' : (pack.enabled ? t('enterprise.importedTools.disable') : t('enterprise.importedTools.enable'))}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                                        <span>{t('enterprise.importedTools.source')}: <strong style={{ color: 'var(--text-secondary)' }}>{sourceLabel}</strong></span>
                                                        <span>{pack.enabled ? t('enterprise.importedTools.enabled') : t('enterprise.importedTools.disabled')}</span>
                                                    </div>
                                                    {pack.capabilities && pack.capabilities.length > 0 ? (
                                                        <div style={{ fontSize: '11px', color: '#c084fc', background: 'rgba(168,85,247,0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                                                            {t('enterprise.importedTools.restricted')}: {pack.capabilities.join(', ')}
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                            {t('enterprise.importedTools.unrestricted')}
                                                        </div>
                                                    )}
                                                    {pack.tools && pack.tools.length > 0 && (
                                                        <div>
                                                            <button
                                                                onClick={() => setExpandedPacks(prev => ({ ...prev, [pack.name]: !isExpanded }))}
                                                                style={{
                                                                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                                                    fontSize: '12px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px',
                                                                }}
                                                            >
                                                                <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>&#9654;</span>
                                                                {t('enterprise.importedTools.actions')} ({pack.tools.length})
                                                            </button>
                                                            {isExpanded && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                                                                    {pack.tools.map((tool: string) => (
                                                                        <span key={tool} style={{
                                                                            fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                                                                            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                                                            border: '1px solid var(--border-subtle)',
                                                                        }}>
                                                                            {tool}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </details>
                    </div>
                )}

                {/* ── Skills Tab ── */}
                {activeTab === 'skills' && <SkillsTab />}

                {activeTab === 'flags' && <FeatureFlagsTab />}

                {/* ── Memory Tab ── */}
                {activeTab === 'memory' && <MemoryTab key={selectedTenantId || 'memory-default'} models={models} tenantId={selectedTenantId || undefined} />}

                {/* ── Invitation Codes Tab ── */}
                {activeTab === 'invites' && <InvitationCodes key={selectedTenantId || 'invites-default'} tenantId={selectedTenantId || undefined} />}

                {/* ── Config Tab (extracted from info) ── */}
                {activeTab === 'config' && (
                    <div>
                        <NotificationBarConfig />
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.config.title')}</h3>
                        <PlatformSettings />
                        <ThemeColorPicker />

                        {/* ── Company Lifecycle ── */}
                        <div style={{ marginTop: '32px', padding: '16px', border: '1px solid var(--status-warning, #d97706)', borderRadius: '8px' }}>
                            <h3 style={{ marginBottom: '4px', color: 'var(--status-warning, #d97706)' }}>{t('enterprise.companyLifecycle.title', 'Company Lifecycle')}</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                {t('enterprise.companyLifecycle.description', 'Disabling a company blocks user access and pauses running digital employees. Re-enable it when the company should become active again.')}
                            </p>
                            {canManageCompanyLifecycle(user?.role) ? (
                                <button
                                    className="btn"
                                    onClick={handleToggleCompanyLifecycle}
                                    disabled={!selectedTenant || companyLifecycleSaving || selectedTenant?.slug === 'default'}
                                    title={selectedTenant?.slug === 'default' ? t('admin.cannotDisableDefault', 'Cannot disable the default company — platform admin would be locked out') : undefined}
                                    style={{
                                        background: 'transparent',
                                        color: selectedTenant?.is_active === false ? 'var(--success, #34c759)' : 'var(--status-warning, #d97706)',
                                        border: `1px solid ${selectedTenant?.is_active === false ? 'var(--success, #34c759)' : 'var(--status-warning, #d97706)'}`,
                                        borderRadius: '6px',
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {companyLifecycleSaving
                                        ? t('common.loading')
                                        : selectedTenant?.is_active === false
                                            ? t('admin.enable', 'Enable')
                                            : t('admin.disable', 'Disable')}
                                </button>
                            ) : (
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                    {t('enterprise.companyLifecycle.platformOnly', 'Company lifecycle actions are managed by platform admins.')}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Knowledge Base Tab (extracted from info) ── */}
                {activeTab === 'kb' && (
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <h3 style={{ margin: 0 }}>{t('enterprise.kb.title')}</h3>
                            {vikingStatus?.connected ? (
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(16,185,129,0.15)', color: 'rgb(16,185,129)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(16,185,129)' }} />
                                    OpenViking {vikingStatus.version || ''}
                                </span>
                            ) : vikingStatus ? (
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                                    {t('enterprise.kb.vikingOffline', 'Knowledge engine offline')}
                                </span>
                            ) : null}
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                            {t('enterprise.kb.description', 'Shared files accessible to all agents via enterprise_info/ directory.')}
                        </p>
                        <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
                            <EnterpriseKBBrowser onRefresh={() => setInfoRefresh((v: number) => v + 1)} />
                        </div>
                    </div>
                )}

                </div>{/* end content area */}
                </div>{/* end sidebar + content flex */}
            </div>

            {
                kbToast && (
                    <div style={{
                        position: 'fixed', top: '20px', right: '20px', zIndex: 20000,
                        padding: '12px 20px', borderRadius: '8px',
                        background: kbToast.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
                        color: '#fff', fontSize: '14px', fontWeight: 500,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}>
                        {''}{kbToast.message}
                    </div>
                )
            }
        </>
    );
}
