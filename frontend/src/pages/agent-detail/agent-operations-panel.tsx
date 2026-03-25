import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { scheduleApi, taskApi, triggerApi } from '@/services/api';
import { useAuthStore } from '@/stores';

export interface AgentOperationsPanelProps {
    agentId: string;
    agent: any;
}

export function AgentOperationsPanel({ agentId, agent }: AgentOperationsPanelProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const currentUser = useAuthStore((s) => s.user);
    const canManageSchedules = currentUser?.id === agent.creator_id;
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [taskForm, setTaskForm] = useState({ title: '', description: '', type: 'todo', priority: 'medium', due_date: '' });
    const [scheduleForm, setScheduleForm] = useState({ name: '', instruction: '', cron_expr: '0 9 * * 1-5' });
    const [taskDrafts, setTaskDrafts] = useState<Record<string, any>>({});
    const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, any>>({});
    const [triggerDrafts, setTriggerDrafts] = useState<Record<string, any>>({});
    const [expandedTaskLogsId, setExpandedTaskLogsId] = useState<string | null>(null);
    const [expandedScheduleHistoryId, setExpandedScheduleHistoryId] = useState<string | null>(null);

    const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
        setNotice({ message, type });
        setTimeout(() => setNotice(null), 2500);
    };

    const { data: tasks = [] } = useQuery({
        queryKey: ['agent-tasks', agentId],
        queryFn: () => taskApi.list(agentId),
        enabled: !!agentId,
    });
    const { data: taskLogs = [] } = useQuery({
        queryKey: ['agent-task-logs', agentId, expandedTaskLogsId],
        queryFn: () => taskApi.getLogs(agentId, expandedTaskLogsId!),
        enabled: !!agentId && !!expandedTaskLogsId,
    });
    const { data: schedules = [] } = useQuery({
        queryKey: ['schedules', agentId],
        queryFn: () => scheduleApi.list(agentId),
        enabled: !!agentId,
    });
    const { data: scheduleHistory = [] } = useQuery({
        queryKey: ['schedule-history', agentId, expandedScheduleHistoryId],
        queryFn: () => scheduleApi.history(agentId, expandedScheduleHistoryId!),
        enabled: !!agentId && !!expandedScheduleHistoryId,
    });
    const { data: triggers = [] } = useQuery({
        queryKey: ['agent-triggers', agentId],
        queryFn: () => triggerApi.list(agentId),
        enabled: !!agentId,
    });

    useEffect(() => {
        setTaskDrafts(
            Object.fromEntries((tasks as any[]).map((task: any) => [task.id, {
                title: task.title,
                description: task.description || '',
                status: task.status,
                priority: task.priority,
                due_date: task.due_date ? String(task.due_date).slice(0, 16) : '',
            }])),
        );
    }, [tasks]);

    useEffect(() => {
        setScheduleDrafts(
            Object.fromEntries((schedules as any[]).map((schedule: any) => [schedule.id, {
                name: schedule.name,
                instruction: schedule.instruction || '',
                cron_expr: schedule.cron_expr,
                is_enabled: !!schedule.is_enabled,
            }])),
        );
    }, [schedules]);

    useEffect(() => {
        setTriggerDrafts(
            Object.fromEntries((triggers as any[]).map((trigger: any) => [trigger.id, {
                reason: trigger.reason || '',
                max_fires: trigger.max_fires ?? '',
                cooldown_seconds: trigger.cooldown_seconds ?? 0,
                expires_at: trigger.expires_at ? String(trigger.expires_at).slice(0, 16) : '',
                is_enabled: !!trigger.is_enabled,
                config_text: JSON.stringify(trigger.config || {}, null, 2),
            }])),
        );
    }, [triggers]);

    const createTaskMutation = useMutation({
        mutationFn: () => taskApi.create(agentId, {
            title: taskForm.title.trim(),
            description: taskForm.description.trim() || undefined,
            type: taskForm.type,
            priority: taskForm.priority,
            due_date: taskForm.due_date ? new Date(taskForm.due_date).toISOString() : undefined,
        }),
        onSuccess: async () => {
            setTaskForm({ title: '', description: '', type: 'todo', priority: 'medium', due_date: '' });
            await queryClient.invalidateQueries({ queryKey: ['agent-tasks', agentId] });
            showNotice(t('agentDetail.taskCreated', 'Task created'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to create task', 'error'),
    });

    const updateTaskMutation = useMutation({
        mutationFn: ({ taskId, data }: { taskId: string; data: any }) => taskApi.update(agentId, taskId, data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['agent-tasks', agentId] });
            showNotice(t('agentDetail.taskSaved', 'Task updated'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to update task', 'error'),
    });

    const triggerTaskMutation = useMutation({
        mutationFn: (taskId: string) => taskApi.trigger(agentId, taskId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['agent-tasks', agentId] });
            await queryClient.invalidateQueries({ queryKey: ['agent-task-logs', agentId, expandedTaskLogsId] });
            showNotice(t('agentDetail.taskTriggered', 'Task triggered'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to trigger task', 'error'),
    });

    const createScheduleMutation = useMutation({
        mutationFn: () => scheduleApi.create(agentId, {
            name: scheduleForm.name.trim(),
            instruction: scheduleForm.instruction.trim(),
            cron_expr: scheduleForm.cron_expr.trim(),
        }),
        onSuccess: async () => {
            setScheduleForm({ name: '', instruction: '', cron_expr: '0 9 * * 1-5' });
            await queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            showNotice(t('agentDetail.scheduleCreated', 'Schedule created'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to create schedule', 'error'),
    });

    const updateScheduleMutation = useMutation({
        mutationFn: ({ scheduleId, data }: { scheduleId: string; data: any }) => scheduleApi.update(agentId, scheduleId, data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            showNotice(t('agentDetail.scheduleSaved', 'Schedule updated'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to update schedule', 'error'),
    });

    const deleteScheduleMutation = useMutation({
        mutationFn: (scheduleId: string) => scheduleApi.delete(agentId, scheduleId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            showNotice(t('agentDetail.scheduleDeleted', 'Schedule deleted'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to delete schedule', 'error'),
    });

    const runScheduleMutation = useMutation({
        mutationFn: (scheduleId: string) => scheduleApi.trigger(agentId, scheduleId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['schedules', agentId] });
            await queryClient.invalidateQueries({ queryKey: ['schedule-history', agentId, expandedScheduleHistoryId] });
            showNotice(t('agentDetail.scheduleTriggered', 'Schedule triggered'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to trigger schedule', 'error'),
    });

    const updateTriggerMutation = useMutation({
        mutationFn: ({ triggerId, data }: { triggerId: string; data: any }) => triggerApi.update(agentId, triggerId, data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['agent-triggers', agentId] });
            showNotice(t('agentDetail.triggerSaved', 'Trigger updated'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to update trigger', 'error'),
    });

    const deleteTriggerMutation = useMutation({
        mutationFn: (triggerId: string) => triggerApi.delete(agentId, triggerId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['agent-triggers', agentId] });
            showNotice(t('agentDetail.triggerDeleted', 'Trigger deleted'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to delete trigger', 'error'),
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            {notice && (
                <div style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    background: notice.type === 'success' ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
                    border: `1px solid ${notice.type === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    color: notice.type === 'success' ? 'var(--success, #10b981)' : 'var(--status-error, #ef4444)',
                }}>
                    {notice.message}
                </div>
            )}

            <div className="card">
                <h4 style={{ marginBottom: '12px' }}>{t('agentDetail.taskAutomationTitle', 'Tasks, schedules, and triggers')}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                    {t('agentDetail.taskAutomationDesc', 'Operate the same task execution, schedule history, and trigger governance capabilities that the backend already exposes.')}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
                    <div className="card" style={{ margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('agentDetail.tasksManager', 'Tasks')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                            <input className="input" value={taskForm.title} onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))} placeholder={t('agentDetail.taskTitle', 'Task title')} />
                            <textarea className="input" value={taskForm.description} onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))} placeholder={t('agentDetail.taskDescription', 'Task description')} style={{ minHeight: '72px', resize: 'vertical' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <select className="input" value={taskForm.type} onChange={(e) => setTaskForm((prev) => ({ ...prev, type: e.target.value }))}>
                                    <option value="todo">{t('agent.tasks.typeTask', 'Task')}</option>
                                    <option value="supervision">{t('agent.tasks.typeSupervision', 'Supervision')}</option>
                                </select>
                                <select className="input" value={taskForm.priority} onChange={(e) => setTaskForm((prev) => ({ ...prev, priority: e.target.value }))}>
                                    <option value="low">{t('agentDetail.priorityLow', 'Low')}</option>
                                    <option value="medium">{t('agentDetail.priorityMedium', 'Medium')}</option>
                                    <option value="high">{t('agentDetail.priorityHigh', 'High')}</option>
                                    <option value="urgent">{t('agentDetail.priorityUrgent', 'Urgent')}</option>
                                </select>
                            </div>
                            <input className="input" type="datetime-local" value={taskForm.due_date} onChange={(e) => setTaskForm((prev) => ({ ...prev, due_date: e.target.value }))} />
                            <button className="btn btn-primary" disabled={!taskForm.title.trim() || createTaskMutation.isPending} onClick={() => createTaskMutation.mutate()}>
                                {createTaskMutation.isPending ? t('common.loading') : t('agent.tasks.newTask', 'New Task')}
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
                            {(tasks as any[]).map((task: any) => {
                                const draft = taskDrafts[task.id] || {};
                                return (
                                    <div key={task.id} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
                                        <input className="input" value={draft.title || ''} onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [task.id]: { ...prev[task.id], title: e.target.value } }))} style={{ marginBottom: '8px' }} />
                                        <textarea className="input" value={draft.description || ''} onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [task.id]: { ...prev[task.id], description: e.target.value } }))} style={{ minHeight: '60px', resize: 'vertical', marginBottom: '8px' }} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                            <select className="input" value={draft.status || task.status} onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: e.target.value } }))}>
                                                <option value="pending">{t('agent.tasks.todo', 'Todo')}</option>
                                                <option value="doing">{t('agent.tasks.doing', 'In Progress')}</option>
                                                <option value="done">{t('agent.tasks.done', 'Done')}</option>
                                                <option value="paused">{t('agentDetail.paused', 'Paused')}</option>
                                            </select>
                                            <select className="input" value={draft.priority || task.priority} onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [task.id]: { ...prev[task.id], priority: e.target.value } }))}>
                                                <option value="low">{t('agentDetail.priorityLow', 'Low')}</option>
                                                <option value="medium">{t('agentDetail.priorityMedium', 'Medium')}</option>
                                                <option value="high">{t('agentDetail.priorityHigh', 'High')}</option>
                                                <option value="urgent">{t('agentDetail.priorityUrgent', 'Urgent')}</option>
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
                                            <button className="btn btn-secondary" onClick={() => setExpandedTaskLogsId(expandedTaskLogsId === task.id ? null : task.id)}>
                                                {expandedTaskLogsId === task.id ? t('agentDetail.hideLogs', 'Hide logs') : t('agentDetail.viewLogs', 'View logs')}
                                            </button>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-secondary" onClick={() => triggerTaskMutation.mutate(task.id)} disabled={triggerTaskMutation.isPending}>
                                                    {t('agentDetail.runNow', 'Run now')}
                                                </button>
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => updateTaskMutation.mutate({
                                                        taskId: task.id,
                                                        data: {
                                                            title: draft.title,
                                                            description: draft.description || null,
                                                            status: draft.status,
                                                            priority: draft.priority,
                                                            due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
                                                        },
                                                    })}
                                                    disabled={updateTaskMutation.isPending}
                                                >
                                                    {t('common.save', 'Save')}
                                                </button>
                                            </div>
                                        </div>
                                        {expandedTaskLogsId === task.id && (
                                            <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                {taskLogs.length > 0 ? taskLogs.map((log: any) => (
                                                    <div key={log.id} style={{ marginBottom: '6px' }}>
                                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{log.created_at ? new Date(log.created_at).toLocaleString() : ''}</div>
                                                        <div>{log.content}</div>
                                                    </div>
                                                )) : t('agentDetail.noTaskLogs', 'No task logs yet.')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {tasks.length === 0 && (
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agent.tasks.noTasks', 'No tasks')}</div>
                            )}
                        </div>
                    </div>

                    <div className="card" style={{ margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('agentDetail.scheduleManager', 'Schedules')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                            <input className="input" value={scheduleForm.name} onChange={(e) => setScheduleForm((prev) => ({ ...prev, name: e.target.value }))} placeholder={t('agent.tasks.schedule', 'Schedule')} />
                            <input className="input" value={scheduleForm.cron_expr} onChange={(e) => setScheduleForm((prev) => ({ ...prev, cron_expr: e.target.value }))} placeholder={t('agent.tasks.cronExpression', 'Cron Expression')} />
                            <textarea className="input" value={scheduleForm.instruction} onChange={(e) => setScheduleForm((prev) => ({ ...prev, instruction: e.target.value }))} placeholder={t('agent.tasks.scheduleDesc', 'Schedule description (optional)')} style={{ minHeight: '72px', resize: 'vertical' }} />
                            <button className="btn btn-primary" disabled={!scheduleForm.name.trim() || !scheduleForm.cron_expr.trim() || !canManageSchedules || createScheduleMutation.isPending} onClick={() => createScheduleMutation.mutate()}>
                                {createScheduleMutation.isPending ? t('common.loading') : t('agent.tasks.addSchedule', 'Add Schedule')}
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
                            {(schedules as any[]).map((schedule: any) => {
                                const draft = scheduleDrafts[schedule.id] || {};
                                return (
                                    <div key={schedule.id} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
                                        <input className="input" value={draft.name || ''} onChange={(e) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...prev[schedule.id], name: e.target.value } }))} style={{ marginBottom: '8px' }} />
                                        <input className="input" value={draft.cron_expr || ''} onChange={(e) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...prev[schedule.id], cron_expr: e.target.value } }))} style={{ marginBottom: '8px' }} />
                                        <textarea className="input" value={draft.instruction || ''} onChange={(e) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...prev[schedule.id], instruction: e.target.value } }))} style={{ minHeight: '60px', resize: 'vertical', marginBottom: '8px' }} />
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '8px' }}>
                                            <input type="checkbox" checked={!!draft.is_enabled} onChange={(e) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...prev[schedule.id], is_enabled: e.target.checked } }))} disabled={!canManageSchedules} />
                                            {t('agentDetail.scheduleEnabled', 'Enabled')}
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                            <button className="btn btn-secondary" onClick={() => setExpandedScheduleHistoryId(expandedScheduleHistoryId === schedule.id ? null : schedule.id)}>
                                                {expandedScheduleHistoryId === schedule.id ? t('agentDetail.hideHistory', 'Hide history') : t('agentDetail.viewHistory', 'View history')}
                                            </button>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-secondary" onClick={() => runScheduleMutation.mutate(schedule.id)} disabled={runScheduleMutation.isPending}>
                                                    {t('agentDetail.runNow', 'Run now')}
                                                </button>
                                                <button className="btn btn-primary" onClick={() => updateScheduleMutation.mutate({ scheduleId: schedule.id, data: draft })} disabled={!canManageSchedules || updateScheduleMutation.isPending}>
                                                    {t('common.save', 'Save')}
                                                </button>
                                                <button className="btn btn-danger" onClick={() => deleteScheduleMutation.mutate(schedule.id)} disabled={!canManageSchedules || deleteScheduleMutation.isPending}>
                                                    {t('common.delete', 'Delete')}
                                                </button>
                                            </div>
                                        </div>
                                        {expandedScheduleHistoryId === schedule.id && (
                                            <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                {scheduleHistory.length > 0 ? scheduleHistory.map((item: any) => (
                                                    <div key={item.id} style={{ marginBottom: '6px' }}>
                                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</div>
                                                        <div>{item.summary}</div>
                                                    </div>
                                                )) : t('agentDetail.noScheduleHistory', 'No schedule history yet.')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {schedules.length === 0 && (
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agentDetail.noSchedules', 'No schedules yet.')}</div>
                            )}
                        </div>
                    </div>

                    <div className="card" style={{ margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('agentDetail.triggerManager', 'Triggers')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '520px', overflowY: 'auto' }}>
                            {(triggers as any[]).map((trigger: any) => {
                                const draft = triggerDrafts[trigger.id] || {};
                                return (
                                    <div key={trigger.id} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                                            <div>
                                                <div style={{ fontSize: '13px', fontWeight: 600 }}>{trigger.name}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{trigger.type}</div>
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                                <input type="checkbox" checked={!!draft.is_enabled} onChange={(e) => setTriggerDrafts((prev) => ({ ...prev, [trigger.id]: { ...prev[trigger.id], is_enabled: e.target.checked } }))} />
                                                {t('agentDetail.triggerEnabled', 'Enabled')}
                                            </label>
                                        </div>
                                        <textarea className="input" value={draft.reason || ''} onChange={(e) => setTriggerDrafts((prev) => ({ ...prev, [trigger.id]: { ...prev[trigger.id], reason: e.target.value } }))} placeholder={t('agentDetail.triggerReason', 'Reason')} style={{ minHeight: '56px', resize: 'vertical', marginBottom: '8px' }} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                            <input className="input" type="number" min={0} value={draft.max_fires} onChange={(e) => setTriggerDrafts((prev) => ({ ...prev, [trigger.id]: { ...prev[trigger.id], max_fires: e.target.value === '' ? '' : Number(e.target.value) } }))} placeholder={t('agentDetail.maxFires', 'Max fires')} />
                                            <input className="input" type="number" min={0} value={draft.cooldown_seconds ?? 0} onChange={(e) => setTriggerDrafts((prev) => ({ ...prev, [trigger.id]: { ...prev[trigger.id], cooldown_seconds: Number(e.target.value) } }))} placeholder={t('agentDetail.cooldownSeconds', 'Cooldown seconds')} />
                                        </div>
                                        <textarea className="input" value={draft.config_text || ''} onChange={(e) => setTriggerDrafts((prev) => ({ ...prev, [trigger.id]: { ...prev[trigger.id], config_text: e.target.value } }))} style={{ minHeight: '100px', resize: 'vertical', fontFamily: 'var(--font-mono)', marginBottom: '8px' }} />
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => {
                                                    let config = {};
                                                    try {
                                                        config = JSON.parse(draft.config_text || '{}');
                                                    } catch (error) {
                                                        showNotice(t('agentDetail.invalidJson', 'Trigger config must be valid JSON'), 'error');
                                                        return;
                                                    }
                                                    updateTriggerMutation.mutate({
                                                        triggerId: trigger.id,
                                                        data: {
                                                            config,
                                                            reason: draft.reason,
                                                            is_enabled: draft.is_enabled,
                                                            max_fires: draft.max_fires === '' ? null : Number(draft.max_fires),
                                                            cooldown_seconds: Number(draft.cooldown_seconds) || 0,
                                                            expires_at: draft.expires_at ? new Date(draft.expires_at).toISOString() : null,
                                                        },
                                                    });
                                                }}
                                                disabled={updateTriggerMutation.isPending}
                                            >
                                                {t('common.save', 'Save')}
                                            </button>
                                            <button className="btn btn-danger" onClick={() => deleteTriggerMutation.mutate(trigger.id)} disabled={deleteTriggerMutation.isPending}>
                                                {t('common.delete', 'Delete')}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {triggers.length === 0 && (
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agentDetail.noTriggers', 'No triggers yet.')}</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
