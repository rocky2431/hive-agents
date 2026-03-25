import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, enterpriseApi } from '../services/api';
import { useAuthStore } from '../stores';

import { formatTokens } from '@/lib/format';
import { formatDate } from '@/lib/date';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

type SortKey = 'name' | 'user_count' | 'agent_count' | 'total_tokens' | 'created_at' | 'is_active';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 15;

// Platform Admin company management page
export default function AdminCompanies() {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const [companies, setCompanies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Sorting
    const [sortKey, setSortKey] = useState<SortKey>('created_at');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    // Pagination
    const [page, setPage] = useState(0);

    // Platform settings
    const [settings, setSettings] = useState<any>({});
    const [settingsLoading, setSettingsLoading] = useState(false);

    // Create company
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [createdCode, setCreatedCode] = useState('');
    const [createdCompanyName, setCreatedCompanyName] = useState('');
    const [codeCopied, setCodeCopied] = useState(false);

    // Notification bar
    const [nbEnabled, setNbEnabled] = useState(false);
    const [nbText, setNbText] = useState('');
    const [nbSaving, setNbSaving] = useState(false);
    const [nbSaved, setNbSaved] = useState(false);

    // Toast
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
    const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const loadCompanies = async () => {
        setLoading(true);
        try {
            const data = await adminApi.listCompanies();
            setCompanies(data);
        } catch (e: any) {
            setError(e.message);
        }
        setLoading(false);
    };

    const loadSettings = async () => {
        try {
            const data = await adminApi.getPlatformSettings();
            setSettings(data);
        } catch { }
    };

    const loadNotificationBar = async () => {
        try {
            const d = await enterpriseApi.getSystemSetting('notification_bar');
            if (d?.value) {
                setNbEnabled(!!d.value.enabled);
                setNbText(d.value.text || '');
            }
        } catch { }
    };

    const saveNotificationBar = async () => {
        setNbSaving(true);
        try {
            await enterpriseApi.updateSystemSetting('notification_bar', { value: { enabled: nbEnabled, text: nbText } });
            setNbSaved(true);
            setTimeout(() => setNbSaved(false), 2000);
        } catch { }
        setNbSaving(false);
    };

    useEffect(() => {
        loadCompanies();
        loadSettings();
        loadNotificationBar();
    }, []);

    // Guard: only platform_admin
    if (user?.role !== 'platform_admin') {
        return (
            <div className="p-16 text-center text-content-tertiary">
                {t('common.noPermission', 'You do not have permission to access this page.')}
            </div>
        );
    }

    // Sorting logic
    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'name' ? 'asc' : 'desc');
        }
        setPage(0);
    };

    const sorted = useMemo(() => {
        const list = [...companies];
        list.sort((a, b) => {
            let av = a[sortKey], bv = b[sortKey];
            if (sortKey === 'name') {
                av = (av || '').toLowerCase();
                bv = (bv || '').toLowerCase();
            }
            if (sortKey === 'created_at') {
                av = av ? new Date(av).getTime() : 0;
                bv = bv ? new Date(bv).getTime() : 0;
            }
            if (sortKey === 'is_active') {
                av = av ? 1 : 0;
                bv = bv ? 1 : 0;
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return list;
    }, [companies, sortKey, sortDir]);

    // Pagination
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const result = await adminApi.createCompany({ name: newName.trim() });
            setCreatedCompanyName(newName.trim());
            setCreatedCode(result.admin_invitation_code || '');
            setCodeCopied(false);
            setNewName('');
            setShowCreate(false);
            loadCompanies();
        } catch (e: any) {
            showToast(e.message || 'Failed', 'error');
        }
        setCreating(false);
    };

    const handleCopyCode = () => {
        navigator.clipboard.writeText(createdCode).then(() => {
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
        });
    };

    const handleToggle = async (id: string, currentlyActive: boolean) => {
        const action = currentlyActive ? 'disable' : 'enable';
        if (currentlyActive && !confirm(t('admin.confirmDisable', 'Disable this company? All users and agents will be paused.'))) return;
        try {
            await adminApi.toggleCompany(id);
            loadCompanies();
            showToast(`Company ${action}d`);
        } catch (e: any) {
            showToast(e.message || 'Failed', 'error');
        }
    };

    const handleToggleSetting = async (key: string, value: boolean) => {
        setSettingsLoading(true);
        try {
            await adminApi.updatePlatformSettings({ [key]: value });
            setSettings((s: any) => ({ ...s, [key]: value }));
            showToast('Setting updated');
        } catch (e: any) {
            showToast(e.message || 'Failed', 'error');
        }
        setSettingsLoading(false);
    };

    const SortArrow = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <span className="ml-0.5 opacity-30">&#x2195;</span>;
        return <span className="ml-0.5">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
    };

    const columns: { key: SortKey; label: string; flex: string }[] = [
        { key: 'name', label: t('admin.company', 'Company'), flex: '2fr' },
        { key: 'user_count', label: t('admin.users', 'Users'), flex: '80px' },
        { key: 'agent_count', label: t('admin.agents', 'Agents'), flex: '80px' },
        { key: 'total_tokens', label: t('admin.tokens', 'Token Usage'), flex: '100px' },
        { key: 'created_at', label: t('admin.createdAt', 'Created'), flex: '100px' },
        { key: 'is_active', label: t('admin.status', 'Status'), flex: '120px' },
    ];

    const gridCols = columns.map(c => c.flex).join(' ');

    return (
        <div className="mx-auto max-w-[1040px] px-6 py-8">
            {toast && (
                <div role="status" aria-live="polite" className={`fixed top-5 right-5 z-[9999] rounded-lg px-5 py-2.5 text-[13px] text-white shadow-lg ${toast.type === 'success' ? 'bg-success' : 'bg-error'}`}>
                    {toast.msg}
                </div>
            )}

            {/* Invitation Code Modal */}
            <Dialog open={!!createdCode} onOpenChange={(open) => { if (!open) setCreatedCode(''); }}>
                <DialogContent className="max-w-[480px]">
                    <DialogHeader className="items-center text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                        </div>
                        <DialogTitle>{t('admin.companyCreated', 'Company Created')}</DialogTitle>
                        <p className="text-[13px] text-content-tertiary">
                            <span className="font-medium text-content-primary">{createdCompanyName}</span>
                            {' '}{t('admin.companyCreatedDesc', 'has been created successfully.')}
                        </p>
                    </DialogHeader>

                    <div className="rounded-lg border border-edge-subtle bg-surface-secondary p-4">
                        <div className="mb-2 text-xs font-semibold text-content-secondary">
                            {t('admin.inviteCodeLabel', 'Admin Invitation Code')}
                        </div>
                        <div className="select-all text-center font-mono text-[22px] font-bold tracking-widest text-success py-2">
                            {createdCode}
                        </div>
                    </div>

                    <div className="rounded-md border border-blue-500/10 bg-blue-500/5 p-3 text-xs leading-relaxed text-content-tertiary">
                        <div className="mb-1 font-semibold text-content-secondary">
                            {t('admin.inviteCodeHowTo', 'How to use this code:')}
                        </div>
                        {t('admin.inviteCodeExplain', 'Send this code to the person who will manage this company. They should register a new account on the platform, then enter this code to join. The first person to use it will automatically become the Org Admin of this company. This code is single-use.')}
                    </div>

                    <DialogFooter className="flex-row gap-2 sm:flex-row">
                        <Button onClick={handleCopyCode} className="flex-1" aria-label={t('admin.copyCode', 'Copy Code')}>
                            {codeCopied ? (
                                t('admin.copied', 'Copied')
                            ) : (
                                <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="9" y="9" width="13" height="13" rx="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                    {t('admin.copyCode', 'Copy Code')}
                                </>
                            )}
                        </Button>
                        <Button variant="secondary" onClick={() => setCreatedCode('')}>
                            {t('common.close', 'Close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="mb-1 text-xl font-semibold">{t('admin.title', 'Company Management')}</h1>
                    <p className="text-[13px] text-content-tertiary">
                        {t('admin.desc', 'Manage all companies, create new ones, and configure platform settings.')}
                    </p>
                </div>
                <Button onClick={() => { setShowCreate(true); setCreatedCode(''); }}>
                    + {t('admin.createCompany', 'Create Company')}
                </Button>
            </div>

            {/* Platform Settings */}
            <Card className="mb-4">
                <CardHeader className="pb-3">
                    <CardTitle className="text-[13px] text-content-secondary">{t('admin.platformSettings', 'Platform Settings')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    {[
                        { key: 'allow_self_create_company', label: t('admin.allowSelfCreate', 'Allow users to create their own companies'), desc: t('admin.allowSelfCreateDesc', 'When disabled, only platform admins can create companies.') },
                        { key: 'invitation_code_enabled', label: t('admin.invitationCodeEnabled', 'Require invitation code for workspace access'), desc: t('admin.invitationCodeEnabledDesc', 'When enabled, users must join an existing company with an invitation code before they can start using the platform.') },
                    ].map(s => (
                        <div key={s.key} className="flex items-center justify-between py-2">
                            <div>
                                <div className="text-[13px] font-medium">{s.label}</div>
                                <div className="mt-0.5 text-[11px] text-content-tertiary">{s.desc}</div>
                            </div>
                            <label className={`relative inline-block h-[22px] w-10 shrink-0 ${settingsLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input type="checkbox" checked={!!settings[s.key]} onChange={(e) => handleToggleSetting(s.key, e.target.checked)} disabled={settingsLoading}
                                    className="h-0 w-0 opacity-0" />
                                <span className={`absolute inset-0 rounded-[11px] transition-colors ${settings[s.key] ? 'bg-[#22c55e]' : 'bg-surface-tertiary'}`}>
                                    <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-[left] ${settings[s.key] ? 'left-5' : 'left-0.5'}`} />
                                </span>
                            </label>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Notification Bar Config */}
            <Card className="mb-4">
                <CardHeader className="pb-0">
                    <CardTitle className="text-[13px] text-content-secondary">
                        {t('enterprise.notificationBar.title', 'Notification Bar')}
                    </CardTitle>
                    <p className="text-[11px] text-content-tertiary">
                        {t('enterprise.notificationBar.description', 'Display a notification bar at the top of the page, visible to all users.')}
                    </p>
                </CardHeader>
                <CardContent className="pt-3">
                    <label className="mb-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                        <input type="checkbox" checked={nbEnabled} onChange={e => setNbEnabled(e.target.checked)}
                            className="h-4 w-4 cursor-pointer" />
                        {t('enterprise.notificationBar.enabled', 'Enable notification bar')}
                    </label>
                    <div className="mb-3">
                        <label htmlFor="admin-nb-text" className="form-label">{t('enterprise.notificationBar.text', 'Notification text')}</label>
                        <Input id="admin-nb-text" value={nbText} onChange={e => setNbText(e.target.value)}
                            placeholder={t('enterprise.notificationBar.textPlaceholder', 'e.g. v2.1 released with new features!')} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={saveNotificationBar} loading={nbSaving}>
                            {nbSaving ? t('common.loading') : t('common.save', 'Save')}
                        </Button>
                        {nbSaved && <span className="text-xs text-success">{t('enterprise.config.saved', 'Saved')}</span>}
                    </div>
                </CardContent>
            </Card>

            {/* Create Company -- inline input */}
            {showCreate && (
                <Card className="mb-4 border-accent-primary">
                    <CardHeader className="pb-0">
                        <CardTitle className="text-[13px]">{t('admin.createCompany', 'Create Company')}</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-3">
                        <div className="flex gap-2">
                            <Input className="flex-1" value={newName} onChange={e => setNewName(e.target.value)}
                                placeholder={t('admin.companyNamePlaceholder', 'Company name')}
                                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                autoFocus />
                            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                                {creating ? '...' : t('common.create', 'Create')}
                            </Button>
                            <Button variant="secondary" onClick={() => setShowCreate(false)}>
                                {t('common.cancel', 'Cancel')}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Company List */}
            <Card className="overflow-hidden p-0">
                {/* Table Header */}
                <div className="grid gap-3 border-b border-edge-subtle bg-surface-secondary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-tertiary"
                    style={{ gridTemplateColumns: gridCols }}>
                    {columns.map(col => (
                        <button key={col.key} type="button" className="flex cursor-pointer select-none items-center gap-0.5"
                            onClick={() => handleSort(col.key)}>
                            {col.label}<SortArrow col={col.key} />
                        </button>
                    ))}
                </div>

                {loading && (
                    <div className="py-10 text-center text-[13px] text-content-tertiary">
                        {t('common.loading', 'Loading...')}
                    </div>
                )}

                {error && (
                    <div className="py-6 text-center text-[13px] text-error">{error}</div>
                )}

                {!loading && paged.map((c: any) => (
                    <div key={c.id}
                        className={`grid items-center gap-3 border-b border-edge-subtle px-4 py-3 text-[13px] ${c.is_active ? '' : 'opacity-50'}`}
                        style={{ gridTemplateColumns: gridCols }}>
                        <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="font-mono text-[11px] text-content-tertiary">{c.slug}</div>
                        </div>
                        <div>{c.user_count ?? '-'}</div>
                        <div>{c.agent_count ?? '-'}</div>
                        <div className="font-mono text-xs">{formatTokens(c.total_tokens)}</div>
                        <div className="text-xs text-content-secondary">{formatDate(c.created_at)}</div>
                        <div className="flex items-center gap-2">
                            <Badge variant={c.is_active ? 'success' : 'error'}>
                                {c.is_active ? t('admin.active', 'Active') : t('admin.disabled', 'Disabled')}
                            </Badge>
                            <Button variant="ghost" size="sm"
                                className={c.slug === 'default'
                                    ? 'text-content-tertiary opacity-50 cursor-not-allowed'
                                    : c.is_active ? 'text-error' : 'text-success'}
                                onClick={() => handleToggle(c.id, c.is_active)}
                                disabled={c.slug === 'default'}
                                title={c.slug === 'default' ? t('admin.cannotDisableDefault', 'Cannot disable the default company -- platform admin would be locked out') : undefined}
                                aria-label={c.is_active ? t('admin.disable', 'Disable') : t('admin.enable', 'Enable')}>
                                {c.is_active ? t('admin.disable', 'Disable') : t('admin.enable', 'Enable')}
                            </Button>
                        </div>
                    </div>
                ))}

                {!loading && companies.length === 0 && !error && (
                    <div className="py-10 text-center text-[13px] text-content-tertiary">
                        {t('common.noData', 'No data')}
                    </div>
                )}

                {/* Pagination */}
                {!loading && totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-edge-subtle bg-surface-secondary px-4 py-2.5 text-xs text-content-tertiary">
                        <span>
                            {t('admin.showing', '{{start}}-{{end}} of {{total}}', {
                                start: page * PAGE_SIZE + 1,
                                end: Math.min((page + 1) * PAGE_SIZE, sorted.length),
                                total: sorted.length,
                            })}
                        </span>
                        <div className="flex gap-1">
                            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                                &lsaquo; {t('admin.prev', 'Prev')}
                            </Button>
                            <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                                {t('admin.next', 'Next')} &rsaquo;
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
