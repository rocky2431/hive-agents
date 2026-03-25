import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentApi, taskApi, configHistoryApi } from '../api';
import { queryKeys } from './keys';
import type { Agent, AgentCreateInput, Task } from '@/types';

// ─── Agent CRUD ────────────────────────────────────

export function useAgents(tenantId?: string) {
    return useQuery({
        queryKey: queryKeys.agents.list({ tenantId }),
        queryFn: () => agentApi.list(tenantId),
    });
}

export function useAgent(id: string) {
    return useQuery({
        queryKey: queryKeys.agents.detail(id),
        queryFn: () => agentApi.get(id),
        enabled: !!id,
    });
}

export function useCreateAgent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: AgentCreateInput) => agentApi.create(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.all }),
    });
}

export function useUpdateAgent(id: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<Agent>) => agentApi.update(id, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
            qc.invalidateQueries({ queryKey: queryKeys.agents.lists() });
        },
    });
}

export function useDeleteAgent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => agentApi.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.all }),
    });
}

// ─── Sessions ──────────────────────────────────────

export function useAgentSessions(agentId: string, scope: 'mine' | 'all' = 'mine') {
    return useQuery({
        queryKey: queryKeys.agents.sessions(agentId, scope),
        queryFn: () => agentApi.sessions(agentId, scope),
        enabled: !!agentId,
    });
}

// ─── Tasks ─────────────────────────────────────────

export function useAgentTasks(agentId: string, status?: string, type?: string) {
    return useQuery({
        queryKey: queryKeys.agents.tasks(agentId, { status, type }),
        queryFn: () => taskApi.list(agentId, status, type),
        enabled: !!agentId,
    });
}

export function useCreateTask(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<Task>) => taskApi.create(agentId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.tasks(agentId) }),
    });
}

export function useUpdateTask(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, data }: { taskId: string; data: Partial<Task> }) =>
            taskApi.update(agentId, taskId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.tasks(agentId) }),
    });
}

// ─── Approvals ─────────────────────────────────────

export function useAgentApprovals(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.approvals(agentId),
        queryFn: () => agentApi.listApprovals(agentId),
        enabled: !!agentId,
    });
}

export function useResolveApproval(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ approvalId, data }: { approvalId: string; data: { action: string; reason?: string } }) =>
            agentApi.resolveApproval(agentId, approvalId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents.approvals(agentId) }),
    });
}

// ─── Permissions ───────────────────────────────────

export function useAgentPermissions(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.permissions(agentId),
        queryFn: () => agentApi.getPermissions(agentId),
        enabled: !!agentId,
    });
}

// ─── Gateway ───────────────────────────────────────

export function useGatewayMessages(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.gatewayMessages(agentId),
        queryFn: () => agentApi.gatewayMessages(agentId),
        enabled: !!agentId,
    });
}

// ─── Config History ────────────────────────────────

export function useConfigHistory(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.configHistory(agentId),
        queryFn: () => configHistoryApi.list(agentId),
        enabled: !!agentId,
    });
}
