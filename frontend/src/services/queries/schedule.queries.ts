import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleApi } from '../api';
import { queryKeys } from './keys';

export function useAgentSchedules(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.schedules(agentId),
        queryFn: () => scheduleApi.list(agentId),
        enabled: !!agentId,
    });
}

export function useCreateSchedule(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { name: string; instruction: string; cron_expr: string }) =>
            scheduleApi.create(agentId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.schedules(agentId) }),
    });
}

export function useUpdateSchedule(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ scheduleId, data }: { scheduleId: string; data: Record<string, unknown> }) =>
            scheduleApi.update(agentId, scheduleId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.schedules(agentId) }),
    });
}

export function useDeleteSchedule(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (scheduleId: string) => scheduleApi.delete(agentId, scheduleId),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.schedules(agentId) }),
    });
}
