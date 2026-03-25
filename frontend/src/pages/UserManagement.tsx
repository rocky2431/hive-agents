/**
 * User Management — admin page to view and manage user quotas.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { orgApi, userApi } from '@/services/api';
import { formatDateTime } from '@/lib/date';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface UserInfo {
    id: string;
    username: string;
    email: string;
    display_name: string;
    role: string;
    department_id?: string;
    title?: string;
    is_active: boolean;
    quota_message_limit: number;
    quota_message_period: string;
    quota_messages_used: number;
    quota_max_agents: number;
    quota_agent_ttl_hours: number;
    agents_count: number;
    feishu_open_id?: string;
    created_at?: string;
    source?: string;
}

const PERIOD_VALUES = ['permanent', 'daily', 'weekly', 'monthly'] as const;
const PAGE_SIZE = 15;

export default function UserManagement() {
    const { t } = useTranslation();

    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({
        display_name: '',
        title: '',
        department_id: '',
        quota_message_limit: 50,
        quota_message_period: 'permanent',
        quota_max_agents: 2,
        quota_agent_ttl_hours: 48,
    });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);
    const [departments, setDepartments] = useState<any[]>([]);

    const tenantId = localStorage.getItem('current_tenant_id') || '';

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await userApi.list(tenantId || undefined);
            setUsers(data);
        } catch (e) {
            console.error('Failed to load users', e);
        }
        setLoading(false);
    };

    const loadDepartments = async () => {
        try {
            const data = await orgApi.listDepartments(tenantId || undefined);
            const flattened: any[] = [];
            const walk = (items: any[], level = 0) => {
                items.forEach((item) => {
                    flattened.push({ ...item, level });
                    if (item.children?.length) walk(item.children, level + 1);
                });
            };
            walk(data);
            setDepartments(flattened);
        } catch (e) {
            console.error('Failed to load departments', e);
        }
    };

    useEffect(() => {
        loadUsers();
        loadDepartments();
    }, []);

    const startEdit = (user: UserInfo) => {
        setEditingUserId(user.id);
        setEditForm({
            display_name: user.display_name || '',
            title: user.title || '',
            department_id: user.department_id || '',
            quota_message_limit: user.quota_message_limit,
            quota_message_period: user.quota_message_period,
            quota_max_agents: user.quota_max_agents,
            quota_agent_ttl_hours: user.quota_agent_ttl_hours,
        });
    };

    const handleSave = async () => {
        if (!editingUserId) return;
        setSaving(true);
        try {
            await orgApi.updateUser(editingUserId, {
                display_name: editForm.display_name,
                title: editForm.title || null,
                department_id: editForm.department_id || null,
            });
            await userApi.updateQuota(editingUserId, {
                quota_message_limit: editForm.quota_message_limit,
                quota_message_period: editForm.quota_message_period,
                quota_max_agents: editForm.quota_max_agents,
                quota_agent_ttl_hours: editForm.quota_agent_ttl_hours,
            });
            setToast(t('userMgmt.quotaUpdated'));
            setTimeout(() => setToast(''), 2000);
            setEditingUserId(null);
            loadUsers();
        } catch (e: any) {
            setToast(e.message);
            setTimeout(() => setToast(''), 3000);
        }
        setSaving(false);
    };

    const periodLabel = (period: string) => t(`userMgmt.period.${period}`, period);

    // Search filter
    const filtered = searchQuery.trim()
        ? users.filter(u => {
            const q = searchQuery.toLowerCase();
            return u.username?.toLowerCase().includes(q)
                || u.display_name?.toLowerCase().includes(q)
                || u.email?.toLowerCase().includes(q);
        })
        : users;

    // Sort
    const sorted = [...filtered].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return sortOrder === 'asc' ? ta - tb : tb - ta;
    });

    // Paginate
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const toggleSort = () => {
        setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
        setPage(1);
    };

    const gridCols = 'grid grid-cols-[1.4fr_1.4fr_0.8fr_0.9fr_0.8fr_0.8fr_0.8fr_0.8fr_100px] gap-2.5';

    return (
        <div>
            {toast && (
                <div className={`fixed top-5 right-5 px-5 py-2.5 rounded-lg text-white text-xs z-[9999] transition-all ${toast.includes('error') || toast.includes('Error') ? 'bg-error' : 'bg-success'}`}>
                    {toast}
                </div>
            )}

            {loading ? (
                <div className="text-center py-10 text-content-tertiary">
                    {t('common.loading')}...
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {/* Search bar */}
                    <div className="relative mb-1">
                        <Input
                            type="text"
                            placeholder={t('userMgmt.searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                            className="max-w-[360px] text-xs"
                            autoComplete="off"
                        />
                        {searchQuery && (
                            <span className="text-xs text-content-tertiary ml-3">
                                {t('userMgmt.userCount', { filtered: filtered.length, total: users.length })}
                            </span>
                        )}
                    </div>

                    {/* Header */}
                    <div className={`${gridCols} px-4 py-2.5 text-[11px] font-semibold text-content-tertiary uppercase tracking-wide`}>
                        <div>{t('enterprise.users.user')}</div>
                        <div>{t('enterprise.users.email', 'Email')}</div>
                        <button
                            type="button"
                            className="cursor-pointer select-none flex items-center gap-0.5 bg-transparent border-none p-0 text-[11px] font-semibold text-content-tertiary uppercase tracking-wide"
                            onClick={toggleSort}
                            title={t('userMgmt.sortToggle')}
                            aria-label={t('userMgmt.sortToggle')}
                        >
                            {t('userMgmt.joined')} {sortOrder === 'asc' ? '\u2191' : '\u2193'}
                        </button>
                        <div>{t('userMgmt.source')}</div>
                        <div>{t('enterprise.users.msgQuota')}</div>
                        <div>{t('enterprise.users.period')}</div>
                        <div>{t('enterprise.users.agents')}</div>
                        <div>{t('enterprise.users.ttl', 'TTL')}</div>
                        <div />
                    </div>

                    {paged.map(user => (
                        <div key={user.id}>
                            <Card className={`${gridCols} items-center px-4 py-3`}>
                                <div>
                                    <div className="font-medium text-sm">
                                        {user.display_name || user.username}
                                        {user.role === 'platform_admin' && (
                                            <span className="ml-1.5 text-[10px] bg-accent-primary text-white rounded px-1.5 py-px">
                                                {t('common.admin')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-content-tertiary">@{user.username}</div>
                                </div>
                                <div className="text-xs text-content-secondary">{user.email}</div>
                                <div className="text-[11px] text-content-secondary">{formatDateTime(user.created_at)}</div>
                                <div>
                                    {user.source === 'feishu' ? (
                                        <span className="text-[10px] bg-blue-500/10 text-blue-500 rounded px-1.5 py-0.5 whitespace-nowrap">
                                            {t('common.channels.feishu')}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] bg-success/10 text-success rounded px-1.5 py-0.5 whitespace-nowrap">
                                            {t('userMgmt.registered')}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-[13px] font-medium">{user.quota_messages_used}</span>
                                    <span className="text-[11px] text-content-tertiary"> / {user.quota_message_limit}</span>
                                </div>
                                <div>
                                    <span className="badge badge-info text-[10px]">{periodLabel(user.quota_message_period)}</span>
                                </div>
                                <div>
                                    <span className="text-[13px] font-medium">{user.agents_count}</span>
                                    <span className="text-[11px] text-content-tertiary"> / {user.quota_max_agents}</span>
                                </div>
                                <div className="text-xs">{user.quota_agent_ttl_hours}h</div>
                                <div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => editingUserId === user.id ? setEditingUserId(null) : startEdit(user)}
                                    >
                                        {editingUserId === user.id ? t('common.cancel') : t('common.edit', 'Edit')}
                                    </Button>
                                </div>
                            </Card>

                            {/* Inline edit form */}
                            {editingUserId === user.id && (
                                <Card className="mt-1 p-4 bg-surface-secondary border-l-[3px] border-l-accent-primary">
                                    <div className="grid grid-cols-4 gap-4 mb-3">
                                        <div className="space-y-1">
                                            <Label htmlFor={`dn-${user.id}`} className="text-[11px]">
                                                {t('userMgmt.displayName', 'Display name')}
                                            </Label>
                                            <Input
                                                id={`dn-${user.id}`}
                                                value={editForm.display_name}
                                                onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                                                autoComplete="name"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`title-${user.id}`} className="text-[11px]">
                                                {t('userMgmt.title', 'Title')}
                                            </Label>
                                            <Input
                                                id={`title-${user.id}`}
                                                value={editForm.title}
                                                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                                autoComplete="organization-title"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`dept-${user.id}`} className="text-[11px]">
                                                {t('userMgmt.department', 'Department')}
                                            </Label>
                                            <Select
                                                value={editForm.department_id}
                                                onValueChange={v => setEditForm({ ...editForm, department_id: v === '__none__' ? '' : v })}
                                            >
                                                <SelectTrigger id={`dept-${user.id}`}>
                                                    <SelectValue placeholder={t('common.none', 'None')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">{t('common.none', 'None')}</SelectItem>
                                                    {departments.map(dept => (
                                                        <SelectItem key={dept.id} value={dept.id}>
                                                            {'\u2014 '.repeat(dept.level)}{dept.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">
                                                {t('userMgmt.role', 'Role')}
                                            </Label>
                                            <Input value={user.role} disabled />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-4">
                                        <div className="space-y-1">
                                            <Label htmlFor={`ml-${user.id}`} className="text-[11px]">
                                                {t('enterprise.users.msgLimit')}
                                            </Label>
                                            <Input
                                                id={`ml-${user.id}`}
                                                type="number"
                                                min={0}
                                                value={editForm.quota_message_limit}
                                                onChange={e => setEditForm({ ...editForm, quota_message_limit: Number(e.target.value) })}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`per-${user.id}`} className="text-[11px]">
                                                {t('enterprise.users.period')}
                                            </Label>
                                            <Select
                                                value={editForm.quota_message_period}
                                                onValueChange={v => setEditForm({ ...editForm, quota_message_period: v })}
                                            >
                                                <SelectTrigger id={`per-${user.id}`}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PERIOD_VALUES.map(v => (
                                                        <SelectItem key={v} value={v}>{periodLabel(v)}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`ma-${user.id}`} className="text-[11px]">
                                                {t('enterprise.users.maxAgents')}
                                            </Label>
                                            <Input
                                                id={`ma-${user.id}`}
                                                type="number"
                                                min={0}
                                                value={editForm.quota_max_agents}
                                                onChange={e => setEditForm({ ...editForm, quota_max_agents: Number(e.target.value) })}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`ttl-${user.id}`} className="text-[11px]">
                                                {t('enterprise.users.agentTTL')}
                                            </Label>
                                            <Input
                                                id={`ttl-${user.id}`}
                                                type="number"
                                                min={1}
                                                value={editForm.quota_agent_ttl_hours}
                                                onChange={e => setEditForm({ ...editForm, quota_agent_ttl_hours: Number(e.target.value) })}
                                                autoComplete="off"
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-3 flex gap-2 justify-end">
                                        <Button variant="secondary" onClick={() => setEditingUserId(null)}>
                                            {t('common.cancel')}
                                        </Button>
                                        <Button onClick={handleSave} loading={saving}>
                                            {saving ? t('common.loading') : t('common.save', 'Save')}
                                        </Button>
                                    </div>
                                </Card>
                            )}
                        </div>
                    ))}

                    {users.length === 0 && (
                        <div className="text-center py-10 text-content-tertiary">
                            {t('common.noData')}
                        </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 mt-4">
                            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                {'\u2039'} {t('userMgmt.prev')}
                            </Button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                <Button
                                    key={p}
                                    variant={p === page ? 'default' : 'secondary'}
                                    size="sm"
                                    className="min-w-[32px]"
                                    onClick={() => setPage(p)}
                                >
                                    {p}
                                </Button>
                            ))}
                            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                {t('userMgmt.next')} {'\u203A'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
