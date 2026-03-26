import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { agentApi, taskApi, activityApi } from '../services/api';
import type { Agent, Task } from '../types';
import { formatTokens } from '@/lib/format';
import { formatRelative } from '@/lib/date';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import { AgentStatusBadge } from '@/components/domain/agent-status-badge';
import { TokenUsageBar } from '@/components/domain/token-usage-bar';
import { EmptyState } from '@/components/domain/empty-state';
import { motion } from 'framer-motion';
import {
    Plus,
    Bot,
    ListTodo,
    Zap,
    Clock,
    MessageSquare,
    ArrowRight,
} from 'lucide-react';

const MotionCard = motion.create('div');

/* ── Bento Stat Card ── */

function BentoStat({ label, value, sub, icon, className = '', index = 0 }: {
    label: string;
    value: string | number;
    sub: string;
    icon: React.ReactNode;
    className?: string;
    index?: number;
}) {
    return (
        <MotionCard
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className={`flex flex-col justify-between rounded-xl border border-edge-subtle bg-surface-secondary p-5 ${className}`}
        >
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-content-tertiary uppercase tracking-wider">{label}</span>
                <span className="text-content-tertiary">{icon}</span>
            </div>
            <div className="mt-3">
                <span className="text-3xl font-semibold tracking-tighter text-content-primary tabular-nums">{value}</span>
                <div className="mt-1 text-[12px] text-content-tertiary">{sub}</div>
            </div>
        </MotionCard>
    );
}

/* ── Agent Card ── */

function AgentCard({ agent, tasks, latestActivity }: {
    agent: Agent;
    tasks: Task[];
    latestActivity?: { summary: string; created_at: string };
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const pendingTasks = tasks.filter(tk => tk.status === 'pending' || tk.status === 'doing');

    return (
        <button
            onClick={() => navigate(`/agents/${agent.id}`)}
            className="group flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-secondary p-4 text-left transition-all hover:bg-surface-hover hover:border-edge-default active:scale-[0.98]"
        >
            <div className="flex items-center gap-3">
                <AgentAvatar name={agent.name} avatarUrl={agent.avatar_url} status={agent.status} size="md" showStatusDot />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-content-primary truncate">{agent.name}</span>
                        <AgentStatusBadge status={agent.status} isExpired={agent.is_expired} />
                    </div>
                    <div className="truncate text-xs text-content-tertiary">{agent.role_description || '-'}</div>
                </div>
            </div>

            <TokenUsageBar used={agent.tokens_used_today} max={agent.max_tokens_per_day ?? undefined} label="" variant="compact" />

            {latestActivity ? (
                <div className="truncate text-[12px] text-content-secondary">
                    <span className="text-content-tertiary">{formatRelative(latestActivity.created_at)}</span>
                    {' '}{latestActivity.summary}
                </div>
            ) : (
                <div className="text-[12px] text-content-tertiary">{t('dashboard.noActivity')}</div>
            )}

            {pendingTasks.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {pendingTasks.slice(0, 2).map(tk => (
                        <span key={tk.id} className="inline-flex max-w-[120px] truncate rounded bg-surface-tertiary px-1.5 py-px text-[11px] text-content-secondary">
                            {tk.title}
                        </span>
                    ))}
                    {pendingTasks.length > 2 && <span className="text-[11px] text-content-tertiary px-1">+{pendingTasks.length - 2}</span>}
                </div>
            )}
        </button>
    );
}

/* ── Activity Feed ── */

function ActivityFeed({ activities, agents }: { activities: any[]; agents: Agent[] }) {
    const { t } = useTranslation();
    const agentMap = new Map(agents.map(a => [a.id, a]));

    if (activities.length === 0) {
        return <EmptyState title={t('dashboard.noActivity')} />;
    }

    return (
        <div className="flex flex-col">
            {activities.map((act, i) => {
                const agent = agentMap.get(act.agent_id);
                return (
                    <div key={act.id || i} className="flex items-start gap-3 px-3 py-1.5 text-sm">
                        <span className="min-w-[52px] shrink-0 pt-0.5 font-mono text-[11px] text-content-tertiary tabular-nums">
                            {formatRelative(act.created_at)}
                        </span>
                        <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-px text-[11px] font-medium text-content-secondary">
                            {agent?.name || act.agent_id?.slice(0, 6)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-content-secondary">
                            {act.summary}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

/* ── Main Dashboard ── */

export default function Dashboard() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const currentTenant = localStorage.getItem('current_tenant_id') || '';

    const { data: agents = [], isLoading } = useQuery({
        queryKey: ['agents', currentTenant],
        queryFn: () => agentApi.list(currentTenant || undefined),
        refetchInterval: 15000,
    });

    const [allTasks, setAllTasks] = useState<Task[]>([]);
    const [allActivities, setAllActivities] = useState<any[]>([]);
    const [agentActivities, setAgentActivities] = useState<Record<string, any[]>>({});

    useEffect(() => {
        if (agents.length === 0) return;
        const fetchData = async () => {
            try {
                const taskResults = await Promise.allSettled(agents.map(a => taskApi.list(a.id)));
                const tasks: Task[] = [];
                taskResults.forEach(r => { if (r.status === 'fulfilled') tasks.push(...r.value); });
                setAllTasks(tasks);
            } catch (err) { if (import.meta.env.DEV) console.warn('[Dashboard] fetch error:', err); }

            try {
                const actResults = await Promise.allSettled(agents.map(a => activityApi.list(a.id, 5)));
                const activities: any[] = [];
                const perAgent: Record<string, any[]> = {};
                actResults.forEach((r, i) => {
                    if (r.status === 'fulfilled') {
                        perAgent[agents[i].id] = r.value;
                        activities.push(...r.value.map((v: any) => ({ ...v, agent_id: agents[i].id })));
                    }
                });
                activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                setAllActivities(activities.slice(0, 20));
                setAgentActivities(perAgent);
            } catch (err) { if (import.meta.env.DEV) console.warn('[Dashboard] fetch error:', err); }
        };
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [agents.map(a => a.id).join(',')]);

    const tasksByAgent = new Map<string, Task[]>();
    allTasks.forEach(tk => {
        if (!tasksByAgent.has(tk.agent_id)) tasksByAgent.set(tk.agent_id, []);
        tasksByAgent.get(tk.agent_id)!.push(tk);
    });

    // Computed stats
    const activeAgents = agents.filter(a => a.status === 'running' || a.status === 'idle').length;
    const pendingTasks = allTasks.filter(tk => tk.status === 'pending' || tk.status === 'doing').length;
    const completedToday = allTasks.filter(tk => {
        if (tk.status !== 'done' || !tk.completed_at) return false;
        return new Date(tk.completed_at).toDateString() === new Date().toDateString();
    }).length;
    const totalTokensToday = agents.reduce((sum, a) => sum + (a.tokens_used_today || 0), 0);
    const recentlyActive = agents.filter(a => a.last_active_at && Date.now() - new Date(a.last_active_at).getTime() < 3600000).length;

    // Greeting
    const hour = new Date().getHours();
    const greetingText = hour < 6 ? t('dashboard.greeting.lateNight') : hour < 12 ? t('dashboard.greeting.morning') : hour < 18 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening');

    // Sort agents: active first, then by last active time
    const sortedAgents = [...agents].sort((a, b) => {
        const aActive = a.status === 'running' || a.status === 'idle' ? 1 : 0;
        const bActive = b.status === 'running' || b.status === 'idle' ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        const aTime = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const bTime = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        return bTime - aTime;
    });

    return (
        <div className="max-w-[1200px]">
            {/* Header + Quick Actions */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tighter">{greetingText}</h1>
                    <p className="text-sm text-content-tertiary">{t('dashboard.totalAgents', { count: agents.length })}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/plaza')} className="gap-1.5 text-xs">
                        <MessageSquare size={14} />
                        {t('nav.plaza', 'Plaza')}
                    </Button>
                    <Button onClick={() => navigate('/agents/new')} className="gap-1.5">
                        <Plus size={14} />
                        {t('nav.newAgent')}
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-[160px] rounded-xl" />)}
                    </div>
                </div>
            ) : agents.length === 0 ? (
                <EmptyState
                    title={t('dashboard.noAgents')}
                    action={{ label: t('nav.newAgent'), onClick: () => navigate('/agents/new') }}
                />
            ) : (
                <>
                    {/* Bento Stats Grid */}
                    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                        <BentoStat
                            label={t('dashboard.stats.agents')}
                            value={agents.length}
                            sub={t('dashboard.stats.online', { count: activeAgents })}
                            icon={<Bot size={16} />}
                            index={0}
                        />
                        <BentoStat
                            label={t('dashboard.stats.activeTasks')}
                            value={pendingTasks}
                            sub={t('dashboard.stats.completedToday', { count: completedToday })}
                            icon={<ListTodo size={16} />}
                            index={1}
                        />
                        <BentoStat
                            label={t('dashboard.stats.todayTokens')}
                            value={formatTokens(totalTokensToday)}
                            sub={t('dashboard.stats.allAgentsTotal')}
                            icon={<Zap size={16} />}
                            index={2}
                        />
                        <BentoStat
                            label={t('dashboard.stats.recentlyActive')}
                            value={recentlyActive}
                            sub={t('dashboard.stats.lastHour')}
                            icon={<Clock size={16} />}
                            index={3}
                        />
                    </div>

                    {/* Agent Cards + Activity Feed — Two-column layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
                        {/* Agent Cards */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-medium text-content-secondary">{t('nav.myAgents')}</h2>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs text-content-tertiary" onClick={() => navigate('/plaza')}>
                                    {t('dashboard.viewAll', 'View all')}
                                    <ArrowRight size={12} />
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {sortedAgents.map((agent, i) => (
                                    <MotionCard
                                        key={agent.id}
                                        initial={{ opacity: 0, y: 16 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: 0.15 + i * 0.04 }}
                                    >
                                        <AgentCard
                                            agent={agent}
                                            tasks={tasksByAgent.get(agent.id) || []}
                                            latestActivity={agentActivities[agent.id]?.[0]}
                                        />
                                    </MotionCard>
                                ))}
                            </div>
                        </div>

                        {/* Activity Feed */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-medium text-content-secondary">{t('dashboard.globalActivity')}</h2>
                                <span className="text-[11px] text-content-tertiary">{t('dashboard.recentCount', { count: 20 })}</span>
                            </div>
                            <Card className="overflow-hidden">
                                <div className="max-h-[600px] overflow-y-auto p-1">
                                    <ActivityFeed activities={allActivities} agents={agents} />
                                </div>
                            </Card>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
