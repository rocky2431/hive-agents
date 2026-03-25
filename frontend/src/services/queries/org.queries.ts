import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgApi } from '../api';
import { queryKeys } from './keys';

export function useDepartments(tenantId?: string) {
    return useQuery({
        queryKey: queryKeys.org.departments(),
        queryFn: () => orgApi.listDepartments(tenantId),
    });
}

export function useOrgUsers(departmentId?: string) {
    const params: Record<string, string> = {};
    if (departmentId) params.department_id = departmentId;
    return useQuery({
        queryKey: queryKeys.org.users(departmentId),
        queryFn: () => orgApi.listUsers(Object.keys(params).length ? params : undefined),
    });
}

export function useCreateDepartment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ data, tenantId }: { data: Record<string, unknown>; tenantId?: string }) =>
            orgApi.createDepartment(data, tenantId),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.org.departments() }),
    });
}

export function useUpdateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, data }: { userId: string; data: Record<string, unknown> }) =>
            orgApi.updateUser(userId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.org.users() }),
    });
}
