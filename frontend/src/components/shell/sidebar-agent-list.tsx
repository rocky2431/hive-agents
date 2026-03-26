import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, X, Pin } from 'lucide-react';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import type { Agent } from '@/types';

interface SidebarAgentListProps {
    agents: Agent[];
    userId?: string;
    collapsed: boolean;
}

function getAgentBadgeStatus(agent: Agent): string | null {
    if (agent.status === 'error') return 'error';
    if (agent.status === 'creating') return 'creating';
    if (agent.agent_type === 'openclaw' && agent.status === 'running' && agent.openclaw_last_seen) {
        const elapsed = Date.now() - new Date(agent.openclaw_last_seen).getTime();
        if (elapsed > 60 * 60 * 1000) return 'disconnected';
    }
    return null;
}

export function SidebarAgentList({ agents, userId, collapsed }: SidebarAgentListProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
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

    const q = search.trim().toLowerCase();
    const filtered = agents
        .filter(a => !q || (a.name || '').toLowerCase().includes(q) || (a.role_description || '').toLowerCase().includes(q))
        .sort((a, b) => {
            const ap = pinnedAgents.has(a.id) ? 1 : 0;
            const bp = pinnedAgents.has(b.id) ? 1 : 0;
            if (ap !== bp) return bp - ap;
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bTime - aTime;
        });

    return (
        <>
            {/* Search */}
            {!collapsed && agents.length >= 5 && (
                <div className="relative px-3 py-1">
                    <Search size={12} className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none text-content-tertiary" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('layout.search')}
                        aria-label={t('layout.search')}
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full rounded-md border border-edge-subtle bg-surface-secondary text-content-primary text-xs outline-none box-border py-[5px] pr-6 pl-7 focus:border-accent-primary"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-[18px] top-1/2 -translate-y-1/2 bg-transparent border-none text-content-tertiary cursor-pointer p-0.5"
                            aria-label={t('layout.clearSearch', 'Clear search')}
                        >
                            <X size={10} />
                        </button>
                    )}
                </div>
            )}

            {/* Agent list */}
            {filtered.map(agent => {
                const badge = getAgentBadgeStatus(agent);
                const isOwned = agent.creator_id === userId;
                return (
                    <div key={agent.id} className={`relative sidebar-agent-item${isOwned ? ' owned' : ''}`}>
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
                        {!collapsed && (
                            <button
                                onClick={e => { e.preventDefault(); e.stopPropagation(); togglePin(agent.id); }}
                                className={`sidebar-pin-btn ${pinnedAgents.has(agent.id) ? 'pinned' : ''}`}
                                title={pinnedAgents.has(agent.id) ? t('layout.unpin') : t('layout.pin')}
                                aria-label={pinnedAgents.has(agent.id) ? t('layout.unpin') : t('layout.pin')}
                            >
                                <Pin size={10} fill={pinnedAgents.has(agent.id) ? 'currentColor' : 'none'} />
                            </button>
                        )}
                    </div>
                );
            })}

            {/* Empty states */}
            {agents.length === 0 && (
                <div className="sidebar-section">
                    <div className="sidebar-section-title">{t('nav.myAgents')}</div>
                </div>
            )}
            {agents.length > 0 && filtered.length === 0 && q && (
                <div className="px-4 py-3 text-xs text-content-tertiary text-center">
                    {t('layout.noMatches')}
                </div>
            )}
        </>
    );
}
