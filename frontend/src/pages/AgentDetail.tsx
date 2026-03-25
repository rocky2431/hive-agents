import React, { useState, Component, ErrorInfo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';

import { agentApi } from '../services/api';
import {
    OverviewTab,
    SkillsTab,
    ChatTab,
    ActivityTab,
    SettingsTab,
} from './agent-detail';
import { useAuthStore } from '../stores';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TABS = ['chat', 'overview', 'skills', 'activity', 'settings'] as const;

function AgentDetailInner() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const queryClient = useQueryClient();
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';

    const [activeTab, setActiveTab] = useQueryState(
        'tab',
        parseAsStringLiteral(TABS).withDefault('chat'),
    );

    const { data: agent, isLoading } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentApi.get(id!),
        enabled: !!id,
    });

    /* ── Inline name / role editing ── */
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [editingRole, setEditingRole] = useState(false);
    const [roleInput, setRoleInput] = useState('');

    /* ── Expiry editor ── */
    const [showExpiryModal, setShowExpiryModal] = useState(false);
    const [expiryValue, setExpiryValue] = useState('');
    const [expirySaving, setExpirySaving] = useState(false);

    const openExpiryModal = () => {
        const cur = (agent as any)?.expires_at;
        setExpiryValue(cur ? new Date(cur).toISOString().slice(0, 16) : '');
        setShowExpiryModal(true);
    };
    const addHours = (h: number) => {
        const base = (agent as any)?.expires_at ? new Date((agent as any).expires_at) : new Date();
        setExpiryValue(new Date(base.getTime() + h * 3600_000).toISOString().slice(0, 16));
    };
    const saveExpiry = async (permanent = false) => {
        setExpirySaving(true);
        try {
            const body = permanent
                ? { expires_at: null }
                : { expires_at: expiryValue ? new Date(expiryValue).toISOString() : null };
            await agentApi.update(id!, body as any);
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
            setShowExpiryModal(false);
        } catch (e) {
            alert('Failed: ' + e);
        }
        setExpirySaving(false);
    };

    if (isLoading || !agent) {
        return <div className="p-10 text-content-tertiary">{t('common.loading')}</div>;
    }

    const computeStatusKey = () => {
        if (agent.status === 'error') return 'error';
        if (agent.status === 'creating') return 'creating';
        if (agent.status === 'stopped') return 'stopped';
        if ((agent as any).agent_type === 'openclaw' && agent.status === 'running' && (agent as any).openclaw_last_seen) {
            const elapsed = Date.now() - new Date((agent as any).openclaw_last_seen).getTime();
            if (elapsed > 60 * 60 * 1000) return 'disconnected';
        }
        return agent.status === 'running' ? 'running' : 'idle';
    };
    const statusKey = computeStatusKey();
    const canManage = (agent as any).access_level === 'manage' || isAdmin;

    return (
        <>
            <div>
                {/* ── Header ── */}
                <div className="page-header">
                    <div className="flex items-center gap-4">
                        <AgentAvatar
                            name={agent.name}
                            avatarUrl={(agent as any).avatar_url}
                            status={agent.status as any}
                            size="lg"
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                            {canManage && editingName ? (
                                <input
                                    className="page-title block rounded-md border border-accent-primary bg-surface-elevated px-2.5 py-1 text-content-primary outline-none"
                                    autoFocus
                                    value={nameInput}
                                    onChange={(e) => setNameInput(e.target.value)}
                                    onBlur={async () => {
                                        setEditingName(false);
                                        if (nameInput.trim() && nameInput !== agent.name) {
                                            await agentApi.update(id!, { name: nameInput.trim() } as any);
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                        } else {
                                            setNameInput(agent.name);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') { setEditingName(false); setNameInput(agent.name); }
                                    }}
                                />
                            ) : (
                                <h1
                                    className="page-title mb-0 inline-block"
                                    title={canManage ? 'Click to edit name' : undefined}
                                    onClick={() => {
                                        if (canManage) { setNameInput(agent.name); setEditingName(true); }
                                    }}
                                >
                                    {agent.name}
                                </h1>
                            )}

                            <p className="page-subtitle mt-1 flex flex-wrap items-center gap-2">
                                <span className={`status-dot ${statusKey}`} />
                                {t(`agent.status.${statusKey}`)}

                                {canManage && editingRole ? (
                                    <textarea
                                        autoFocus
                                        rows={2}
                                        className="w-[min(500px,50vw)] resize-y rounded-md border border-accent-primary bg-surface-elevated px-2.5 py-1.5 font-sans text-xs leading-relaxed text-content-primary outline-none"
                                        value={roleInput}
                                        onChange={(e) => setRoleInput(e.target.value)}
                                        onBlur={async () => {
                                            setEditingRole(false);
                                            if (roleInput !== agent.role_description) {
                                                await agentApi.update(id!, { role_description: roleInput } as any);
                                                queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                                            if (e.key === 'Escape') { setEditingRole(false); setRoleInput(agent.role_description || ''); }
                                        }}
                                    />
                                ) : (
                                    <span
                                        className="inline-block max-w-[38vw] truncate align-middle"
                                        title={canManage ? (agent.role_description || 'Click to edit') : (agent.role_description || '')}
                                        onClick={() => {
                                            if (canManage) { setRoleInput(agent.role_description || ''); setEditingRole(true); }
                                        }}
                                    >
                                        {agent.role_description
                                            ? `· ${agent.role_description}`
                                            : canManage
                                                ? <span className="text-xs text-content-tertiary">· {t('agent.fields.role', 'Click to add a description...')}</span>
                                                : null}
                                    </span>
                                )}

                                {(agent as any).is_expired && <Badge variant="error">Expired</Badge>}

                                {(agent as any).agent_type === 'openclaw' && (
                                    <span className="rounded bg-gradient-to-br from-indigo-500 to-purple-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                                        OpenClaw · Lab
                                    </span>
                                )}

                                {!(agent as any).is_expired && (agent as any).expires_at && (
                                    <span className="text-[11px] text-content-tertiary">
                                        Expires: {new Date((agent as any).expires_at).toLocaleString()}
                                    </span>
                                )}

                                {isAdmin && (
                                    <button
                                        onClick={openExpiryModal}
                                        aria-label={t('agent.settings.expiry.setExpiry')}
                                        className="rounded bg-transparent px-1 py-px text-[11px] text-content-tertiary hover:bg-surface-secondary"
                                    >
                                        ✏️ {t((agent as any).expires_at || (agent as any).is_expired ? 'agent.settings.expiry.renew' : 'agent.settings.expiry.setExpiry')}
                                    </button>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button onClick={() => setActiveTab('chat')}>{t('agent.actions.chat')}</Button>
                        {(agent as any)?.agent_type !== 'openclaw' && (
                            <>
                                {agent.status === 'stopped' ? (
                                    <Button variant="secondary" onClick={async () => { await agentApi.start(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>
                                        {t('agent.actions.start')}
                                    </Button>
                                ) : agent.status === 'running' ? (
                                    <Button variant="secondary" onClick={async () => { await agentApi.stop(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>
                                        {t('agent.actions.stop')}
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {/* ── Tab bar ── */}
                <div className="tabs">
                    {TABS.filter((tab) => {
                        if ((agent as any)?.access_level === 'use' && tab === 'settings') return false;
                        if ((agent as any)?.agent_type === 'openclaw') {
                            return ['chat', 'overview', 'activity', 'settings'].includes(tab);
                        }
                        return true;
                    }).map((tab) => (
                        <div
                            key={tab}
                            className={`tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {t(`agent.tabs.${tab}`)}
                        </div>
                    ))}
                </div>

                {/* ── Tab content ── */}
                {activeTab === 'overview' && <OverviewTab agentId={id!} agent={agent} />}
                {activeTab === 'skills' && <SkillsTab agentId={id!} canManage={canManage} />}
                {activeTab === 'chat' && <ChatTab agentId={id!} agent={agent} canManage={canManage} />}
                {activeTab === 'activity' && <ActivityTab agentId={id!} agent={agent} canManage={canManage} />}
                {activeTab === 'settings' && <SettingsTab agentId={id!} agent={agent} canManage={canManage} />}
            </div>

            {/* ── Expiry Modal ── */}
            {showExpiryModal && (
                <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowExpiryModal(false); }}
                >
                    <div
                        className="w-96 max-w-[90vw] rounded-xl border border-edge-subtle bg-surface-primary p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h4 className="mb-3 text-[15px] font-semibold">
                            {t('agent.settings.expiry.title', 'Set Expiry Time')}
                        </h4>
                        <input
                            type="datetime-local"
                            className="input mb-3 w-full"
                            value={expiryValue}
                            onChange={(e) => setExpiryValue(e.target.value)}
                        />
                        <div className="mb-4 flex flex-wrap gap-2">
                            {[1, 6, 24, 72, 168].map((h) => (
                                <Button key={h} variant="secondary" size="sm" onClick={() => addHours(h)}>
                                    +{h < 24 ? `${h}h` : `${h / 24}d`}
                                </Button>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => saveExpiry(true)} disabled={expirySaving}>
                                {t('agent.settings.expiry.permanent', 'Permanent')}
                            </Button>
                            <Button onClick={() => saveExpiry(false)} disabled={!expiryValue || expirySaving} loading={expirySaving}>
                                {t('common.confirm')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

/* ── Error boundary ── */
class AgentDetailErrorBoundary extends Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('AgentDetail crash caught by error boundary:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                    <div className="text-xl font-semibold text-content-primary">Something went wrong</div>
                    <div className="max-w-md text-center text-sm text-content-tertiary">
                        {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
                    </div>
                    <Button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
                        Reload Page
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function AgentDetailWithErrorBoundary() {
    return (
        <AgentDetailErrorBoundary>
            <AgentDetailInner />
        </AgentDetailErrorBoundary>
    );
}
