import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores';
import { adminApi, agentApi, authApi, notificationApi } from '../services/api';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import { formatRelative } from '@/lib/date';

/* ────── SVG Icons (decorative — all carry aria-hidden) ────── */
const I = { w: '16', h: '16', vb16: '0 0 16 16', vb24: '0 0 24 24', s: 'currentColor' } as const;
const svg16 = (props: Record<string, string>, ...children: React.ReactNode[]) => (
    <svg width={I.w} height={I.h} viewBox={I.vb16} fill="none" stroke={I.s} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
);
const SidebarIcons = {
    home:      svg16({}, <path key="h" d="M2.5 6.5L8 2l5.5 4.5V13a1 1 0 01-1 1h-3V10H6.5v4h-3a1 1 0 01-1-1V6.5z" />),
    plus:      svg16({}, <path key="p" d="M8 3v10M3 8h10" />),
    settings:  svg16({}, <circle key="c" cx="8" cy="8" r="2" />, <path key="g" d="M13.5 8a5.5 5.5 0 00-.3-1.8l1.3-1-1.2-2-1.5.6a5.5 5.5 0 00-1.6-.9L9.8 1.5H7.6l-.4 1.4a5.5 5.5 0 00-1.6.9L4 3.2 2.8 5.2l1.3 1A5.5 5.5 0 003.8 8c0 .6.1 1.2.3 1.8l-1.3 1 1.2 2 1.5-.6c.5.4 1 .7 1.6.9l.4 1.4h2.2l.4-1.4c.6-.2 1.1-.5 1.6-.9l1.5.6 1.2-2-1.3-1c.2-.6.3-1.2.3-1.8z" />),
    user:      svg16({}, <circle key="c" cx="8" cy="5.5" r="2.5" />, <path key="p" d="M3 14v-1a4 4 0 018 0v1" />),
    sun:       svg16({}, <circle key="c" cx="8" cy="8" r="3" />, <path key="r" d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />),
    moon:      svg16({}, <path key="m" d="M13.5 8.5a5.5 5.5 0 01-8-4.5 5.5 5.5 0 003 10c2 0 3.8-1 4.8-2.7a4 4 0 01.2-2.8z" />),
    logout:    <svg width="14" height="14" viewBox={I.vb16} fill="none" stroke={I.s} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 11l3-3-3-3M14 8H6" /></svg>,
    globe:     <svg width="14" height="14" viewBox={I.vb16} fill="none" stroke={I.s} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2a10 10 0 013 6 10 10 0 01-3 6 10 10 0 01-3-6 10 10 0 013-6z" /></svg>,
    collapse:  <svg width={I.w} height={I.h} viewBox={I.vb24} fill="none" stroke={I.s} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
    expand:    <svg width={I.w} height={I.h} viewBox={I.vb24} fill="none" stroke={I.s} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>,
    bell:      svg16({}, <path key="b" d="M4 6a4 4 0 018 0c0 2 1 3.5 1.5 4.5H2.5C3 9.5 4 8 4 6z" />, <path key="c" d="M6.5 12.5a1.5 1.5 0 003 0" />),
    briefcase: svg16({}, <rect key="r" x="2" y="5" width="12" height="9" rx="1" />, <path key="p" d="M5 5V3a2 2 0 012-2h2a2 2 0 012 2v2" />),
};


/* Compute display badge status for an agent */
const getAgentBadgeStatus = (agent: any): string | null => {
    if (agent.status === 'error') return 'error';
    if (agent.status === 'creating') return 'creating';
    // OpenClaw disconnected detection: 60 min timeout
    if (agent.agent_type === 'openclaw' && agent.status === 'running' && agent.openclaw_last_seen) {
        const elapsed = Date.now() - new Date(agent.openclaw_last_seen).getTime();
        if (elapsed > 60 * 60 * 1000) return 'disconnected';
    }
    // idle / running / stopped → no badge
    return null;
};

/* ────── Account Settings Modal ────── */
function AccountSettingsModal({ user, onClose }: { user: any; onClose: () => void }) {
    const { t } = useTranslation();
    const { setUser } = useAuthStore();
    const [username, setUsername] = useState(user?.username || '');
    const [displayName, setDisplayName] = useState(user?.display_name || '');
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [msgType, setMsgType] = useState<'success' | 'error'>('success');

    const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
        setMsg(text); setMsgType(type); setTimeout(() => setMsg(''), 3000);
    };

    const handleSaveProfile = async () => {
        setSaving(true);
        try {
            const body: any = {};
            if (username !== user?.username) body.username = username;
            if (displayName !== user?.display_name) body.display_name = displayName;
            if (Object.keys(body).length === 0) { showMsg(t('account.noChanges'), 'error'); setSaving(false); return; }
            const updated = await authApi.updateMe(body);
            setUser(updated);
            showMsg(t('account.profileUpdated'));
        } catch (e: any) { showMsg(e.message || 'Failed', 'error'); }
        setSaving(false);
    };

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword) { showMsg(t('account.fillAllFields'), 'error'); return; }
        if (newPassword.length < 6) { showMsg(t('account.minChars'), 'error'); return; }
        if (newPassword !== confirmPassword) { showMsg(t('account.passwordMismatch'), 'error'); return; }
        setSaving(true);
        try {
            await authApi.changePassword({ current_password: oldPassword, new_password: newPassword });
            showMsg(t('account.passwordChanged'));
            setOldPassword(''); setNewPassword(''); setConfirmPassword('');
        } catch (e: any) { showMsg(e.message || 'Failed', 'error'); }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="rounded-xl border border-edge-subtle bg-surface-primary w-[420px] max-h-[90vh] overflow-auto p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-5">
                    <h3 className="m-0">{t('account.title')}</h3>
                    <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close', 'Close')}>
                        ×
                    </Button>
                </div>
                {msg && (
                    <div className={`rounded-md px-3 py-2 text-xs mb-4 ${msgType === 'success' ? 'bg-success-subtle text-success' : 'bg-error-subtle text-error'}`}>
                        {msg}
                    </div>
                )}
                {/* Profile */}
                <h4 className="m-0 mb-3 text-[13px] text-content-secondary">{t('account.profile')}</h4>
                <div className="flex flex-col gap-2.5 mb-5">
                    <div>
                        <label className="block text-xs font-medium mb-1 text-content-secondary">{t('account.username')}</label>
                        <input className="form-input w-full text-[13px]" value={username} onChange={e => setUsername(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1 text-content-secondary">{t('account.displayName')}</label>
                        <input className="form-input w-full text-[13px]" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                            {saving ? '...' : t('common.save')}
                        </Button>
                    </div>
                </div>
                <div className="border-t border-edge-subtle mb-5" />
                {/* Password */}
                <h4 className="m-0 mb-3 text-[13px] text-content-secondary">{t('account.changePassword')}</h4>
                <div className="flex flex-col gap-2.5">
                    <div>
                        <label className="block text-xs font-medium mb-1 text-content-secondary">{t('account.currentPassword')}</label>
                        <input className="form-input w-full text-[13px]" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1 text-content-secondary">{t('account.newPassword')}</label>
                        <input className="form-input w-full text-[13px]" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('account.newPasswordPlaceholder')} />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1 text-content-secondary">{t('account.confirmPassword')}</label>
                        <input className="form-input w-full text-[13px]" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={handleChangePassword} disabled={saving}>
                            {saving ? '...' : t('account.changePassword')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Layout() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const queryClient = useQueryClient();
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);

    // Notification polling
    const { data: unreadCount = 0 } = useQuery({
        queryKey: ['notifications-unread'],
        queryFn: () => notificationApi.unreadCount(),
        refetchInterval: 30000,
        enabled: !!user,
    });
    const { data: notifications = [], refetch: refetchNotifications } = useQuery({
        queryKey: ['notifications'],
        queryFn: () => notificationApi.list({ limit: 20 }),
        enabled: !!user && showNotifications,
    });
    const markAllRead = async () => {
        await notificationApi.markAllRead();
        queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    const markOneRead = async (id: string) => {
        await notificationApi.markRead(id);
        queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    // Theme
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

    // Sidebar collapse state
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        return localStorage.getItem('sidebar_collapsed') === 'true';
    });

    const toggleSidebar = () => {
        setIsSidebarCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('sidebar_collapsed', String(newState));
            return newState;
        });
    };

    // Sidebar agent search & pin
    const [sidebarSearch, setSidebarSearch] = useState('');
    const [pinnedAgents, setPinnedAgents] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem('pinned_agents');
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch { return new Set(); }
    });
    const togglePin = (agentId: string) => {
        setPinnedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) next.delete(agentId);
            else next.add(agentId);
            localStorage.setItem('pinned_agents', JSON.stringify([...next]));
            return next;
        });
    };

    // Tenant switching: platform_admin can switch between companies
    const isPlatformAdmin = user?.role === 'platform_admin';
    const [currentTenant, setCurrentTenant] = useState(() =>
        localStorage.getItem('current_tenant_id') || user?.tenant_id || ''
    );
    const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);

    // Load available tenants for platform_admin
    useEffect(() => {
        if (!isPlatformAdmin) {
            const tid = user?.tenant_id || '';
            setCurrentTenant(tid);
            if (tid) localStorage.setItem('current_tenant_id', tid);
            return;
        }
        adminApi.listCompanies().then((companies: any[]) => {
            setTenants(companies.map((c: any) => ({ id: c.id, name: c.name })));
            // If no tenant selected yet, use user's own
            if (!localStorage.getItem('current_tenant_id') && user?.tenant_id) {
                localStorage.setItem('current_tenant_id', user.tenant_id);
            }
        }).catch(() => {});
    }, [isPlatformAdmin, user?.tenant_id]);

    const { data: agents = [] } = useQuery({
        queryKey: ['agents', currentTenant],
        queryFn: () => agentApi.list(currentTenant || undefined),
        refetchInterval: 30000,
    });

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const toggleLang = () => {
        i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh');
    };
    const switchTenant = (tenantId: string) => {
        setCurrentTenant(tenantId);
        localStorage.setItem('current_tenant_id', tenantId);
        window.dispatchEvent(new StorageEvent('storage', { key: 'current_tenant_id', newValue: tenantId }));
        queryClient.invalidateQueries({ queryKey: ['agents'] });
    };

    return (
        <div className="app-layout">
            <nav className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-top">
                    <div className="sidebar-logo">
                        <img src={theme === 'dark' ? '/logo-white.png' : '/logo-black.png'} alt="" className="h-[22px] w-[22px]" />
                        <span className="sidebar-logo-text">Clawith</span>
                    </div>

                    <div className="sidebar-section">
                        <NavLink to="/plaza" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                            <span className="sidebar-item-icon flex text-sm">🏛️</span>
                            <span className="sidebar-item-text">{t('nav.plaza', 'Plaza')}</span>
                        </NavLink>
                        <NavLink to="/dashboard" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                            <span className="sidebar-item-icon flex">{SidebarIcons.home}</span>
                            <span className="sidebar-item-text">{t('nav.dashboard')}</span>
                        </NavLink>
                    </div>
                </div>

                <div className="sidebar-scrollable">
                    {/* Sidebar search */}
                    {!isSidebarCollapsed && agents.length >= 5 && (
                        <div className="relative px-3 py-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
                                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                            </svg>
                            <input
                                type="text"
                                value={sidebarSearch}
                                onChange={e => setSidebarSearch(e.target.value)}
                                placeholder={t('layout.search')}
                                className="w-full rounded-md border border-edge-subtle bg-surface-secondary text-content-primary text-xs outline-none box-border py-[5px] pr-6 pl-7 focus:border-accent-primary"
                            />
                            {sidebarSearch && (
                                <button
                                    onClick={() => setSidebarSearch('')}
                                    className="absolute right-[18px] top-1/2 -translate-y-1/2 bg-transparent border-none text-content-tertiary cursor-pointer text-xs p-0.5 leading-none"
                                    aria-label={t('layout.clearSearch', 'Clear search')}
                                >
                                    &#x2715;
                                </button>
                            )}
                        </div>
                    )}
                    {/* Agent list */}
                    {(() => {
                        const q = sidebarSearch.trim().toLowerCase();
                        const filterAgent = (a: any) => !q || (a.name || '').toLowerCase().includes(q) || (a.role_description || '').toLowerCase().includes(q);
                        const sortedAgents = [...agents].filter(filterAgent).sort((a: any, b: any) => {
                            const ap = pinnedAgents.has(a.id) ? 1 : 0;
                            const bp = pinnedAgents.has(b.id) ? 1 : 0;
                            if (ap !== bp) return bp - ap;
                            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                            return bTime - aTime;
                        });
                        const renderAgent = (agent: any) => {
                            const badge = getAgentBadgeStatus(agent);
                            return (
                            <div key={agent.id} className={`relative sidebar-agent-item${agent.creator_id === user?.id ? ' owned' : ''}`}>
                                <NavLink
                                    to={`/agents/${agent.id}`}
                                    className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                                    title={agent.name}
                                >
                                    <span className="sidebar-item-icon relative">
                                        <AgentAvatar name={agent.name || '?'} status={agent.status} size="sm" />
                                        {agent.agent_type === 'openclaw' && (
                                            <span className="agent-avatar-link">
                                                <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                                </svg>
                                            </span>
                                        )}
                                        {badge && <span className={`agent-avatar-badge ${badge}`} />}
                                    </span>
                                    <span className="sidebar-item-text">{agent.name}</span>
                                </NavLink>
                                {!isSidebarCollapsed && (
                                    <button
                                        onClick={e => { e.preventDefault(); e.stopPropagation(); togglePin(agent.id); }}
                                        className={`sidebar-pin-btn ${pinnedAgents.has(agent.id) ? 'pinned' : ''}`}
                                        title={pinnedAgents.has(agent.id) ? t('layout.unpin') : t('layout.pin')}
                                        aria-label={pinnedAgents.has(agent.id) ? t('layout.unpin') : t('layout.pin')}
                                    >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill={pinnedAgents.has(agent.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1h1V2H7v2h1a1 1 0 0 1 1 1z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        );};
                        return (
                            <>
                                {sortedAgents.map(renderAgent)}
                                {agents.length === 0 && (
                                    <div className="sidebar-section">
                                        <div className="sidebar-section-title">{t('nav.myAgents')}</div>
                                    </div>
                                )}
                                {agents.length > 0 && sortedAgents.length === 0 && q && (
                                    <div className="px-4 py-3 text-xs text-content-tertiary text-center">
                                        {t('layout.noMatches')}
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>

                <div className="sidebar-bottom">
                    <div className="sidebar-section border-b border-edge-subtle pb-2 mb-0">
                        {user && (
                            <NavLink to="/agents/new" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.newAgent')}>
                                <span className="sidebar-item-icon flex">{SidebarIcons.plus}</span>
                                <span className="sidebar-item-text">{t('nav.newAgent')}</span>
                            </NavLink>
                        )}
                        {user && ['platform_admin', 'org_admin'].includes(user.role) && (
                            <NavLink to="/enterprise" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.enterprise')}>
                                <span className="sidebar-item-icon flex">{SidebarIcons.settings}</span>
                                <span className="sidebar-item-text">{t('nav.enterprise')}</span>
                            </NavLink>
                        )}
                        {user && user.role === 'platform_admin' && (
                            <NavLink to="/admin/companies" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.adminCompanies', 'Companies')}>
                                <span className="sidebar-item-icon flex">{SidebarIcons.briefcase}</span>
                                <span className="sidebar-item-text">{t('nav.adminCompanies', 'Companies')}</span>
                            </NavLink>
                        )}
                        {user && user.role === 'platform_admin' && (
                            <NavLink to="/admin/feature-flags" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.featureFlags', 'Feature Flags')}>
                                <span className="sidebar-item-icon flex">{SidebarIcons.settings}</span>
                                <span className="sidebar-item-text">{t('nav.featureFlags', 'Feature Flags')}</span>
                            </NavLink>
                        )}
                    </div>

                    <div className="sidebar-footer">
                        <div className="sidebar-footer-controls flex items-center gap-1 mb-3">
                            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7" aria-label={isSidebarCollapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}>
                                {isSidebarCollapsed ? SidebarIcons.expand : SidebarIcons.collapse}
                            </Button>
                            <div className="flex-1" />
                            {/* Notification bell */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setShowNotifications(v => !v); if (!showNotifications) refetchNotifications(); }}
                                className="relative h-7 w-7"
                                aria-label={t('layout.notifications')}
                            >
                                {SidebarIcons.bell}
                                {(unreadCount as number) > 0 && (
                                    <span className="absolute -top-0.5 -right-1 min-w-[16px] h-4 rounded-full px-1 box-border bg-error text-white text-[10px] font-semibold flex items-center justify-center leading-none">
                                        {(unreadCount as number) > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-7 w-7" aria-label={t('layout.toggleTheme', 'Toggle theme')}>
                                {theme === 'dark' ? SidebarIcons.sun : SidebarIcons.moon}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={toggleLang} className="h-7 gap-1 text-xs" aria-label={t('layout.toggleLanguage', 'Toggle language')}>
                                {SidebarIcons.globe}
                                <span>{i18n.language === 'zh' ? '中文' : 'EN'}</span>
                            </Button>
                        </div>
                        {/* Tenant switcher for platform_admin */}
                        {isPlatformAdmin && tenants.length > 1 && !isSidebarCollapsed && (
                            <select
                                value={currentTenant}
                                onChange={e => switchTenant(e.target.value)}
                                className="w-full rounded-md border border-edge-subtle bg-surface-tertiary text-content-primary text-xs cursor-pointer px-2 py-1.5 mb-2"
                            >
                                {tenants.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        )}
                        <div className="flex items-center gap-2">
                            <div
                                className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer rounded-md p-1.5 transition-colors hover:bg-surface-tertiary"
                                onClick={() => setShowAccountSettings(true)}
                                title={t('account.title')}
                            >
                                <div className="w-7 h-7 rounded-md bg-surface-tertiary border border-edge-subtle flex items-center justify-center text-content-tertiary shrink-0">
                                    {SidebarIcons.user}
                                </div>
                                <div className="sidebar-footer-user-info flex-1 min-w-0">
                                    <div className="text-[13px] font-medium truncate">
                                        {user?.display_name}
                                    </div>
                                    <div className="text-[11px] text-content-tertiary">
                                        {user?.role === 'platform_admin' ? t('roles.platformAdmin') :
                                            user?.role === 'org_admin' ? t('roles.orgAdmin') :
                                                user?.role === 'agent_admin' ? t('roles.agentAdmin') : t('roles.member')}
                                    </div>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={handleLogout} className="h-7 w-7 text-content-tertiary shrink-0" aria-label={t('layout.logout', 'Logout')}>
                                {SidebarIcons.logout}
                            </Button>
                        </div>
                        {/* Version */}
                        <div className="text-center text-[10px] text-content-tertiary/60 mt-2 tracking-wide">
                            v{(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '').split('+')[0]}
                            <span className="opacity-60">{(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '').includes('+') ? ` b${(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '').split('+')[1]}` : ''}</span>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Notification Panel */}
            {showNotifications && (
                <div className={`fixed top-0 bottom-0 w-[360px] bg-surface-primary border-r border-edge-subtle z-[9999] flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.15)] transition-[left] duration-200 ${isSidebarCollapsed ? 'left-[60px]' : 'left-[220px]'}`}>
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-edge-subtle">
                        <h3 className="m-0 text-sm font-semibold flex-1">{t('layout.notifications')}</h3>
                        {(unreadCount as number) > 0 && (
                            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-[11px]">
                                {t('layout.markAllRead')}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                navigate('/notifications');
                                setShowNotifications(false);
                            }}
                            className="text-[11px]"
                        >
                            {t('layout.viewAllNotifications', 'View all')}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setShowNotifications(false)} className="h-7 w-7" aria-label={t('common.close', 'Close')}>
                            ×
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto py-2">
                        {(notifications as any[]).length === 0 && (
                            <div className="text-center px-5 py-10 text-content-tertiary text-[13px]">
                                {t('layout.noNotifications')}
                            </div>
                        )}
                        {(notifications as any[]).map((n: any) => (
                            <div
                                key={n.id}
                                onClick={() => {
                                    if (!n.is_read) markOneRead(n.id);
                                    if (n.link) { navigate(n.link); setShowNotifications(false); }
                                }}
                                className={`px-5 py-3 border-b border-edge-subtle transition-colors hover:bg-surface-tertiary ${n.link ? 'cursor-pointer' : 'cursor-default'} ${n.is_read ? 'bg-transparent' : 'bg-surface-secondary'}`}
                            >
                                <div className="flex items-center gap-1.5 mb-1">
                                    {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />}
                                    <span className="text-xs font-medium flex-1 truncate">{n.title}</span>
                                </div>
                                {n.body && <div className="text-[11px] text-content-tertiary leading-snug truncate">{n.body}</div>}
                                <div className="text-[10px] text-content-tertiary/60 mt-1">
                                    {formatRelative(n.created_at)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {showNotifications && <div className="fixed inset-0 z-[9998]" onClick={() => setShowNotifications(false)} />}

            <main id="main-content" className="main-content">
                <Outlet />
            </main>

            {showAccountSettings && (
                <AccountSettingsModal
                    user={user}
                    onClose={() => setShowAccountSettings(false)}
                />
            )}
        </div>
    );
}
