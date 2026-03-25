import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi, enterpriseApi } from '@/services/api';
import { normalizeMemoryFacts } from '@/lib/memoryInsights.ts';

export interface MemoryInsightsPanelProps {
    agentId: string;
}

export function MemoryInsightsPanel({ agentId }: MemoryInsightsPanelProps) {
    const { t } = useTranslation();
    const { data: memoryResponse, isLoading: memoryLoading } = useQuery({
        queryKey: ['agent-memory-facts', agentId],
        queryFn: () => enterpriseApi.agentMemory(agentId),
        enabled: !!agentId,
    });
    const { data: ownSessions = [], isLoading: sessionsLoading } = useQuery({
        queryKey: ['agent-owned-sessions', agentId],
        queryFn: () => agentApi.sessions(agentId, 'mine'),
        enabled: !!agentId,
    });
    const latestSessionId = ownSessions[0]?.id as string | undefined;
    const { data: latestSessionSummary, isLoading: summaryLoading } = useQuery({
        queryKey: ['agent-session-summary', latestSessionId],
        queryFn: () => enterpriseApi.sessionSummary(latestSessionId!),
        enabled: !!latestSessionId,
    });

    const facts = normalizeMemoryFacts(memoryResponse?.facts);
    const sessionSummary = typeof latestSessionSummary?.summary === 'string' ? latestSessionSummary.summary.trim() : '';
    const sessionTitle = typeof latestSessionSummary?.title === 'string' && latestSessionSummary.title.trim()
        ? latestSessionSummary.title.trim()
        : t('agentDetail.sessionSummaryTitleFallback', 'Untitled session');

    return (
        <div className="card p-4 mb-6">
            <div className="mb-3">
                <div className="font-semibold text-sm mb-1">
                    {t('agentDetail.structuredMemory', 'Structured Memory')}
                </div>
                <div className="text-xs text-content-tertiary">
                    {t('agentDetail.structuredMemoryDesc', 'Knowledge extracted into reusable facts and the latest personal session summary.')}
                </div>
            </div>

            <div className="grid grid-cols-[minmax(300px,1.2fr)_minmax(280px,0.8fr)] gap-4">
                <div className="card p-3 !m-0 bg-surface-secondary">
                    <div className="flex justify-between gap-3 items-center mb-2">
                        <div className="text-xs font-semibold">
                            {t('agentDetail.structuredMemory', 'Structured Memory')}
                        </div>
                        <span className="text-[11px] text-content-tertiary">{facts.length}</span>
                    </div>
                    {memoryLoading ? (
                        <div className="text-xs text-content-tertiary">{t('common.loading')}</div>
                    ) : facts.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {facts.map((fact) => (
                                <div
                                    key={fact.id}
                                    className="px-3 py-2.5 rounded-lg border border-edge-subtle bg-surface-primary"
                                >
                                    <div className="flex justify-between gap-2 items-center mb-1.5">
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/[0.12] text-blue-400 border border-blue-500/20">
                                            {fact.label}
                                        </span>
                                        {fact.timestamp && (
                                            <span className="text-[11px] text-content-tertiary">
                                                {new Date(fact.timestamp).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[13px] text-content-primary leading-normal">
                                        {fact.content}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-content-tertiary">
                            {t('agentDetail.noStructuredMemory', 'No structured memory facts yet.')}
                        </div>
                    )}
                </div>

                <div className="card p-3 !m-0 bg-surface-secondary">
                    <div className="text-xs font-semibold mb-2">
                        {t('agentDetail.sessionSummary', 'Latest Session Summary')}
                    </div>
                    <div className="text-[11px] text-content-tertiary mb-2.5">
                        {t('agentDetail.sessionSummaryDesc', 'Only your own latest session summary is visible here.')}
                    </div>
                    {sessionsLoading || (latestSessionId && summaryLoading) ? (
                        <div className="text-xs text-content-tertiary">{t('common.loading')}</div>
                    ) : !latestSessionId ? (
                        <div className="text-xs text-content-tertiary">
                            {t('agentDetail.noSessionHistory', 'No personal sessions yet.')}
                        </div>
                    ) : sessionSummary ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-[13px] font-semibold">{sessionTitle}</div>
                            <div className="text-[13px] text-content-secondary leading-relaxed whitespace-pre-wrap">
                                {sessionSummary}
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-content-tertiary">
                            {t('agentDetail.noSessionSummary', 'This session does not have a summary yet.')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
