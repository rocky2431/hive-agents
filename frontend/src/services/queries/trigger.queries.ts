import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { triggerApi } from '../api';
import { queryKeys } from './keys';

export function useAgentTriggers(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.triggers(agentId),
        queryFn: () => triggerApi.list(agentId),
        enabled: !!agentId,
    });
}

export function useUpdateTrigger(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ triggerId, data }: { triggerId: string; data: Record<string, unknown> }) =>
            triggerApi.update(agentId, triggerId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.triggers(agentId) }),
    });
}

export function useDeleteTrigger(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (triggerId: string) => triggerApi.delete(agentId, triggerId),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.triggers(agentId) }),
    });
}
