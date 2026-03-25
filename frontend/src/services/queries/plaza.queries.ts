import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plazaApi } from '../api';
import { queryKeys } from './keys';

export function usePlazaPosts(limit?: number) {
    return useQuery({
        queryKey: queryKeys.plaza.posts(limit),
        queryFn: () => plazaApi.list(undefined, limit),
    });
}

export function usePlazaStats() {
    return useQuery({
        queryKey: queryKeys.plaza.stats(),
        queryFn: () => plazaApi.stats(),
    });
}

export function useCreatePost() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (content: string) => plazaApi.create(content),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.plaza.posts() }),
    });
}

export function useToggleLike() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (postId: string) => plazaApi.toggleLike(postId),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.plaza.posts() }),
    });
}
