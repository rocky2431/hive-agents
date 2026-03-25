import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { configHistoryApi } from '@/services/api';
import { useAuthStore } from '@/stores';

export interface ConfigVersionHistoryProps {
    agentId: string;
}

export function ConfigVersionHistory({ agentId }: ConfigVersionHistoryProps) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const canRollback = user?.role === 'platform_admin' || user?.role === 'org_admin';
    const { data: configHistory = [] } = useQuery({
        queryKey: ['config-history', agentId],
        queryFn: () => configHistoryApi.list(agentId).catch(() => []),
        enabled: !!agentId,
    });
    const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
    const { data: expandedRevision } = useQuery({
        queryKey: ['config-history', agentId, expandedVersion],
        queryFn: () => configHistoryApi.getVersion(agentId, String(expandedVersion)).catch(() => null),
        enabled: !!agentId && expandedVersion !== null,
    });
    const rollbackMutation = useMutation({
        mutationFn: (targetVersion: number) =>
            configHistoryApi.rollback(agentId, { target_version: targetVersion }),
        onSuccess: async () => {
            setExpandedVersion(null);
            await qc.invalidateQueries({ queryKey: ['config-history', agentId] });
            await qc.invalidateQueries({ queryKey: ['agent', agentId] });
            alert(t('agentDetail.rolledBack', 'Rolled back successfully'));
        },
        onError: (error: any) => {
            alert(error?.message || 'Rollback failed');
        },
    });
    if (!configHistory.length) return null;
    return (
        <details className="card" style={{ marginBottom: '12px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>▸</span> {t('agentDetail.configHistory', 'Config History')}
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({configHistory.length})</span>
            </summary>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 12px' }}>
                {t('agentDetail.configHistoryDesc', 'Previous configuration snapshots')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {configHistory.map((rev: any) => (
                    <div key={rev.version} style={{
                        padding: '10px 12px', borderRadius: '6px',
                        background: expandedVersion === rev.version ? 'var(--bg-secondary)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)', cursor: 'pointer',
                    }} onClick={() => setExpandedVersion(expandedVersion === rev.version ? null : rev.version)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px' }}>v{rev.version}</span>
                                {rev.change_summary && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{rev.change_summary}</span>}
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                {rev.created_at ? new Date(rev.created_at).toLocaleString() : ''}
                            </span>
                        </div>
                        {expandedVersion === rev.version && (
                            <>
                                <pre style={{
                                    marginTop: '8px', padding: '8px', background: 'var(--bg-primary)',
                                    borderRadius: '4px', fontSize: '11px', overflow: 'auto',
                                    maxHeight: '200px', border: '1px solid var(--border-subtle)',
                                }}>{JSON.stringify(expandedRevision?.snapshot ?? rev.snapshot ?? {}, null, 2)}</pre>
                                {canRollback && (
                                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            className="btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!confirm(t('agentDetail.rollbackConfirm', { version: rev.version }))) return;
                                                rollbackMutation.mutate(rev.version);
                                            }}
                                            disabled={rollbackMutation.isPending}
                                            style={{ fontSize: '12px' }}
                                        >
                                            {rollbackMutation.isPending
                                                ? t('common.loading')
                                                : t('agentDetail.rollback', 'Rollback')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>
        </details>
    );
}
