import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../api';
import { queryKeys } from './keys';

export function useNotifications() {
    return useQuery({
        queryKey: queryKeys.notifications.list(),
        queryFn: () => notificationApi.list(),
        refetchInterval: 30_000,
    });
}

export function useUnreadCount() {
    return useQuery({
        queryKey: queryKeys.notifications.unread(),
        queryFn: () => notificationApi.unreadCount(),
        refetchInterval: 30_000,
    });
}

export function useMarkRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => notificationApi.markRead(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
        },
    });
}
