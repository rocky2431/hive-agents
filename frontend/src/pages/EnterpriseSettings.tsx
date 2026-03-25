import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
import { enterpriseApi } from '../services/api';
import UserManagement from './UserManagement';
import InvitationCodes from './InvitationCodes';
import {
    OrgTab,
    SkillsTab,
    FeatureFlagsTab,
    MemoryTab,
    LlmTab,
    McpTab,
    AuditTab,
    CapabilitiesTab,
    SsoTab,
    InfoTab,
    QuotasTab,
    ApprovalsTab,
    ConfigTab,
    KbTab,
    fetchJson,
    type LLMModel,
} from './enterprise';

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

export default function EnterpriseSettings() {
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useQueryState(
        'tab',
        parseAsStringLiteral(TAB_KEYS).withDefault('info'),
    );

    // Track selected tenant as state so page refreshes on company switch
    const [selectedTenantId, setSelectedTenantId] = useState(localStorage.getItem('current_tenant_id') || '');
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === 'current_tenant_id') {
                setSelectedTenantId(e.newValue || '');
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // Stats (scoped to selected tenant) — used only in sidebar header
    const { data: stats } = useQuery({
        queryKey: ['enterprise-stats', selectedTenantId],
        queryFn: () => fetchJson<any>(`/enterprise/stats${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
    });

    // OpenViking status for KB tab
    const { data: vikingStatus } = useQuery({
        queryKey: ['openviking-status'],
        queryFn: enterpriseApi.openvikingStatus,
        refetchInterval: 60000,
        retry: false,
    });

    // LLM models — needed by both llm tab (self-managed) and memory tab (passed as prop)
    const { data: models = [] } = useQuery({
        queryKey: ['llm-models', selectedTenantId],
        queryFn: () => fetchJson<LLMModel[]>(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
        enabled: activeTab === 'llm' || activeTab === 'memory',
    });

    const tenantIdProp = selectedTenantId || undefined;

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t('nav.enterprise')}</h1>
                    {stats && (
                        <div className="flex gap-6 mt-2">
                            <span className="badge badge-info">{t('enterprise.stats.users', { count: stats.total_users })}</span>
                            <span className="badge badge-success">{t('enterprise.stats.runningAgents', { running: stats.running_agents, total: stats.total_agents })}</span>
                            {stats.pending_approvals > 0 && <span className="badge badge-warning">{stats.pending_approvals} {t('enterprise.tabs.approvals')}</span>}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex mt-1">
                {/* Sidebar Navigation */}
                <nav className="w-[200px] min-w-[200px] border-r border-edge-subtle py-4 sticky top-0 self-start">
                    {SIDEBAR_GROUPS.map(group => (
                        <div key={group.key} className="mb-2">
                            <div className="px-4 py-2 text-[11px] font-semibold uppercase text-content-tertiary tracking-wide">
                                {t(`enterprise.groups.${group.key}`, group.key)}
                            </div>
                            {group.tabs.map(tab => (
                                <div
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-1.5 pl-7 pr-4 text-[13px] cursor-pointer rounded-md mx-2 transition-colors ${
                                        activeTab === tab
                                            ? 'bg-[var(--accent-subtle,rgba(99,102,241,0.08))] text-[var(--accent-primary,#6366f1)] font-medium'
                                            : 'text-content-secondary hover:bg-[var(--bg-hover,rgba(255,255,255,0.04))]'
                                    }`}
                                >
                                    {t(`enterprise.tabs.${tab}`, tab)}
                                </div>
                            ))}
                        </div>
                    ))}
                </nav>

                {/* Content Area */}
                <div className="flex-1 min-w-0 pl-6">
                    {activeTab === 'info' && <InfoTab selectedTenantId={tenantIdProp} onNavigateTab={setActiveTab} />}
                    {activeTab === 'llm' && <LlmTab selectedTenantId={tenantIdProp} />}
                    {activeTab === 'org' && <OrgTab tenantId={tenantIdProp} />}
                    {activeTab === 'approvals' && <ApprovalsTab selectedTenantId={tenantIdProp} />}
                    {activeTab === 'audit' && <AuditTab />}
                    {activeTab === 'mcp' && <McpTab />}
                    {activeTab === 'skills' && <SkillsTab />}
                    {activeTab === 'quotas' && <QuotasTab selectedTenantId={tenantIdProp} />}
                    {activeTab === 'users' && <UserManagement key={selectedTenantId} />}
                    {activeTab === 'flags' && <FeatureFlagsTab />}
                    {activeTab === 'invites' && <InvitationCodes key={selectedTenantId || 'invites-default'} tenantId={tenantIdProp} />}
                    {activeTab === 'memory' && <MemoryTab key={selectedTenantId || 'memory-default'} models={models} tenantId={tenantIdProp} />}
                    {activeTab === 'sso' && <SsoTab selectedTenantId={tenantIdProp} />}
                    {activeTab === 'capabilities' && <CapabilitiesTab />}
                    {activeTab === 'config' && <ConfigTab selectedTenantId={tenantIdProp} />}
                    {activeTab === 'kb' && <KbTab vikingStatus={vikingStatus} />}
                </div>
            </div>
        </div>
    );
}
