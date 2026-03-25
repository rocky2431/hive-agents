import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { packApi, capabilityApi } from '../api';
import { queryKeys } from './keys';

// ─── Packs ─────────────────────────────────────────

export function usePackCatalog() {
    return useQuery({
        queryKey: queryKeys.packs.catalog(),
        queryFn: () => packApi.catalog(),
    });
}

export function useUpdatePackPolicy() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ packName, enabled }: { packName: string; enabled: boolean }) =>
            packApi.updatePolicy(packName, enabled),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.packs.catalog() }),
    });
}

// ─── MCP Servers ───────────────────────────────────

export function useMcpServers() {
    return useQuery({
        queryKey: queryKeys.packs.mcpServers(),
        queryFn: () => packApi.mcpRegistry(),
    });
}

export function useImportMcp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { server_id?: string; mcp_url?: string; server_name?: string; config?: Record<string, unknown> }) =>
            packApi.importMcp(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.packs.mcpServers() }),
    });
}

export function useDeleteMcp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (serverKey: string) => packApi.deleteMcp(serverKey),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.packs.mcpServers() }),
    });
}

// ─── Capabilities ──────────────────────────────────

export function useCapabilityDefinitions() {
    return useQuery({
        queryKey: queryKeys.capabilities.definitions(),
        queryFn: () => capabilityApi.definitions(),
    });
}

export function useCapabilityPolicies(agentId?: string) {
    return useQuery({
        queryKey: queryKeys.capabilities.policies(agentId),
        queryFn: () => capabilityApi.list(agentId),
    });
}

export function useUpsertCapabilityPolicy() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { capability: string; agent_id?: string; allowed: boolean; requires_approval: boolean }) =>
            capabilityApi.upsert(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.capabilities.policies() }),
    });
}

// ─── Agent Capability Summary ──────────────────────

export function useAgentCapabilitySummary(agentId: string) {
    return useQuery({
        queryKey: queryKeys.agents.capabilitySummary(agentId),
        queryFn: () => packApi.capabilitySummary(agentId),
        enabled: !!agentId,
    });
}
