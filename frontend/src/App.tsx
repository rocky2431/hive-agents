/**
 * App root — route tree grouped by surface (public / app / workspace / admin).
 *
 * Single Layout shell shared across all authenticated surfaces.
 * Role guards enforce access per surface.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores';
import { useEffect, useState } from 'react';
import { authApi } from './api/domains/auth';
import { get } from './api/core';
import { ProtectedRoute, WorkspaceGuard, AdminGuard } from './guards';

import Login from './pages/Login';
import CompanySetup from './pages/CompanySetup';
import Layout from './pages/Layout';
import Dashboard from './pages/Dashboard';
import Plaza from './pages/Plaza';
import AgentDetail from './pages/AgentDetail';
import AgentCreate from './pages/AgentCreate';
import Chat from './pages/Chat';
import Messages from './pages/Messages';
import EnterpriseSettings from './pages/EnterpriseSettings';
import InvitationCodes from './pages/InvitationCodes';
import AdminCompanies from './pages/AdminCompanies';

/* ─── Notification Bar (public, no auth required) ─── */
function NotificationBar() {
    const [config, setConfig] = useState<{ enabled: boolean; text: string } | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        get<{ enabled: boolean; text: string }>('/enterprise/system-settings/notification_bar/public')
            .then(d => setConfig(d))
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (config?.text) {
            const key = `notification_bar_dismissed_${btoa(encodeURIComponent(config.text))}`;
            if (sessionStorage.getItem(key)) setDismissed(true);
        }
    }, [config?.text]);

    const isVisible = !!config?.enabled && !!config?.text && !dismissed;
    useEffect(() => {
        if (isVisible) document.body.classList.add('has-notification-bar');
        else document.body.classList.remove('has-notification-bar');
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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);

        if (token && !user) {
            authApi.getMe()
                .then((u) => setAuth(u, token))
                .catch(() => useAuthStore.getState().logout())
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-tertiary)' }}>
                加载中...
            </div>
        );
    }

    return (
        <>
            <NotificationBar />
            <Routes>
                {/* ─── Public surface ─── */}
                <Route path="/login" element={<Login />} />
                <Route path="/setup-company" element={<CompanySetup />} />

                {/* ─── Authenticated surfaces (shared Layout shell) ─── */}
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>

                    {/* App surface — all authenticated users */}
                    <Route index element={<Navigate to="/plaza" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="plaza" element={<Plaza />} />
                    <Route path="agents/new" element={<AgentCreate />} />
                    <Route path="agents/:id" element={<AgentDetail />} />
                    <Route path="agents/:id/chat" element={<Chat />} />
                    <Route path="messages" element={<Messages />} />

                    {/* Workspace surface — org_admin + platform_admin */}
                    <Route path="enterprise" element={<WorkspaceGuard><EnterpriseSettings /></WorkspaceGuard>} />
                    <Route path="invitations" element={<WorkspaceGuard><InvitationCodes /></WorkspaceGuard>} />

                    {/* Admin surface — platform_admin only */}
                    <Route path="admin/platform-settings" element={<AdminGuard><AdminCompanies /></AdminGuard>} />
                </Route>
            </Routes>
        </>
    );
}
