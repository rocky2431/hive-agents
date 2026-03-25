import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchJson } from './shared';

export function ApprovalsTab({ selectedTenantId }: { selectedTenantId?: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();

    const { data: approvals = [] } = useQuery({
        queryKey: ['approvals', selectedTenantId],
        queryFn: () => fetchJson<any[]>(`/enterprise/approvals${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
    });

    const resolveApproval = useMutation({
        mutationFn: ({ id, action }: { id: string; action: string }) =>
            fetchJson(`/enterprise/approvals/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', selectedTenantId] }),
    });

    return (
        <div className="flex flex-col gap-2">
            {approvals.map((a: any) => (
                <div key={a.id} className="card flex items-center justify-between">
                    <div>
                        <div className="font-medium">{a.action_type}</div>
                        <div className="text-xs text-content-tertiary">
                            {a.agent_name || `Agent ${a.agent_id.slice(0, 8)}`} &middot; {new Date(a.created_at).toLocaleString()}
                        </div>
                    </div>
                    {a.status === 'pending' ? (
                        <div className="flex gap-2">
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
            {approvals.length === 0 && <div className="text-center py-10 text-content-tertiary">{t('common.noData')}</div>}
        </div>
    );
}
