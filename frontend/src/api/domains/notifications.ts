/**
 * Notifications domain adapter — unified notification center.
 *
 * Consolidates both /notifications and /messages endpoints.
 * The legacy /messages/* read endpoints are mapped to /notifications/*.
 */

import { get, post } from '../core';

export interface Notification {
  id: string;
  type: string;
  title?: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}

export const notificationsApi = {
  list: () => get<Notification[]>('/notifications'),
  getUnreadCount: () => get<UnreadCount>('/notifications/unread-count'),
  markRead: (id: string) => post<void>(`/notifications/${id}/read`),
  markAllRead: () => post<void>('/notifications/read-all'),

  /** Agent-to-agent inbox (separate from user notifications) */
  getInbox: () => get<unknown[]>('/messages/inbox'),
  getInboxUnreadCount: () => get<UnreadCount>('/messages/unread-count'),
};
