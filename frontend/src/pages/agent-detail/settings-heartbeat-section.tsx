import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentApi } from '@/services/api';
import { cn } from '@/lib/cn';
import type { Agent } from '@/types';

interface HeartbeatSectionProps {
    agentId: string;
    agent: Agent;
    canManage: boolean;
}

export function HeartbeatSection({ agentId, agent, canManage }: HeartbeatSectionProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['agent', agentId] });

    const update = async (data: Record<string, unknown>) => {
        try {
            await agentApi.update(agentId, data as any);
            refresh();
        } catch (err) { toast.error((err as Error).message); }
    };

    return (
        <div className="card mb-3">
            <h4 className="mb-1 flex items-center gap-2">
                {t('agent.settings.heartbeat.title', 'Heartbeat')}
            </h4>
            <p className="text-xs text-content-tertiary mb-4">
                {t('agent.settings.heartbeat.description', 'Periodic awareness check -- agent proactively monitors the plaza and work environment.')}
            </p>
            <div className="flex flex-col gap-3.5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                    <div>
                        <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.enabled', 'Enable Heartbeat')}</div>
                        <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.enabledDesc', 'Agent will periodically check plaza and work status')}</div>
                    </div>
                    <label className={cn('relative inline-block w-[44px] h-[24px]', canManage ? 'cursor-pointer' : 'cursor-default')}>
                        <input
                            type="checkbox"
                            aria-label={t('agent.settings.heartbeat.enabled', 'Enable Heartbeat')}
                            checked={agent?.heartbeat_enabled ?? true}
                            disabled={!canManage}
                            onChange={(e) => { if (canManage) update({ heartbeat_enabled: e.target.checked }); }}
                            className="opacity-0 w-0 h-0"
                        />
                        <span
                            className={cn(
                                'absolute inset-0 rounded-xl transition-colors duration-200',
                                (agent?.heartbeat_enabled ?? true) ? 'bg-accent-primary' : 'bg-surface-tertiary',
                                !canManage && 'opacity-60',
                            )}
                        >
                            <span
                                className="absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full transition-[left] duration-200"
                                style={{ left: (agent?.heartbeat_enabled ?? true) ? '23px' : '3px' }}
                            />
                        </span>
                    </label>
                </div>

                {/* Interval */}
                <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                    <div>
                        <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.interval', 'Check Interval')}</div>
                        <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.intervalDesc', 'How often the agent checks for updates')}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            className={cn('input w-[80px] text-xs', !canManage && 'opacity-60')}
                            disabled={!canManage}
                            min={1}
                            defaultValue={agent?.heartbeat_interval_minutes ?? 120}
                            key={agent?.heartbeat_interval_minutes}
                            onBlur={(e) => {
                                if (!canManage) return;
                                const val = Math.max(1, Number(e.target.value) || 120);
                                e.target.value = String(val);
                                update({ heartbeat_interval_minutes: val });
                            }}
                        />
                        <span className="text-xs text-content-tertiary">{t('common.minutes', 'min')}</span>
                    </div>
                </div>

                {/* Active Hours */}
                <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                    <div>
                        <div className="font-medium text-[13px]">{t('agent.settings.heartbeat.activeHours', 'Active Hours')}</div>
                        <div className="text-[11px] text-content-tertiary">{t('agent.settings.heartbeat.activeHoursDesc', 'Only trigger heartbeat during these hours (HH:MM-HH:MM)')}</div>
                    </div>
                    <input
                        className={cn('input w-[140px] text-xs text-center', !canManage && 'opacity-60')}
                        disabled={!canManage}
                        value={agent?.heartbeat_active_hours ?? '09:00-18:00'}
                        onChange={(e) => { if (canManage) update({ heartbeat_active_hours: e.target.value }); }}
                        placeholder="09:00-18:00"
                    />
                </div>

                {/* Last Heartbeat */}
                {agent?.last_heartbeat_at && (
                    <div className="text-xs text-content-tertiary pl-1">
                        {t('agent.settings.heartbeat.lastRun', 'Last heartbeat')}: {new Date(agent.last_heartbeat_at).toLocaleString()}
                    </div>
                )}
            </div>
        </div>
    );
}
