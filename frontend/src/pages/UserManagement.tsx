/**
 * User Management — admin page to view and manage user quotas.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { orgApi } from '../services/api';

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

const API_PREFIX = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_PREFIX}${url}`, {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...options,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

const PERIOD_VALUES = ['permanent', 'daily', 'weekly', 'monthly'] as const;

const PAGE_SIZE = 15;

export default function UserManagement() {
    const { t, i18n } = useTranslation();
    const isChinese = i18n.language?.startsWith('zh');

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

    // Search, sort & pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);
    const [departments, setDepartments] = useState<any[]>([]);

    const tenantId = localStorage.getItem('current_tenant_id') || '';

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await fetchJson<UserInfo[]>(`/users/${tenantId ? `?tenant_id=${tenantId}` : ''}`);
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
            await fetchJson(`/users/${editingUserId}/quota`, {
                method: 'PATCH',
                body: JSON.stringify({
                    quota_message_limit: editForm.quota_message_limit,
                    quota_message_period: editForm.quota_message_period,
                    quota_max_agents: editForm.quota_max_agents,
                    quota_agent_ttl_hours: editForm.quota_agent_ttl_hours,
                }),
            });
            setToast(`✅ ${t('userMgmt.quotaUpdated')}`);
            setTimeout(() => setToast(''), 2000);
            setEditingUserId(null);
            loadUsers();
        } catch (e: any) {
            setToast(`❌ ${e.message}`);
            setTimeout(() => setToast(''), 3000);
        }
        setSaving(false);
    };

    const periodLabel = (period: string) => {
        return t(`userMgmt.period.${period}`, period);
    };

    const formatDate = (iso?: string) => {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.toLocaleString(isChinese ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    };

    // Search filter
    const filtered = searchQuery.trim()
        ? users.filter(u => {
            const q = searchQuery.toLowerCase();
            return (u.username?.toLowerCase().includes(q))
                || (u.display_name?.toLowerCase().includes(q))
                || (u.email?.toLowerCase().includes(q));
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

    return (
        <div>
            {toast && (
                <div style={{
                    position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
                    borderRadius: '8px', background: toast.startsWith('✅') ? 'var(--success)' : 'var(--error)',
                    color: '#fff', fontSize: '13px', zIndex: 9999, transition: 'all 0.3s',
                }}>
                    {toast}
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                    {t('common.loading')}...
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Search bar */}
                    <div style={{ position: 'relative', marginBottom: '4px' }}>
                        <input
                            className="form-input"
                            type="text"
                            placeholder={t('userMgmt.searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                            style={{
                                width: '100%', maxWidth: '360px', fontSize: '13px',
                                padding: '8px 12px 8px 12px',
                                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                                borderRadius: '8px',
                            }}
                        />
                        {searchQuery && (
                            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '12px' }}>
                                {t('userMgmt.userCount', { filtered: filtered.length, total: users.length })}
                            </span>
                        )}
                    </div>

                    {/* Header */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.8fr 0.8fr 100px',
                        gap: '10px', padding: '10px 16px', fontSize: '11px', fontWeight: 600,
                        color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                        <div>{t('enterprise.users.user')}</div>
                        <div>{t('enterprise.users.email', 'Email')}</div>
                        {/* Created At with sort toggle */}
                        <div
                            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
                            onClick={toggleSort}
                            title={t('userMgmt.sortToggle')}
                        >
                            {t('userMgmt.joined')} {sortOrder === 'asc' ? '↑' : '↓'}
                        </div>
                        <div>{t('userMgmt.source')}</div>
                        <div>{t('enterprise.users.msgQuota')}</div>
                        <div>{t('enterprise.users.period')}</div>
                        <div>{t('enterprise.users.agents')}</div>
                        <div>{t('enterprise.users.ttl', 'TTL')}</div>
                        <div></div>
                    </div>

                    {paged.map(user => (
                        <div key={user.id}>
                            <div className="card" style={{
                                display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.8fr 0.8fr 100px',
                                gap: '10px', alignItems: 'center', padding: '12px 16px',
                            }}>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '14px' }}>
                                        {user.display_name || user.username}
                                        {user.role === 'platform_admin' && (
                                            <span style={{ marginLeft: '6px', fontSize: '10px', background: 'var(--accent-color)', color: '#fff', borderRadius: '4px', padding: '1px 6px' }}>{t('common.admin')}</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>@{user.username}</div>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{user.email}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{formatDate(user.created_at)}</div>
                                <div>
                                    {user.source === 'feishu' ? (
                                        <span style={{ fontSize: '10px', background: 'rgba(58,132,255,0.12)', color: '#3a84ff', borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}>
                                            {t('common.channels.feishu')}
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: '10px', background: 'rgba(0,180,120,0.12)', color: 'var(--success)', borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}>
                                            {t('userMgmt.registered')}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{user.quota_messages_used}</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}> / {user.quota_message_limit}</span>
                                </div>
                                <div>
                                    <span className="badge badge-info" style={{ fontSize: '10px' }}>{periodLabel(user.quota_message_period)}</span>
                                </div>
                                <div>
                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{user.agents_count}</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}> / {user.quota_max_agents}</span>
                                </div>
                                <div style={{ fontSize: '12px' }}>{user.quota_agent_ttl_hours}h</div>
                                <div>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ padding: '4px 10px', fontSize: '11px' }}
                                        onClick={() => editingUserId === user.id ? setEditingUserId(null) : startEdit(user)}
                                    >
                                        {editingUserId === user.id ? t('common.cancel') : '✏️ Edit'}
                                    </button>
                                </div>
                            </div>

                            {/* Inline edit form */}
                            {editingUserId === user.id && (
                                <div className="card" style={{
                                    marginTop: '4px', padding: '16px',
                                    background: 'var(--bg-secondary)',
                                    borderLeft: '3px solid var(--accent-color)',
                                }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '12px' }}>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('userMgmt.displayName', 'Display name')}
                                            </label>
                                            <input
                                                className="form-input"
                                                value={editForm.display_name}
                                                onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('userMgmt.title', 'Title')}
                                            </label>
                                            <input
                                                className="form-input"
                                                value={editForm.title}
                                                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('userMgmt.department', 'Department')}
                                            </label>
                                            <select
                                                className="form-input"
                                                value={editForm.department_id}
                                                onChange={e => setEditForm({ ...editForm, department_id: e.target.value })}
                                            >
                                                <option value="">{t('common.none', 'None')}</option>
                                                {departments.map((dept) => (
                                                    <option key={dept.id} value={dept.id}>
                                                        {'— '.repeat(dept.level)}
                                                        {dept.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('userMgmt.role', 'Role')}
                                            </label>
                                            <input
                                                className="form-input"
                                                value={user.role}
                                                disabled
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('enterprise.users.msgLimit')}
                                            </label>
                                            <input
                                                className="form-input"
                                                type="number" min={0}
                                                value={editForm.quota_message_limit}
                                                onChange={e => setEditForm({ ...editForm, quota_message_limit: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('enterprise.users.period')}
                                            </label>
                                            <select
                                                className="form-input"
                                                value={editForm.quota_message_period}
                                                onChange={e => setEditForm({ ...editForm, quota_message_period: e.target.value })}
                                            >
                                                {PERIOD_VALUES.map(v => (
                                                    <option key={v} value={v}>{periodLabel(v)}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('enterprise.users.maxAgents')}
                                            </label>
                                            <input
                                                className="form-input"
                                                type="number" min={0}
                                                value={editForm.quota_max_agents}
                                                onChange={e => setEditForm({ ...editForm, quota_max_agents: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label" style={{ fontSize: '11px' }}>
                                                {t('enterprise.users.agentTTL')}
                                            </label>
                                            <input
                                                className="form-input"
                                                type="number" min={1}
                                                value={editForm.quota_agent_ttl_hours}
                                                onChange={e => setEditForm({ ...editForm, quota_agent_ttl_hours: Number(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-secondary" onClick={() => setEditingUserId(null)}>
                                            {t('common.cancel')}
                                        </button>
                                        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                            {saving ? t('common.loading') : t('common.save', 'Save')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {users.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                            {t('common.noData')}
                        </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
                            <button
                                className="btn btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                disabled={page <= 1}
                                onClick={() => setPage(p => p - 1)}
                            >
                                ‹ {t('userMgmt.prev')}
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                <button
                                    key={p}
                                    className={`btn ${p === page ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{ padding: '4px 10px', fontSize: '12px', minWidth: '32px' }}
                                    onClick={() => setPage(p)}
                                >
                                    {p}
                                </button>
                            ))}
                            <button
                                className="btn btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                disabled={page >= totalPages}
                                onClick={() => setPage(p => p + 1)}
                            >
                                {t('userMgmt.next')} ›
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
