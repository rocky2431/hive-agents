import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { activityApi, agentApi } from '@/services/api';
import { AgentOperationsPanel } from '@/pages/agent-detail';

interface ActivityTabProps {
    agentId: string;
    agent: any;
    canManage: boolean;
}

export function ActivityTab({ agentId, agent }: ActivityTabProps) {
    const { t } = useTranslation();

    // Activity log state
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [logFilter, setLogFilter] = useState<string>('user');

    const { data: activityLogs = [] } = useQuery({
        queryKey: ['activity', agentId],
        queryFn: () => activityApi.list(agentId, 100),
        enabled: !!agentId,
        refetchInterval: 10000,
    });

    // Category definitions
    const userActionTypes = ['chat_reply', 'tool_call', 'task_created', 'task_updated', 'file_written', 'error'];
    const heartbeatTypes = ['heartbeat', 'plaza_post'];
    const scheduleTypes = ['schedule_run'];
    const messageTypes = ['feishu_msg_sent', 'agent_msg_sent', 'web_msg_sent'];

    let filteredLogs = activityLogs;
    if (logFilter === 'user') {
        filteredLogs = activityLogs.filter((l: any) => userActionTypes.includes(l.action_type));
    } else if (logFilter === 'backend') {
        filteredLogs = activityLogs.filter((l: any) => !userActionTypes.includes(l.action_type));
    } else if (logFilter === 'heartbeat') {
        filteredLogs = activityLogs.filter((l: any) => heartbeatTypes.includes(l.action_type));
    } else if (logFilter === 'schedule') {
        filteredLogs = activityLogs.filter((l: any) => scheduleTypes.includes(l.action_type));
    } else if (logFilter === 'messages') {
        filteredLogs = activityLogs.filter((l: any) => messageTypes.includes(l.action_type));
    }

    const filterBtn = (key: string, label: string, indent = false) => (
        <button
            key={key}
            onClick={() => setLogFilter(key)}
            className={`rounded-md cursor-pointer transition-all duration-150 whitespace-nowrap border ${
                indent ? 'py-1 pl-5 pr-2.5 text-[11px]' : 'px-3.5 py-1.5 text-xs'
            } ${
                logFilter === key
                    ? 'font-semibold text-accent-primary bg-[rgba(99,102,241,0.1)] border-accent-primary'
                    : 'font-normal text-content-secondary bg-transparent border-edge-subtle'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div>
            {/* Section 1: Pending approvals */}
            {agent.access_level !== 'use' && <ApprovalsSection agentId={agentId} />}

            <AgentOperationsPanel agentId={agentId} agent={agent} />

            {/* Section 2: Activity stream */}
            <h3 className="mb-3">{t('agent.activityLog.title')}</h3>

            {/* Filter tabs */}
            <div className="flex gap-1.5 mb-4 flex-wrap items-center">
                {filterBtn('user', '\uD83D\uDC64 ' + t('agent.activityLog.userActions', 'User Actions'))}
                {agent.agent_type !== 'openclaw' && (<>
                {filterBtn('backend', '\u2699\uFE0F ' + t('agent.activityLog.backendServices', 'Backend Services'))}
                {(logFilter === 'backend' || logFilter === 'heartbeat' || logFilter === 'schedule' || logFilter === 'messages') && (
                    <>
                        <span className="text-content-tertiary text-[11px]">{'\u2502'}</span>
                        {filterBtn('heartbeat', '\uD83D\uDC93 Heartbeat', true)}
                        {filterBtn('schedule', '\u23F0 Schedule/Cron', true)}
                        {filterBtn('messages', '\uD83D\uDCE8 Messages', true)}
                    </>
                )}
                </>)}
            </div>

            {filteredLogs.length > 0 ? (
                <div className="flex flex-col gap-1">
                    {filteredLogs.map((log: any) => {
                        const icons: Record<string, string> = {
                            chat_reply: '\uD83D\uDCAC', tool_call: '\u26A1', feishu_msg_sent: '\uD83D\uDCE4',
                            agent_msg_sent: '\uD83E\uDD16', web_msg_sent: '\uD83C\uDF10', task_created: '\uD83D\uDCCB',
                            task_updated: '\u2705', file_written: '\uD83D\uDCDD', error: '\u274C',
                            schedule_run: '\u23F0', heartbeat: '\uD83D\uDC93', plaza_post: '\uD83C\uDFDB\uFE0F',
                        };
                        const time = log.created_at ? new Date(log.created_at).toLocaleString('zh-CN', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                        }) : '';
                        const isExpanded = expandedLogId === log.id;
                        return (
                            <div key={log.id}
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className={`p-[10px_14px] rounded-lg cursor-pointer text-[13px] transition-all duration-150 ${
                                    isExpanded
                                        ? 'bg-[var(--bg-elevated)] border border-accent-primary'
                                        : 'bg-surface-secondary border border-transparent'
                                }`}
                            >
                                <div className="flex items-start gap-2.5">
                                    <span className="text-base shrink-0 mt-px">
                                        {icons[log.action_type] || '\u00B7'}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium mb-0.5">{log.summary}</div>
                                        <div className="text-[11px] text-content-tertiary">
                                            {time} {'\u00B7'} {log.action_type}
                                            {log.detail && !isExpanded && <span className="ml-2 text-accent-primary">{'\u25B8'} Details</span>}
                                        </div>
                                    </div>
                                </div>
                                {isExpanded && log.detail && (
                                    <div className="mt-2 p-2.5 rounded-md bg-surface-primary text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-content-secondary max-h-[300px] overflow-y-auto">
                                        {Object.entries(log.detail).map(([k, v]: [string, any]) => (
                                            <div key={k} className="mb-1.5">
                                                <span className="text-accent-primary font-semibold">{k}:</span>{' '}
                                                <span>{typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="card text-center p-10 text-content-tertiary">
                    {t('agent.activityLog.noRecords')}
                </div>
            )}
        </div>
    );
}

/* ── Inline component: ApprovalsSection ── */

function ApprovalsSection({ agentId }: { agentId: string }) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    const { data: approvals = [], refetch: refetchApprovals } = useQuery({
        queryKey: ['agent-approvals', agentId],
        queryFn: () => agentApi.listApprovals(agentId),
        enabled: !!agentId,
        refetchInterval: 15000,
    });
    const resolveMut = useMutation({
        mutationFn: ({ approvalId, action }: { approvalId: string; action: string }) =>
            agentApi.resolveApproval(agentId, approvalId, { action }),
        onSuccess: () => {
            refetchApprovals();
            queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        },
    });

    const pending = (approvals as any[]).filter((a: any) => a.status === 'pending');
    const resolved = (approvals as any[]).filter((a: any) => a.status !== 'pending');

    const statusStyle = (s: string): React.CSSProperties => ({
        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
        background: s === 'approved' ? 'rgba(0,180,120,0.12)' : s === 'rejected' ? 'rgba(255,80,80,0.12)' : 'rgba(255,180,0,0.12)',
        color: s === 'approved' ? 'var(--success)' : s === 'rejected' ? 'var(--error)' : 'var(--warning)',
    });

    if (pending.length === 0 && resolved.length === 0) return null;

    return (
        <div className="mb-6">
            {/* Pending approvals at top */}
            {pending.length > 0 && (
                <>
                    <h4 className="m-0 mb-3 text-[13px] text-[var(--warning)]">
                        {t('agentDetail.pendingApprovals', { count: pending.length })}
                    </h4>
                    {pending.map((a: any) => (
                        <div key={a.id} className="p-[14px_16px] mb-2 rounded-lg bg-surface-secondary border border-edge-subtle">
                            <div className="flex items-center gap-2 mb-2">
                                <span style={statusStyle(a.status)}>{a.status}</span>
                                <span className="text-[13px] font-medium">{a.action_type}</span>
                                <span className="flex-1" />
                                <span className="text-[11px] text-content-tertiary">
                                    {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                                </span>
                            </div>
                            {a.details && (
                                <div className="text-xs text-content-secondary mb-2.5 leading-relaxed max-h-20 overflow-hidden">
                                    {typeof a.details === 'string' ? a.details : JSON.stringify(a.details, null, 2)}
                                </div>
                            )}
                            <div className="flex gap-2 justify-end">
                                <button
                                    className="btn btn-primary py-1.5 px-4 text-xs"
                                    onClick={() => resolveMut.mutate({ approvalId: a.id, action: 'approve' })}
                                    disabled={resolveMut.isPending}
                                >
                                    {t('agentDetail.approve')}
                                </button>
                                <button
                                    className="btn btn-danger py-1.5 px-4 text-xs"
                                    onClick={() => resolveMut.mutate({ approvalId: a.id, action: 'reject' })}
                                    disabled={resolveMut.isPending}
                                >
                                    {t('agentDetail.reject')}
                                </button>
                            </div>
                        </div>
                    ))}
                    <div className="border-t border-edge-subtle my-4" />
                </>
            )}
            {/* Approval history (collapsible) */}
            {resolved.length > 0 && (
                <details>
                    <summary className="cursor-pointer text-[13px] text-content-secondary mb-2">
                        {t('agentDetail.approvalHistory')} ({resolved.length})
                    </summary>
                    {resolved.map((a: any) => (
                        <div key={a.id} className="p-[12px_16px] mb-1.5 rounded-lg bg-surface-secondary border border-edge-subtle opacity-70">
                            <div className="flex items-center gap-2">
                                <span style={statusStyle(a.status)}>{a.status}</span>
                                <span className="text-xs">{a.action_type}</span>
                                <span className="flex-1" />
                                <span className="text-[10px] text-content-tertiary">
                                    {a.resolved_at ? new Date(a.resolved_at).toLocaleString() : ''}
                                </span>
                            </div>
                        </div>
                    ))}
                </details>
            )}
        </div>
    );
}
