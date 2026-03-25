import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { enterpriseApi, auditApi } from '../api';
import { queryKeys } from './keys';

// ─── LLM Models ────────────────────────────────────

export function useLlmModels() {
    return useQuery({
        queryKey: queryKeys.enterprise.llmModels(),
        queryFn: () => enterpriseApi.llmModels(),
    });
}

export function useLlmTest() {
    return useMutation({
        mutationFn: ({ data, tenantId }: { data: Record<string, unknown>; tenantId?: string }) =>
            enterpriseApi.llmTest(data, tenantId),
    });
}

// ─── Audit Logs ────────────────────────────────────

export function useAuditLogs(filters?: Record<string, string | number | undefined>) {
    return useQuery({
        queryKey: queryKeys.enterprise.auditLogs(filters),
        queryFn: () => auditApi.query(filters ?? {}),
    });
}

// ─── Memory Config ─────────────────────────────────

export function useMemoryConfig(tenantId?: string) {
    return useQuery({
        queryKey: queryKeys.enterprise.memoryConfig(tenantId),
        queryFn: () => enterpriseApi.memoryConfig(tenantId),
    });
}

export function useUpdateMemoryConfig() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ data, tenantId }: { data: Record<string, unknown>; tenantId?: string }) =>
            enterpriseApi.updateMemoryConfig(data, tenantId),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.enterprise.memoryConfig() }),
    });
}

// ─── System Settings ───────────────────────────────

export function useSystemSetting(key: string, tenantId?: string) {
    return useQuery({
        queryKey: queryKeys.enterprise.systemSettings(key),
        queryFn: () => enterpriseApi.getSystemSetting(key, tenantId),
        enabled: !!key,
    });
}
