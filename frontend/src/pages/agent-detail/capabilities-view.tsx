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
        return <div className="text-content-tertiary p-5">{t('common.loading')}</div>;
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
        <div className="flex flex-col gap-6">
            <div className="card p-4">
                <div className="flex justify-between gap-3 flex-wrap">
                    <div>
                        <div className="text-sm font-semibold mb-1">{t('agent.capability.foundationTitle')}</div>
                        <div className="text-xs text-content-tertiary">{t('agent.capability.foundationDesc')}</div>
                    </div>
                    <div className="text-xs text-content-secondary self-center">
                        {t('agent.capability.foundationCount', { count: kernel_tools.length })}
                    </div>
                </div>
            </div>

            <div>
                <h3 className="mb-1 text-sm">{t('agent.capability.sections.skills')}</h3>
                <p className="text-xs text-content-tertiary mb-2.5">
                    {t('agent.capability.skillsHint')}
                </p>
                {skill_declared_packs && skill_declared_packs.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
                        {skill_declared_packs.map((pack: any) => (
                            <div key={pack.name} className="card p-3.5">
                                <div className="flex justify-between gap-2 items-start mb-2">
                                    <div className="font-semibold text-[13px]">{(pack.skills || []).join(' · ') || capabilityNameMap[pack.name] || pack.name}</div>
                                    <span className="text-[10px] text-content-tertiary">{t('agent.capability.skillSource')}</span>
                                </div>
                                {pack.summary ? (
                                    <div className="text-xs text-content-secondary mb-2">{pack.summary}</div>
                                ) : null}
                                <div className="text-[11px] text-content-tertiary mb-2">
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {(pack.tools || []).map((tool: string) => (
                                        <span
                                            key={tool}
                                            className="text-[11px] px-2 py-0.5 rounded bg-surface-secondary border border-edge-subtle"
                                        >
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card text-center p-5 text-content-tertiary text-[13px]">
                        {t('agent.capability.skillsEmpty')}
                    </div>
                )}
            </div>

            <div>
                <h3 className="mb-1 text-sm">{t('agent.capability.sections.tools')}</h3>
                <p className="text-xs text-content-tertiary mb-2.5">
                    {allPacks.length > 0
                        ? t('agent.capability.connectedSummary', { count: allPacks.length })
                        : t('agent.capability.connectedEmpty')}
                </p>
                {allPacks.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
                        {allPacks.map((pack: any) => (
                            <div key={pack.name} className="card p-3.5">
                                <div className="flex justify-between gap-2 items-start mb-2">
                                    <div className="font-semibold text-[13px]">{capabilityNameMap[pack.name] || pack.summary || pack.name}</div>
                                    <span className="text-[10px] text-content-tertiary">{sourceLabel(pack.source)}</span>
                                </div>
                                {pack.summary ? (
                                    <div className="text-xs text-content-secondary mb-2">{pack.summary}</div>
                                ) : null}
                                <div className="text-[11px] text-content-tertiary mb-2">
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                {pack.capabilities && pack.capabilities.length > 0 ? (
                                    <div className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-md px-2 py-1.5">
                                        {t('enterprise.importedTools.restricted')}: {pack.capabilities.join(', ')}
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-content-tertiary">{t('enterprise.importedTools.unrestricted')}</div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card text-center p-5 text-content-tertiary text-[13px]">
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
                    className="cursor-pointer font-semibold text-sm list-none flex items-center gap-2 select-none"
                >
                    <span className="inline-block text-xs transition-transform duration-150" style={{ transform: sessionExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#x25B6;</span>
                    {t('agent.capability.sections.advanced')}
                </summary>
                {!latestSessionId ? (
                    <p className="text-xs text-content-tertiary mt-2 mb-0">
                        {t('agent.capability.advancedNone')}
                    </p>
                ) : runtimeLoading || !runtimeSummary ? (
                    <p className="text-xs text-content-tertiary mt-2 mb-0">
                        {t('common.loading')}
                    </p>
                ) : (
                    <div className="flex flex-col gap-3 mt-2.5">
                        <p className="text-xs text-content-tertiary m-0">
                            {t('agent.capability.advancedDesc')}
                        </p>
                        <div>
                            <div className="text-xs font-semibold mb-1.5">{t('enterprise.packs.activatedPacks')}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {runtimeSummary.activated_packs.length > 0 ? runtimeSummary.activated_packs.map((pack: string) => (
                                    <span
                                        key={pack}
                                        className="text-[11px] px-2.5 py-0.5 rounded-full bg-blue-500/[0.12] text-blue-400 border border-blue-500/25"
                                    >
                                        {pack}
                                    </span>
                                )) : (
                                    <span className="text-xs text-content-tertiary">{t('enterprise.packs.noActivatedPacks')}</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="text-xs font-semibold mb-1.5">{t('agent.capability.recentTools')}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {runtimeSummary.used_tools.length > 0 ? runtimeSummary.used_tools.map((tool: string) => (
                                    <span
                                        key={tool}
                                        className="text-[11px] px-2.5 py-0.5 rounded bg-surface-secondary text-content-secondary border border-edge-subtle font-mono"
                                    >
                                        {tool}
                                    </span>
                                )) : (
                                    <span className="text-xs text-content-tertiary">{t('enterprise.packs.noUsedTools')}</span>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-4 flex-wrap">
                            <div className="min-w-[180px]">
                                <div className="text-xs font-semibold mb-1.5">{t('agent.capability.recentBlocks')}</div>
                                {runtimeSummary.blocked_capabilities.length > 0 ? (
                                    <div className="flex flex-col gap-1.5">
                                        {runtimeSummary.blocked_capabilities.map((item: any, index: number) => (
                                            <div
                                                key={`${item.tool || 'unknown'}-${index}`}
                                                className="px-2.5 py-2 rounded-lg bg-amber-400/10 border border-amber-400/20 text-[11px] text-content-secondary"
                                            >
                                                <div className="font-semibold">{item.capability || item.tool || 'blocked'}</div>
                                                <div className="text-content-tertiary mt-0.5">
                                                    {item.tool ? `${item.tool} · ` : ''}{item.status}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-xs text-content-tertiary">{t('enterprise.packs.noBlockedCapabilities')}</span>
                                )}
                            </div>

                            <div className="min-w-[180px]">
                                <div className="text-xs font-semibold mb-1.5">{t('agent.capability.recentCompactions')}</div>
                                <div className="px-3 py-2.5 rounded-lg bg-surface-secondary border border-edge-subtle text-xl font-bold">
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
