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
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    {t('agentDetail.structuredMemory', 'Structured Memory')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {t('agentDetail.structuredMemoryDesc', 'Knowledge extracted into reusable facts and the latest personal session summary.')}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(280px, 0.8fr)', gap: '16px' }}>
                <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>
                            {t('agentDetail.structuredMemory', 'Structured Memory')}
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{facts.length}</span>
                    </div>
                    {memoryLoading ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : facts.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {facts.map((fact) => (
                                <div
                                    key={fact.id}
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        background: 'var(--bg-primary)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                        <span
                                            style={{
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                borderRadius: '999px',
                                                background: 'rgba(59,130,246,0.12)',
                                                color: '#60a5fa',
                                                border: '1px solid rgba(59,130,246,0.20)',
                                            }}
                                        >
                                            {fact.label}
                                        </span>
                                        {fact.timestamp && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                {new Date(fact.timestamp).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                        {fact.content}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noStructuredMemory', 'No structured memory facts yet.')}
                        </div>
                    )}
                </div>

                <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                        {t('agentDetail.sessionSummary', 'Latest Session Summary')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                        {t('agentDetail.sessionSummaryDesc', 'Only your own latest session summary is visible here.')}
                    </div>
                    {sessionsLoading || (latestSessionId && summaryLoading) ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : !latestSessionId ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noSessionHistory', 'No personal sessions yet.')}
                        </div>
                    ) : sessionSummary ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{sessionTitle}</div>
                            <div
                                style={{
                                    fontSize: '13px',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.6,
                                    whiteSpace: 'pre-wrap',
                                }}
                            >
                                {sessionSummary}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noSessionSummary', 'This session does not have a summary yet.')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
