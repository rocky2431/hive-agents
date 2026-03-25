import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi, packApi } from '@/services/api';

export interface CapabilitiesViewProps {
    agentId: string;
    canManage: boolean;
}

export function CapabilitiesView({ agentId, canManage }: CapabilitiesViewProps) {
    const { t } = useTranslation();
    const [sessionExpanded, setSessionExpanded] = useState(false);
    const sessionScope = canManage ? 'all' : 'mine';

    const { data: capSummary, isLoading } = useQuery({
        queryKey: ['capability-summary', agentId],
        queryFn: () => packApi.capabilitySummary(agentId),
        enabled: !!agentId,
    });
    const { data: sessions = [] } = useQuery({
        queryKey: ['capability-sessions', agentId, sessionScope],
        queryFn: () => agentApi.sessions(agentId, sessionScope),
        enabled: !!agentId,
    });
    const latestSessionId = sessions[0]?.id as string | undefined;
    const { data: runtimeSummary, isLoading: runtimeLoading } = useQuery({
        queryKey: ['capability-runtime-summary', latestSessionId],
        queryFn: () => packApi.sessionRuntime(latestSessionId!),
        enabled: sessionExpanded && !!latestSessionId,
    });

    if (isLoading || !capSummary) {
        return <div style={{ color: 'var(--text-tertiary)', padding: '20px' }}>{t('common.loading')}</div>;
    }

    const { kernel_tools, available_packs, channel_backed_packs, skill_declared_packs } = capSummary;
    const allPacks = [...available_packs, ...channel_backed_packs];
    const capabilityNameMap: Record<string, string> = {
        web_pack: t('agent.capability.research'),
        feishu_pack: t('agent.capability.feishu'),
        plaza_pack: t('agent.capability.collaboration'),
        mcp_admin_pack: t('agent.capability.mcpAdmin'),
    };
    const sourceLabel = (source?: string) => {
        switch (source) {
            case 'channel':
                return t('agent.capability.channelSource');
            case 'mcp':
                return t('agent.capability.mcpSource');
            case 'skill':
                return t('agent.capability.skillSource');
            default:
                return t('agent.capability.systemSource');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{t('agent.capability.foundationTitle')}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agent.capability.foundationDesc')}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                        {t('agent.capability.foundationCount', { count: kernel_tools.length })}
                    </div>
                </div>
            </div>

            <div>
                <h3 style={{ marginBottom: '4px', fontSize: '14px' }}>{t('agent.capability.sections.skills')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                    {t('agent.capability.skillsHint')}
                </p>
                {skill_declared_packs && skill_declared_packs.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                        {skill_declared_packs.map((pack: any) => (
                            <div key={pack.name} className="card" style={{ padding: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{(pack.skills || []).join(' · ') || capabilityNameMap[pack.name] || pack.name}</div>
                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{t('agent.capability.skillSource')}</span>
                                </div>
                                {pack.summary ? (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{pack.summary}</div>
                                ) : null}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {(pack.tools || []).map((tool: string) => (
                                        <span
                                            key={tool}
                                            style={{
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-subtle)',
                                            }}
                                        >
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                        {t('agent.capability.skillsEmpty')}
                    </div>
                )}
            </div>

            <div>
                <h3 style={{ marginBottom: '4px', fontSize: '14px' }}>{t('agent.capability.sections.tools')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                    {allPacks.length > 0
                        ? t('agent.capability.connectedSummary', { count: allPacks.length })
                        : t('agent.capability.connectedEmpty')}
                </p>
                {allPacks.length > 0 ? (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                            gap: '10px',
                        }}
                    >
                        {allPacks.map((pack: any) => (
                            <div key={pack.name} className="card" style={{ padding: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{capabilityNameMap[pack.name] || pack.summary || pack.name}</div>
                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{sourceLabel(pack.source)}</span>
                                </div>
                                {pack.summary ? (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{pack.summary}</div>
                                ) : null}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                {pack.capabilities && pack.capabilities.length > 0 ? (
                                    <div style={{ fontSize: '11px', color: '#f59e0b', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)', borderRadius: '6px', padding: '6px 8px' }}>
                                        {t('enterprise.importedTools.restricted')}: {pack.capabilities.join(', ')}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.importedTools.unrestricted')}</div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                        {t('agent.capability.connectedEmpty')}
                    </div>
                )}
            </div>

            <details
                className="card"
                open={sessionExpanded}
                onToggle={(e) => setSessionExpanded((e.target as HTMLDetailsElement).open)}
            >
                <summary
                    style={{
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '14px',
                        listStyle: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        userSelect: 'none',
                    }}
                >
                    <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: sessionExpanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '12px' }}>&#x25B6;</span>
                    {t('agent.capability.sections.advanced')}
                </summary>
                {!latestSessionId ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
                        {t('agent.capability.advancedNone')}
                    </p>
                ) : runtimeLoading || !runtimeSummary ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
                        {t('common.loading')}
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
                            {t('agent.capability.advancedDesc')}
                        </p>
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('enterprise.packs.activatedPacks')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {runtimeSummary.activated_packs.length > 0 ? runtimeSummary.activated_packs.map((pack: string) => (
                                    <span
                                        key={pack}
                                        style={{
                                            fontSize: '11px',
                                            padding: '3px 10px',
                                            borderRadius: '999px',
                                            background: 'rgba(59,130,246,0.12)',
                                            color: '#60a5fa',
                                            border: '1px solid rgba(59,130,246,0.25)',
                                        }}
                                    >
                                        {pack}
                                    </span>
                                )) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noActivatedPacks')}</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentTools')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {runtimeSummary.used_tools.length > 0 ? runtimeSummary.used_tools.map((tool: string) => (
                                    <span
                                        key={tool}
                                        style={{
                                            fontSize: '11px',
                                            padding: '3px 10px',
                                            borderRadius: '4px',
                                            background: 'var(--bg-secondary)',
                                            color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-subtle)',
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    >
                                        {tool}
                                    </span>
                                )) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noUsedTools')}</span>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: '180px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentBlocks')}</div>
                                {runtimeSummary.blocked_capabilities.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {runtimeSummary.blocked_capabilities.map((item: any, index: number) => (
                                            <div
                                                key={`${item.tool || 'unknown'}-${index}`}
                                                style={{
                                                    padding: '8px 10px',
                                                    borderRadius: '8px',
                                                    background: 'rgba(245,158,11,0.10)',
                                                    border: '1px solid rgba(245,158,11,0.20)',
                                                    fontSize: '11px',
                                                    color: 'var(--text-secondary)',
                                                }}
                                            >
                                                <div style={{ fontWeight: 600 }}>{item.capability || item.tool || 'blocked'}</div>
                                                <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                    {item.tool ? `${item.tool} · ` : ''}{item.status}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noBlockedCapabilities')}</span>
                                )}
                            </div>

                            <div style={{ minWidth: '180px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentCompactions')}</div>
                                <div
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-subtle)',
                                        fontSize: '20px',
                                        fontWeight: 700,
                                    }}
                                >
                                    {runtimeSummary.compaction_count}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </details>
        </div>
    );
}
