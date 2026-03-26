import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores';
import { adminApi, agentApi, notificationApi } from '../services/api';
import { Button } from '@/components/ui/button';
import { CommandBar } from '@/components/shell/command-bar';
import { SidebarAgentList } from '@/components/shell/sidebar-agent-list';
import { NotificationTray } from '@/components/shell/notification-tray';
import { AccountMenu } from '@/components/shell/account-menu';
import {
    Home,
    Plus,
    Settings,
    Landmark,
    Bell,
    Sun,
    Moon,
    LogOut,
    Globe,
    ChevronsLeft,
    ChevronsRight,
    User,
    Briefcase,
    Flag,
    Search,
} from 'lucide-react';

declare const __APP_VERSION__: string;

export default function Layout() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const queryClient = useQueryClient();
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);

    // Notification unread count (for bell badge)
    const { data: unreadCount = 0 } = useQuery({
        queryKey: ['notifications-unread'],
        queryFn: () => notificationApi.unreadCount(),
        refetchInterval: 30000,
        enabled: !!user,
    });

    // Theme
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

    // Sidebar collapse
    const [collapsed, setCollapsed] = useState(() => {
        return localStorage.getItem('sidebar_collapsed') === 'true';
    });

    const toggleSidebar = () => {
        setCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('sidebar_collapsed', String(next));
            return next;
        });
    };

    // Tenant switching (platform_admin)
    const isPlatformAdmin = user?.role === 'platform_admin';
    const [currentTenant, setCurrentTenant] = useState(() =>
        localStorage.getItem('current_tenant_id') || user?.tenant_id || ''
    );
    const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        if (!isPlatformAdmin) {
            const tid = user?.tenant_id || '';
            setCurrentTenant(tid);
            if (tid) localStorage.setItem('current_tenant_id', tid);
            return;
        }
        adminApi.listCompanies().then((companies: any[]) => {
            setTenants(companies.map((c: any) => ({ id: c.id, name: c.name })));
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

    const roleLabel = user?.role === 'platform_admin' ? t('roles.platformAdmin')
        : user?.role === 'org_admin' ? t('roles.orgAdmin')
        : user?.role === 'agent_admin' ? t('roles.agentAdmin')
        : t('roles.member');

    const isAdmin = user && ['platform_admin', 'org_admin'].includes(user.role);

    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const versionMain = version.split('+')[0];
    const versionBuild = version.includes('+') ? ` b${version.split('+')[1]}` : '';

    return (
        <div className="app-layout">
            {/* Command Palette (Cmd+K) */}
            <CommandBar tenantId={currentTenant || undefined} />

            {/* Sidebar */}
            <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-top">
                    <div className="sidebar-logo">
                        <img src={theme === 'dark' ? '/logo-white.png' : '/logo-black.png'} alt="" className="h-[22px] w-[22px]" />
                        <span className="sidebar-logo-text">Hive</span>
                    </div>

                    <div className="sidebar-section">
                        <NavLink to="/plaza" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                            <span className="sidebar-item-icon flex"><Landmark size={16} /></span>
                            <span className="sidebar-item-text">{t('nav.plaza', 'Plaza')}</span>
                        </NavLink>
                        <NavLink to="/home" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                            <span className="sidebar-item-icon flex"><Home size={16} /></span>
                            <span className="sidebar-item-text">{t('nav.dashboard')}</span>
                        </NavLink>
                    </div>

                    {/* Cmd+K hint */}
                    {!collapsed && (
                        <div className="px-3 py-1">
                            <button
                                type="button"
                                onClick={() => window.dispatchEvent(new CustomEvent('open-command-bar'))}
                                className="w-full flex items-center gap-2 rounded-md border border-edge-subtle bg-surface-secondary px-2.5 py-[5px] text-xs text-content-tertiary transition-colors hover:bg-surface-hover hover:text-content-secondary cursor-pointer"
                            >
                                <Search size={12} />
                                <span className="flex-1 text-left">{t('layout.search')}</span>
                                <kbd className="rounded border border-edge-subtle bg-surface-tertiary px-1 py-0.5 font-mono text-[10px]">
                                    &#8984;K
                                </kbd>
                            </button>
                        </div>
                    )}
                </div>

                <div className="sidebar-scrollable">
                    <SidebarAgentList agents={agents} userId={user?.id} collapsed={collapsed} />
                </div>

                <div className="sidebar-bottom">
                    <div className="sidebar-section border-b border-edge-subtle pb-2 mb-0">
                        {user && (
                            <NavLink to="/agents/new" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.newAgent')}>
                                <span className="sidebar-item-icon flex"><Plus size={16} /></span>
                                <span className="sidebar-item-text">{t('nav.newAgent')}</span>
                            </NavLink>
                        )}
                        {isAdmin && (
                            <NavLink to="/workspace" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.enterprise')}>
                                <span className="sidebar-item-icon flex"><Settings size={16} /></span>
                                <span className="sidebar-item-text">{t('nav.enterprise')}</span>
                            </NavLink>
                        )}
                        {isPlatformAdmin && (
                            <NavLink to="/admin/companies" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.adminCompanies', 'Companies')}>
                                <span className="sidebar-item-icon flex"><Briefcase size={16} /></span>
                                <span className="sidebar-item-text">{t('nav.adminCompanies', 'Companies')}</span>
                            </NavLink>
                        )}
                        {isPlatformAdmin && (
                            <NavLink to="/admin/feature-flags" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`} title={t('nav.featureFlags', 'Feature Flags')}>
                                <span className="sidebar-item-icon flex"><Flag size={16} /></span>
                                <span className="sidebar-item-text">{t('nav.featureFlags', 'Feature Flags')}</span>
                            </NavLink>
                        )}
                    </div>

                    <div className="sidebar-footer">
                        <div className="sidebar-footer-controls flex items-center gap-1 mb-3">
                            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7" aria-label={collapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}>
                                {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
                            </Button>
                            <div className="flex-1" />
                            {/* Notification bell */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowNotifications(v => !v)}
                                className="relative h-7 w-7"
                                aria-label={t('layout.notifications')}
                            >
                                <Bell size={16} />
                                {(unreadCount as number) > 0 && (
                                    <span className="absolute -top-0.5 -right-1 min-w-[16px] h-4 rounded-full px-1 box-border bg-error text-white text-[10px] font-semibold flex items-center justify-center leading-none">
                                        {(unreadCount as number) > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-7 w-7" aria-label={t('layout.toggleTheme', 'Toggle theme')}>
                                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={toggleLang} className="h-7 gap-1 text-xs" aria-label={t('layout.toggleLanguage', 'Toggle language')}>
                                <Globe size={14} />
                                <span>{i18n.language === 'zh' ? '中' : 'EN'}</span>
                            </Button>
                        </div>

                        {/* Tenant switcher */}
                        {isPlatformAdmin && tenants.length > 1 && !collapsed && (
                            <select
                                value={currentTenant}
                                onChange={e => switchTenant(e.target.value)}
                                aria-label={t('layout.switchTenant', 'Switch company')}
                                className="w-full rounded-md border border-edge-subtle bg-surface-tertiary text-content-primary text-xs cursor-pointer px-2 py-1.5 mb-2"
                            >
                                {tenants.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        )}

                        {/* User info */}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer rounded-md p-1.5 transition-colors hover:bg-surface-tertiary bg-transparent border-none text-left"
                                onClick={() => setShowAccountSettings(true)}
                                title={t('account.title')}
                                aria-label={t('account.title')}
                            >
                                <div className="w-7 h-7 rounded-md bg-surface-tertiary border border-edge-subtle flex items-center justify-center text-content-tertiary shrink-0">
                                    <User size={14} />
                                </div>
                                <div className="sidebar-footer-user-info flex-1 min-w-0">
                                    <div className="text-[13px] font-medium truncate">{user?.display_name}</div>
                                    <div className="text-[11px] text-content-tertiary">{roleLabel}</div>
                                </div>
                            </button>
                            <Button variant="ghost" size="icon" onClick={handleLogout} className="h-7 w-7 text-content-tertiary shrink-0" aria-label={t('layout.logout', 'Logout')}>
                                <LogOut size={14} />
                            </Button>
                        </div>

                        {/* Version */}
                        <div className="text-center text-[10px] text-content-tertiary/60 mt-2 tracking-wide">
                            v{versionMain}
                            <span className="opacity-60">{versionBuild}</span>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Notification Tray */}
            <NotificationTray
                open={showNotifications}
                onClose={() => setShowNotifications(false)}
            />

            {/* Main Content */}
            <main id="main-content" className="main-content">
                <Outlet />
            </main>

            {/* Account Settings Modal */}
            <AccountMenu
                open={showAccountSettings}
                onClose={() => setShowAccountSettings(false)}
            />
        </div>
    );
}
