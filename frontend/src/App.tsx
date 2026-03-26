import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from './services/api';

const Login = lazy(() => import('./pages/Login'));
const CompanySetup = lazy(() => import('./pages/CompanySetup'));
const Layout = lazy(() => import('./pages/Layout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Plaza = lazy(() => import('./pages/Plaza'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const AgentCreate = lazy(() => import('./pages/AgentCreate'));
const Chat = lazy(() => import('./pages/Chat'));
const Messages = lazy(() => import('./pages/Messages'));
const EnterpriseSettings = lazy(() => import('./pages/EnterpriseSettings'));
const InvitationCodes = lazy(() => import('./pages/InvitationCodes'));
const AdminCompanies = lazy(() => import('./pages/AdminCompanies'));
const NotificationCenter = lazy(() => import('./pages/NotificationCenter'));
const FeatureFlagsPage = lazy(() => import('./pages/FeatureFlagsPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const token = useAuthStore((s) => s.token);
    const user = useAuthStore((s) => s.user);
    if (!token) return <Navigate to="/login" replace />;
    // Force company setup for users without a tenant
    if (user && !user.tenant_id) return <Navigate to="/setup-company" replace />;
    return <>{children}</>;
}

function RoleRoute({
    children,
    allowedRoles,
}: {
    children: React.ReactNode;
    allowedRoles: string[];
}) {
    const user = useAuthStore((s) => s.user);
    if (!user || !allowedRoles.includes(user.role)) {
        return <Navigate to="/plaza" replace />;
    }
    return <>{children}</>;
}

/* ─── Notification Bar ─── */
function NotificationBar() {
    const [config, setConfig] = useState<{ enabled: boolean; text: string } | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        fetch('/api/v1/enterprise/system-settings/notification_bar/public')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setConfig(d); })
            .catch(() => { /* non-critical: notification bar hidden if endpoint unavailable */ });
    }, []);

    // Check sessionStorage for dismissal (keyed by text so new messages re-show)
    useEffect(() => {
        if (config?.text) {
            const key = `notification_bar_dismissed_${btoa(encodeURIComponent(config.text))}`;
            if (sessionStorage.getItem(key)) setDismissed(true);
        }
    }, [config?.text]);

    // Manage body class: add when visible, remove when hidden or dismissed
    const isVisible = !!config?.enabled && !!config?.text && !dismissed;
    useEffect(() => {
        if (isVisible) {
            document.body.classList.add('has-notification-bar');
        } else {
            document.body.classList.remove('has-notification-bar');
        }
        return () => { document.body.classList.remove('has-notification-bar'); };
    }, [isVisible]);

    if (!isVisible) return null;

    const handleDismiss = () => {
        const key = `notification_bar_dismissed_${btoa(encodeURIComponent(config!.text))}`;
        sessionStorage.setItem(key, '1');
        setDismissed(true);
    };

    return (
        <div className="notification-bar">
            <span className="notification-bar-text">{config!.text}</span>
            <button className="notification-bar-close" onClick={handleDismiss} aria-label="Close">✕</button>
        </div>
    );
}

export default function App() {
    const { token, setAuth, user } = useAuthStore();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Initialize theme on app mount (ensures login page gets correct theme)
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        if (token && !user) {
            authApi.me()
                .then((u) => setAuth(u, token))
                .catch(() => useAuthStore.getState().logout())
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);


    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center text-content-tertiary">
                加载中...
            </div>
        );
    }

    const routeFallback = (
        <div className="flex h-screen items-center justify-center text-content-tertiary">
            加载中...
        </div>
    );

    return (
        <Suspense fallback={routeFallback}>
            <a href="#main-content" className="skip-to-content">
                {t('a11y.skipToContent', 'Skip to main content')}
            </a>
            <NotificationBar />
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/setup-company" element={<CompanySetup />} />
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                    <Route index element={<Navigate to="/home" replace />} />
                    {/* Primary routes */}
                    <Route path="home" element={<Dashboard />} />
                    <Route path="plaza" element={<Plaza />} />
                    <Route path="agents/new" element={<AgentCreate />} />
                    <Route path="agents/:id" element={<AgentDetail />} />
                    <Route path="agents/:id/chat" element={<Chat />} />
                    <Route path="messages" element={<Messages />} />
                    <Route path="notifications" element={<NotificationCenter />} />
                    {/* Workspace (enterprise management) */}
                    <Route
                        path="workspace"
                        element={<RoleRoute allowedRoles={['platform_admin', 'org_admin']}><EnterpriseSettings /></RoleRoute>}
                    />
                    <Route
                        path="invitations"
                        element={<RoleRoute allowedRoles={['platform_admin', 'org_admin']}><InvitationCodes /></RoleRoute>}
                    />
                    {/* Admin routes */}
                    <Route
                        path="admin/companies"
                        element={<RoleRoute allowedRoles={['platform_admin']}><AdminCompanies /></RoleRoute>}
                    />
                    <Route
                        path="admin/feature-flags"
                        element={<RoleRoute allowedRoles={['platform_admin']}><FeatureFlagsPage /></RoleRoute>}
                    />
                    {/* Backward-compat redirects */}
                    <Route path="dashboard" element={<Navigate to="/home" replace />} />
                    <Route path="enterprise" element={<Navigate to="/workspace" replace />} />
                </Route>
            </Routes>
        </Suspense>
    );
}
