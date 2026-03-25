import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auditApi } from '@/services/api';

export function AuditTab() {
    const { t } = useTranslation();

    const [auditSearch, setAuditSearch] = useState('');
    const [auditEventType, setAuditEventType] = useState('');
    const [auditSeverity, setAuditSeverity] = useState('');
    const [auditDateFrom, setAuditDateFrom] = useState('');
    const [auditDateTo, setAuditDateTo] = useState('');
    const [auditPage, setAuditPage] = useState(1);
    const [auditPageSize] = useState(20);
    const [auditChainResult, setAuditChainResult] = useState<Record<string, { valid: boolean; event_hash: string; computed_hash: string } | null>>({});

    const { data: auditData } = useQuery({
        queryKey: ['audit-events', auditSearch, auditEventType, auditSeverity, auditDateFrom, auditDateTo, auditPage, auditPageSize],
        queryFn: () => auditApi.query({
            search: auditSearch || undefined,
            event_type: auditEventType || undefined,
            severity: auditSeverity || undefined,
            date_from: auditDateFrom || undefined,
            date_to: auditDateTo || undefined,
            page: auditPage,
            page_size: auditPageSize,
        }),
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

    const EVENT_TYPES = [
        'auth.login', 'auth.login_failed', 'auth.oidc_login',
        'agent.created', 'agent.deleted', 'agent.started', 'agent.stopped',
        'approval.resolved', 'capability.denied',
        'tool.installed', 'tool.removed',
        'model.created', 'model.deleted',
        'settings.updated',
    ];

    const severityColors: Record<string, { bg: string; color: string }> = {
        info: { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent-color, #6366f1)' },
        warn: { bg: 'rgba(255,159,10,0.12)', color: 'var(--warning, #ff9f0a)' },
        error: { bg: 'rgba(255,59,48,0.12)', color: 'var(--error, #ff3b30)' },
    };

    return (
        <div>
            {/* Search & Filters */}
            <div className="card p-4 mb-4">
                <div className="flex gap-3 flex-wrap items-end">
                    <div className="flex-[2_1_200px]">
                        <label htmlFor="audit-search" className="text-xs font-medium block mb-1">{t('enterprise.audit.search')}</label>
                        <input id="audit-search" className="input text-[13px]" value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditPage(1); }} placeholder={t('enterprise.audit.search')} autoComplete="off" />
                    </div>
                    <div className="flex-[1_1_160px]">
                        <label htmlFor="audit-event-type" className="text-xs font-medium block mb-1">{t('enterprise.audit.eventType')}</label>
                        <select id="audit-event-type" className="input text-[13px]" value={auditEventType} onChange={e => { setAuditEventType(e.target.value); setAuditPage(1); }}>
                            <option value="">{t('enterprise.audit.filterAll')}</option>
                            {EVENT_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
                        </select>
                    </div>
                    <div className="flex-[1_1_120px]">
                        <label htmlFor="audit-severity" className="text-xs font-medium block mb-1">{t('enterprise.audit.severity')}</label>
                        <select id="audit-severity" className="input text-[13px]" value={auditSeverity} onChange={e => { setAuditSeverity(e.target.value); setAuditPage(1); }}>
                            <option value="">{t('enterprise.audit.filterAll')}</option>
                            <option value="info">Info</option>
                            <option value="warn">Warn</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                    <div className="flex-[1_1_140px]">
                        <label htmlFor="audit-date-from" className="text-xs font-medium block mb-1">{t('enterprise.audit.dateRange')}</label>
                        <input id="audit-date-from" type="date" className="input text-[13px]" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }} />
                    </div>
                    <div className="flex-[1_1_140px]">
                        <label htmlFor="audit-date-to" className="text-xs font-medium block mb-1">&nbsp;</label>
                        <input id="audit-date-to" type="date" className="input text-[13px]" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }} />
                    </div>
                    <button className="btn btn-secondary text-[13px] whitespace-nowrap" onClick={handleAuditExport}>
                        {t('enterprise.audit.export')}
                    </button>
                </div>
            </div>

            {/* Results count */}
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-content-tertiary">
                    {t('enterprise.audit.records', { count: auditTotal })}
                </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="table w-full text-[13px]">
                    <thead>
                        <tr>
                            <th className="whitespace-nowrap">{t('enterprise.audit.time')}</th>
                            <th>{t('enterprise.audit.eventType')}</th>
                            <th>{t('enterprise.audit.severity')}</th>
                            <th>{t('enterprise.audit.user')}</th>
                            <th>{t('enterprise.audit.action')}</th>
                            <th>{t('enterprise.audit.identity')}</th>
                            <th>{t('enterprise.audit.target')}</th>
                            <th className="w-20">{t('enterprise.audit.chain')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {auditEvents.map((ev: any) => {
                            const sc = severityColors[ev.severity] || severityColors.info;
                            const chainRes = auditChainResult[ev.id];
                            const isBot = ev.execution_identity === 'bot' || ev.execution_identity === 'agent';
                            return (
                                <tr key={ev.id}>
                                    <td className="whitespace-nowrap font-mono text-[11px] text-content-tertiary">
                                        {new Date(ev.created_at || ev.timestamp).toLocaleString()}
                                    </td>
                                    <td>
                                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-tertiary,rgba(255,255,255,0.05))]">
                                            {ev.event_type || ev.action || '-'}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: sc.bg, color: sc.color }}>
                                            {ev.severity || 'info'}
                                        </span>
                                    </td>
                                    <td className="text-xs">{ev.actor || ev.user_email || '-'}</td>
                                    <td className="text-xs font-medium">{ev.action || ev.event_type || '-'}</td>
                                    <td>
                                        <span className="inline-flex items-center gap-1 text-[11px] text-content-secondary">
                                            <span>{isBot ? '\u{1F916}' : '\u{1F464}'}</span>
                                            {isBot ? t('enterprise.audit.identityBot') : t('enterprise.audit.identityUser')}
                                        </span>
                                    </td>
                                    <td className="text-[11px] text-content-tertiary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                                        {ev.details ? (typeof ev.details === 'string' ? ev.details.slice(0, 80) : JSON.stringify(ev.details).slice(0, 80)) : '-'}
                                    </td>
                                    <td>
                                        {chainRes === undefined ? (
                                            <button className="btn btn-ghost text-[11px] px-1.5 py-0.5" onClick={() => handleVerifyChain(ev.id)}>
                                                {t('enterprise.audit.chain')}
                                            </button>
                                        ) : chainRes === null ? (
                                            <span className="text-[11px] text-content-tertiary">-</span>
                                        ) : (
                                            <span className="text-[11px]" style={{ color: chainRes.valid ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)' }}>
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
            {auditEvents.length === 0 && <div className="text-center py-10 text-content-tertiary">{t('common.noData')}</div>}

            {/* Pagination */}
            {auditTotalPages > 1 && (
                <div className="flex justify-center gap-2 mt-4 items-center">
                    <button className="btn btn-ghost text-xs" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)} aria-label={t('admin.prev', 'Previous page')}>&laquo;</button>
                    <span className="text-xs text-content-secondary">{auditPage} / {auditTotalPages}</span>
                    <button className="btn btn-ghost text-xs" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage(p => p + 1)} aria-label={t('admin.next', 'Next page')}>&raquo;</button>
                </div>
            )}
        </div>
    );
}
