import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { configHistoryApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/cn';

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
        <details className="card mb-3">
            <summary className="cursor-pointer font-semibold text-sm list-none flex items-center gap-2">
                <span aria-hidden="true">&#9656;</span> {t('agentDetail.configHistory', 'Config History')}
                <span className="text-[11px] text-content-tertiary font-normal">({configHistory.length})</span>
            </summary>
            <p className="text-xs text-content-tertiary mt-2 mb-3">
                {t('agentDetail.configHistoryDesc', 'Previous configuration snapshots')}
            </p>
            <div className="flex flex-col gap-1.5">
                {configHistory.map((rev: any) => (
                    <div key={rev.version} role="button" tabIndex={0} aria-expanded={expandedVersion === rev.version} className={cn(
                        'px-3 py-2.5 rounded-md border border-edge-subtle cursor-pointer',
                        expandedVersion === rev.version ? 'bg-surface-secondary' : 'bg-surface-elevated',
                    )} onClick={() => setExpandedVersion(expandedVersion === rev.version ? null : rev.version)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedVersion(expandedVersion === rev.version ? null : rev.version); } }}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-[13px]">v{rev.version}</span>
                                {rev.change_summary && <span className="text-xs text-content-secondary">{rev.change_summary}</span>}
                            </div>
                            <span className="text-[11px] text-content-tertiary">
                                {rev.created_at ? new Date(rev.created_at).toLocaleString() : ''}
                            </span>
                        </div>
                        {expandedVersion === rev.version && (
                            <>
                                <pre className="mt-2 p-2 bg-surface-primary rounded text-[11px] overflow-auto max-h-[200px] border border-edge-subtle">{JSON.stringify(expandedRevision?.snapshot ?? rev.snapshot ?? {}, null, 2)}</pre>
                                {canRollback && (
                                    <div className="mt-2 flex justify-end">
                                        <button
                                            className="btn text-xs"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!confirm(t('agentDetail.rollbackConfirm', { version: rev.version }))) return;
                                                rollbackMutation.mutate(rev.version);
                                            }}
                                            disabled={rollbackMutation.isPending}
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
