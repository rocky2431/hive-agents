export interface NotificationUnreadCountPayload {
    unread_count?: number | null;
    count?: number | null;
}

export function extractUnreadCount(payload: NotificationUnreadCountPayload | null | undefined): number {
    if (!payload) return 0;
    if (typeof payload.unread_count === 'number') return payload.unread_count;
    if (typeof payload.count === 'number') return payload.count;
    return 0;
}
