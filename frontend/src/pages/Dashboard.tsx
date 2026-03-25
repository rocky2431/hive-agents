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

/* ── Stats Bar ── */

function StatsBar({ agents, allTasks }: { agents: Agent[]; allTasks: Task[] }) {
    const { t } = useTranslation();
    const activeAgents = agents.filter(a => a.status === 'running' || a.status === 'idle').length;
    const pendingTasks = allTasks.filter(tk => tk.status === 'pending' || tk.status === 'doing').length;
    const completedToday = allTasks.filter(tk => {
        if (tk.status !== 'done' || !tk.completed_at) return false;
        return new Date(tk.completed_at).toDateString() === new Date().toDateString();
    }).length;
    const totalTokensToday = agents.reduce((sum, a) => sum + (a.tokens_used_today || 0), 0);
    const recentlyActive = agents.filter(a => a.last_active_at && Date.now() - new Date(a.last_active_at).getTime() < 3600000).length;

    const stats = [
        { label: t('dashboard.stats.agents'), value: agents.length, sub: t('dashboard.stats.online', { count: activeAgents }) },
        { label: t('dashboard.stats.activeTasks'), value: pendingTasks, sub: t('dashboard.stats.completedToday', { count: completedToday }) },
        { label: t('dashboard.stats.todayTokens'), value: formatTokens(totalTokensToday), sub: t('dashboard.stats.allAgentsTotal') },
        { label: t('dashboard.stats.recentlyActive'), value: recentlyActive, sub: t('dashboard.stats.lastHour') },
    ];

    return (
        <div className="mb-6 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-edge-subtle bg-edge-subtle">
            {stats.map((s, i) => (
                <div key={i} className="flex flex-col gap-0.5 bg-surface-secondary px-5 py-4">
                    <span className="text-xs text-content-tertiary">{s.label}</span>
                    <span className="text-2xl font-semibold tracking-tight text-content-primary tabular-nums">{s.value}</span>
                    <span className="text-[11px] text-content-tertiary">{s.sub}</span>
                </div>
            ))}
        </div>
    );
}

/* ── Agent Row ── */

function AgentRow({ agent, tasks, recentActivity }: { agent: Agent; tasks: Task[]; recentActivity: any[] }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const pendingTasks = tasks.filter(tk => tk.status === 'pending' || tk.status === 'doing');
    const latestActivity = recentActivity[0];

    return (
        <button
            onClick={() => navigate(`/agents/${agent.id}`)}
            className="grid w-full cursor-pointer grid-cols-[220px_1fr_150px_100px] items-center gap-4 rounded-md px-4 py-3 text-left transition-colors hover:bg-surface-hover"
        >
            <div className="flex min-w-0 items-center gap-2.5">
                <AgentAvatar name={agent.name} avatarUrl={agent.avatar_url} status={agent.status} size="md" showStatusDot />
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                        {agent.name}
                        <AgentStatusBadge status={agent.status} isExpired={agent.is_expired} />
                    </div>
                    <div className="truncate text-xs text-content-tertiary">{agent.role_description || '-'}</div>
                </div>
            </div>

            <div className="min-w-0">
                {latestActivity ? (
                    <div className="truncate text-xs text-content-secondary">
                        <span className="mr-1.5 text-content-tertiary">{formatRelative(latestActivity.created_at)}</span>
                        {latestActivity.summary}
                    </div>
                ) : (
                    <span className="text-xs text-content-tertiary">{t('dashboard.noActivity')}</span>
                )}
                {pendingTasks.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {pendingTasks.slice(0, 3).map(tk => (
                            <span key={tk.id} className="inline-flex max-w-[140px] items-center gap-1 truncate rounded bg-surface-tertiary px-1.5 py-px text-[11px] text-content-secondary">
                                {tk.title}
                            </span>
                        ))}
                        {pendingTasks.length > 3 && <span className="text-[11px] text-content-tertiary px-1">+{pendingTasks.length - 3}</span>}
                    </div>
                )}
            </div>

            <TokenUsageBar used={agent.tokens_used_today} max={agent.max_tokens_per_day ?? undefined} label="" variant="compact" />

            <div className="text-right text-xs text-content-tertiary tabular-nums">
                {formatRelative(agent.last_active_at)}
            </div>
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
            } catch {}

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
            } catch {}
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

    const hour = new Date().getHours();
    const greetingIcon = hour < 6 ? '\uD83C\uDF19' : hour < 12 ? '\u2600\uFE0F' : hour < 18 ? '\uD83C\uDF24\uFE0F' : '\uD83C\uDF19';
    const greetingText = hour < 6 ? t('dashboard.greeting.lateNight') : hour < 12 ? t('dashboard.greeting.morning') : hour < 18 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening');

    return (
        <div>
            {/* Header */}
            <div className="mb-7 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight"><span aria-hidden="true">{greetingIcon} </span>{greetingText}</h1>
                    <p className="text-sm text-content-tertiary">{t('dashboard.totalAgents', { count: agents.length })}</p>
                </div>
                <Button onClick={() => navigate('/agents/new')}>
                    + {t('nav.newAgent')}
                </Button>
            </div>

            {isLoading ? (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
                    </div>
                    <Skeleton className="h-64 rounded-lg" />
                </div>
            ) : agents.length === 0 ? (
                <EmptyState
                    icon="🤖"
                    title={t('dashboard.noAgents')}
                    action={{ label: '+ ' + t('nav.newAgent'), onClick: () => navigate('/agents/new') }}
                />
            ) : (
                <>
                    <StatsBar agents={agents} allTasks={allTasks} />

                    {/* Agent List */}
                    <Card className="mb-8 overflow-hidden">
                        <div className="grid grid-cols-[220px_1fr_150px_100px] border-b border-edge-subtle px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
                            <span>{t('dashboard.table.agent')}</span>
                            <span>{t('dashboard.table.latestActivity')}</span>
                            <span>{t('dashboard.table.token')}</span>
                            <span className="text-right">{t('dashboard.table.active')}</span>
                        </div>
                        <div className="max-h-[350px] overflow-y-auto">
                            {agents
                                .sort((a, b) => {
                                    const aActive = a.status === 'running' || a.status === 'idle' ? 1 : 0;
                                    const bActive = b.status === 'running' || b.status === 'idle' ? 1 : 0;
                                    if (aActive !== bActive) return bActive - aActive;
                                    const aTime = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
                                    const bTime = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
                                    return bTime - aTime;
                                })
                                .map(agent => (
                                    <AgentRow
                                        key={agent.id}
                                        agent={agent}
                                        tasks={tasksByAgent.get(agent.id) || []}
                                        recentActivity={agentActivities[agent.id] || []}
                                    />
                                ))}
                        </div>
                    </Card>

                    {/* Activity Feed */}
                    <Card className="overflow-hidden">
                        <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-3">
                            <h3 className="flex items-center gap-1.5 text-sm font-medium text-content-secondary">
                                {t('dashboard.globalActivity')}
                            </h3>
                            <span className="text-[11px] text-content-tertiary">{t('dashboard.recentCount', { count: 20 })}</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto p-1">
                            <ActivityFeed activities={allActivities} agents={agents} />
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}
