import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { enterpriseApi } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/domain/empty-state';
import { formatDate } from '@/lib/date';

export default function InvitationCodes({ tenantId: tenantIdProp }: { tenantId?: string }) {
    const { t } = useTranslation();
    const [codes, setCodes] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const pageSize = 20;
    const [batchCount, setBatchCount] = useState(5);
    const [maxUses, setMaxUses] = useState(5);
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState('');
    const tenantId = tenantIdProp || localStorage.getItem('current_tenant_id') || '';

    const loadCodes = useCallback(async (p?: number, q?: string) => {
        const currentPage = p ?? page;
        const currentSearch = q ?? search;
        const params = new URLSearchParams();
        params.set('page', String(currentPage));
        params.set('page_size', String(pageSize));
        if (currentSearch) params.set('search', currentSearch);
        if (tenantId) params.set('tenant_id', tenantId);
        const data = await enterpriseApi.listInvitationCodes(Object.fromEntries(params.entries()));
        setCodes(data.items || []);
        setTotal(data.total || 0);
    }, [page, search, tenantId]);

    useEffect(() => { loadCodes(page, search); }, [page, search, loadCodes]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const handleSearch = (value: string) => {
        setSearch(value);
        setPage(1);
    };

    const createBatch = async () => {
        setCreating(true);
        await enterpriseApi.createInvitationCodes({ count: batchCount, max_uses: maxUses }, tenantId || undefined);
        setPage(1);
        setSearch('');
        await loadCodes(1, '');
        setCreating(false);
        setToast(t('enterprise.invites.createBtn', 'Created!'));
        setTimeout(() => setToast(''), 2000);
    };

    const deactivate = async (id: string) => {
        await enterpriseApi.deleteInvitationCode(id, tenantId || undefined);
        await loadCodes();
    };

    const exportCsv = () => {
        const a = document.createElement('a');
        enterpriseApi.exportInvitationCodes(tenantId || undefined)
            .then(r => r.blob())
            .then(blob => {
                a.href = URL.createObjectURL(blob);
                a.download = 'invitation_codes.csv';
                a.click();
                URL.revokeObjectURL(a.href);
            });
    };

    return (
        <div className="mx-auto max-w-[900px] px-6 py-8">
            {toast && (
                <div className="fixed top-5 right-5 z-[9999] rounded-lg bg-success px-5 py-2.5 text-sm text-white" role="status" aria-live="polite">
                    {toast}
                </div>
            )}

            <h2 className="text-xl font-semibold mb-1">{t('enterprise.invites.pageTitle', 'Invitation Codes')}</h2>
            <p className="text-sm text-content-tertiary mb-6">
                {t('enterprise.invites.pageDesc', 'Manage invitation codes for platform registration.')}
            </p>

            {/* Batch Create */}
            <Card className="mb-4">
                <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                        {t('enterprise.invites.createTitle', 'Create Invitation Codes')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <Label htmlFor="invite-batch-count" className="text-xs text-content-tertiary">{t('enterprise.invites.count', 'Number of Codes')}</Label>
                            <Input id="invite-batch-count" type="number" min={1} max={100} value={batchCount} onChange={e => setBatchCount(Number(e.target.value))} className="mt-1" autoComplete="off" />
                        </div>
                        <div className="flex-1">
                            <Label htmlFor="invite-max-uses" className="text-xs text-content-tertiary">{t('enterprise.invites.maxUses', 'Max Uses per Code')}</Label>
                            <Input id="invite-max-uses" type="number" min={1} value={maxUses} onChange={e => setMaxUses(Number(e.target.value))} className="mt-1" autoComplete="off" />
                        </div>
                        <Button onClick={createBatch} disabled={creating} loading={creating} className="shrink-0">
                            {t('enterprise.invites.createBtn', 'Generate')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Codes Table */}
            <Card>
                <CardContent className="pt-4">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-content-secondary">
                            {t('enterprise.invites.listTitle', 'All Invitation Codes')} ({total})
                        </span>
                        <div className="flex items-center gap-2">
                            <Input
                                placeholder={t('common.search', 'Search') + '\u2026'}
                                value={search}
                                onChange={e => handleSearch(e.target.value)}
                                className="h-7 w-48 text-xs"
                            />
                            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={codes.length === 0}>
                                {t('enterprise.invites.export', 'Export CSV')}
                            </Button>
                        </div>
                    </div>

                    {/* Table header */}
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_100px] gap-3 border-b border-edge-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-content-tertiary">
                        <div>{t('enterprise.invites.code', 'Code')}</div>
                        <div>{t('enterprise.invites.usage', 'Usage')}</div>
                        <div>{t('enterprise.invites.status', 'Status')}</div>
                        <div>{t('enterprise.invites.created', 'Created')}</div>
                        <div />
                    </div>

                    {codes.length === 0 && (
                        <EmptyState title={t('common.noData', 'No data')} />
                    )}

                    {codes.map((c: any) => (
                        <div key={c.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_100px] items-center gap-3 border-b border-edge-subtle px-3 py-2.5 text-sm">
                            <div className="font-mono font-medium tracking-wider">{c.code}</div>
                            <div className="tabular-nums">
                                <span className="font-medium">{c.used_count}</span>
                                <span className="text-content-tertiary"> / {c.max_uses}</span>
                            </div>
                            <div>
                                {!c.is_active ? (
                                    <Badge variant="secondary">{t('enterprise.invites.deactivated', 'Disabled')}</Badge>
                                ) : c.used_count >= c.max_uses ? (
                                    <Badge variant="warning">{t('enterprise.invites.exhausted', 'Exhausted')}</Badge>
                                ) : (
                                    <Badge variant="success">{t('enterprise.invites.active', 'Active')}</Badge>
                                )}
                            </div>
                            <div className="text-xs text-content-tertiary tabular-nums">
                                {formatDate(c.created_at)}
                            </div>
                            <div>
                                {c.is_active && c.used_count < c.max_uses && (
                                    <Button variant="secondary" size="sm" className="text-[10px] px-2 py-0.5" onClick={() => deactivate(c.id)}>
                                        {t('enterprise.invites.disable', 'Disable')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-4 pb-1 text-sm">
                            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
                                ←
                            </Button>
                            <span className="text-content-secondary tabular-nums">{page} / {totalPages}</span>
                            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
                                →
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
