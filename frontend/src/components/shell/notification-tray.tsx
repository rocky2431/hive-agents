import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/date';
import type { Notification } from '@/types';
import { X } from 'lucide-react';

interface NotificationTrayProps {
    open: boolean;
    onClose: () => void;
}

export function NotificationTray({ open, onClose }: NotificationTrayProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: unreadCount = 0 } = useQuery({
        queryKey: ['notifications-unread'],
        queryFn: () => notificationApi.unreadCount(),
        refetchInterval: 30000,
    });

    const { data: notifications = [] } = useQuery({
        queryKey: ['notifications'],
        queryFn: () => notificationApi.list({ limit: 20 }),
        enabled: open,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    const markAllRead = async () => {
        await notificationApi.markAllRead();
        invalidate();
    };

    const markOneRead = async (id: string) => {
        await notificationApi.markRead(id);
        invalidate();
    };

    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-[9998]" onClick={onClose} aria-hidden="true" />
            <div
                className="fixed top-0 bottom-0 w-[360px] bg-surface-primary border-r border-edge-subtle z-[9999] flex flex-col shadow-lg transition-[left] duration-200"
                style={{ left: 'var(--sidebar-width)' }}
            >
                <div className="flex items-center gap-2 px-5 py-4 border-b border-edge-subtle">
                    <h3 className="m-0 text-sm font-semibold flex-1">{t('layout.notifications')}</h3>
                    {(unreadCount as number) > 0 && (
                        <Button variant="ghost" size="sm" onClick={markAllRead} className="text-[11px]">
                            {t('layout.markAllRead')}
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { navigate('/notifications'); onClose(); }}
                        className="text-[11px]"
                    >
                        {t('layout.viewAllNotifications', 'View all')}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" aria-label={t('common.close', 'Close')}>
                        <X size={14} />
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                    {(notifications as Notification[]).length === 0 && (
                        <div className="text-center px-5 py-10 text-content-tertiary text-[13px]">
                            {t('layout.noNotifications')}
                        </div>
                    )}
                    {(notifications as Notification[]).map((n: any) => (
                        <button
                            type="button"
                            key={n.id}
                            onClick={() => {
                                if (!n.is_read) markOneRead(n.id);
                                if (n.link) { navigate(n.link); onClose(); }
                            }}
                            className={`w-full text-left px-5 py-3 border-b border-edge-subtle transition-colors hover:bg-surface-tertiary bg-transparent border-x-0 border-t-0 ${n.link ? 'cursor-pointer' : 'cursor-default'} ${n.is_read ? '' : 'bg-surface-secondary'}`}
                        >
                            <div className="flex items-center gap-1.5 mb-1">
                                {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />}
                                <span className="text-xs font-medium flex-1 truncate">{n.title}</span>
                            </div>
                            {n.body && <div className="text-[11px] text-content-tertiary leading-snug truncate">{n.body}</div>}
                            <div className="text-[10px] text-content-tertiary/60 mt-1">
                                {formatRelative(n.created_at)}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
