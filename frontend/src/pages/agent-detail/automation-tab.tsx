import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { scheduleApi, triggerApi, taskApi } from '@/services/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/domain/empty-state';
import { formatRelative } from '@/lib/date';
import type { AgentSchedule, AgentTrigger, Task } from '@/types';

interface AutomationTabProps {
    agentId: string;
    canManage: boolean;
}

export function AutomationTab({ agentId, canManage }: AutomationTabProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [activeSection, setActiveSection] = useState<'schedules' | 'triggers' | 'tasks'>('schedules');

    const { data: schedules = [] } = useQuery({
        queryKey: ['schedules', agentId],
        queryFn: () => scheduleApi.list(agentId),
    });

    const { data: triggers = [] } = useQuery({
        queryKey: ['triggers', agentId],
        queryFn: () => triggerApi.list(agentId),
    });

    const { data: tasks = [] } = useQuery({
        queryKey: ['tasks', agentId],
        queryFn: () => taskApi.list(agentId),
    });

    const toggleSchedule = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            scheduleApi.update(agentId, id, { is_enabled: enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', agentId] }),
        onError: (err: Error) => toast.error(err.message),
    });

    const triggerSchedule = useMutation({
        mutationFn: (id: string) => scheduleApi.trigger(agentId, id),
        onError: (err: Error) => toast.error(err.message),
    });

    const deleteSchedule = useMutation({
        mutationFn: (id: string) => scheduleApi.delete(agentId, id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', agentId] }),
        onError: (err: Error) => toast.error(err.message),
    });

    const toggleTrigger = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            triggerApi.update(agentId, id, { is_enabled: enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers', agentId] }),
        onError: (err: Error) => toast.error(err.message),
    });

    const deleteTrigger = useMutation({
        mutationFn: (id: string) => triggerApi.delete(agentId, id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers', agentId] }),
        onError: (err: Error) => toast.error(err.message),
    });

    const sections = [
        { key: 'schedules' as const, label: t('agent.automation.schedules', 'Schedules'), count: schedules.length },
        { key: 'triggers' as const, label: t('agent.automation.triggers', 'Triggers'), count: triggers.length },
        { key: 'tasks' as const, label: t('agent.automation.tasks', 'Tasks'), count: tasks.length },
    ];

    return (
        <div className="mt-4">
            {/* Section switcher */}
            <div className="flex items-center gap-1 mb-4 border-b border-edge-subtle">
                {sections.map(s => (
                    <button
                        key={s.key}
                        onClick={() => setActiveSection(s.key)}
                        className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
                            activeSection === s.key
                                ? 'border-accent-primary text-content-primary font-medium'
                                : 'border-transparent text-content-tertiary hover:text-content-secondary'
                        }`}
                    >
                        {s.label}
                        {s.count > 0 && <span className="ml-1.5 text-xs text-content-tertiary">({s.count})</span>}
                    </button>
                ))}
            </div>

            {/* Schedules */}
            {activeSection === 'schedules' && (
                <div className="flex flex-col gap-2">
                    {(schedules as AgentSchedule[]).length === 0 ? (
                        <EmptyState title={t('agent.automation.noSchedules', 'No scheduled tasks')} />
                    ) : (
                        (schedules as AgentSchedule[]).map(s => (
                            <Card key={s.id} className="flex items-center gap-3 px-4 py-3">
                                <Switch
                                    checked={s.is_enabled}
                                    onCheckedChange={(v: boolean) => toggleSchedule.mutate({ id: s.id, enabled: v })}
                                    disabled={!canManage}
                                    aria-label={t('common.toggle')}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{s.name}</div>
                                    <div className="text-xs text-content-tertiary truncate">
                                        <code className="text-[11px]">{s.cron_expr}</code>
                                        {s.last_run_at && <span className="ml-2">{t('agent.automation.lastRun', 'Last')}: {formatRelative(s.last_run_at)}</span>}
                                    </div>
                                </div>
                                <span className="text-xs text-content-tertiary tabular-nums">{s.run_count}x</span>
                                {canManage && (
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="sm" onClick={() => triggerSchedule.mutate(s.id)} className="text-xs">
                                            {t('agent.automation.runNow', 'Run')}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => { if (window.confirm(t('common.confirmDelete', 'Are you sure?'))) deleteSchedule.mutate(s.id); }} className="text-xs text-error">
                                            {t('common.delete')}
                                        </Button>
                                    </div>
                                )}
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* Triggers */}
            {activeSection === 'triggers' && (
                <div className="flex flex-col gap-2">
                    {(triggers as AgentTrigger[]).length === 0 ? (
                        <EmptyState title={t('agent.automation.noTriggers', 'No triggers configured')} />
                    ) : (
                        (triggers as AgentTrigger[]).map(tr => (
                            <Card key={tr.id} className="flex items-center gap-3 px-4 py-3">
                                <Switch
                                    checked={tr.is_enabled}
                                    onCheckedChange={(v: boolean) => toggleTrigger.mutate({ id: tr.id, enabled: v })}
                                    disabled={!canManage}
                                    aria-label={t('common.toggle')}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium truncate">{tr.name}</span>
                                        <Badge variant="outline">{tr.type}</Badge>
                                    </div>
                                    <div className="text-xs text-content-tertiary truncate">{tr.reason}</div>
                                </div>
                                <span className="text-xs text-content-tertiary tabular-nums">{tr.fire_count}x</span>
                                {canManage && (
                                    <Button variant="ghost" size="sm" onClick={() => { if (window.confirm(t('common.confirmDelete', 'Are you sure?'))) deleteTrigger.mutate(tr.id); }} className="text-xs text-error">
                                        {t('common.delete')}
                                    </Button>
                                )}
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* Tasks */}
            {activeSection === 'tasks' && (
                <div className="flex flex-col gap-2">
                    {(tasks as Task[]).length === 0 ? (
                        <EmptyState title={t('agent.automation.noTasks', 'No tasks')} />
                    ) : (
                        (tasks as Task[]).map(tk => (
                            <Card key={tk.id} className="flex items-center gap-3 px-4 py-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium truncate">{tk.title}</span>
                                        <Badge variant={tk.status === 'done' ? 'success' : tk.status === 'doing' ? 'default' : 'outline'}>
                                            {t(`task.status.${tk.status}`, tk.status)}
                                        </Badge>
                                        <Badge variant="outline">{t(`task.priority.${tk.priority}`, tk.priority)}</Badge>
                                    </div>
                                    {tk.description && <div className="text-xs text-content-tertiary truncate mt-0.5">{tk.description}</div>}
                                </div>
                                <div className="text-xs text-content-tertiary">{formatRelative(tk.updated_at)}</div>
                            </Card>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
