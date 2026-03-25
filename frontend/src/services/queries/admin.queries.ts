import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api';
import { queryKeys } from './keys';

export function useCompanies() {
    return useQuery({
        queryKey: queryKeys.admin.companies(),
        queryFn: () => adminApi.listCompanies(),
    });
}

export function useCreateCompany() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { name: string }) => adminApi.createCompany(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.companies() }),
    });
}

export function usePlatformSettings() {
    return useQuery({
        queryKey: queryKeys.admin.settings(),
        queryFn: () => adminApi.getPlatformSettings(),
    });
}

export function useUpdatePlatformSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Record<string, unknown>) => adminApi.updatePlatformSettings(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.settings() }),
    });
}
