import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';

import { notificationApi } from '@/services/api';
import type { Notification, NotificationType } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatRelative } from '@/lib/date';

const FILTER_TYPES = [
    'all',
    'approval_pending',
    'approval_resolved',
    'plaza_comment',
    'skill_install_request',
    'system',
] as const;

type FilterType = (typeof FILTER_TYPES)[number];

const FILTER_LABEL_KEYS: Record<FilterType, string> = {
    all: 'notifications.filters.all',
    approval_pending: 'notifications.filters.approvalPending',
    approval_resolved: 'notifications.filters.approvalResolved',
    plaza_comment: 'notifications.filters.plazaComment',
    skill_install_request: 'notifications.filters.skillRequest',
    system: 'notifications.filters.system',
};

export default function NotificationCenter() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [typeFilter, setTypeFilter] = useQueryState(
        'type',
        parseAsStringLiteral(FILTER_TYPES).withDefault('all'),
    );
    const [unreadOnly, setUnreadOnly] = useQueryState(
        'unread',
        parseAsBoolean.withDefault(false),
    );

    const { data: notifications = [], isLoading } = useQuery({
        queryKey: ['notifications', 'center', unreadOnly],
        queryFn: () => notificationApi.list({ limit: 200, unreadOnly }),
    });

    const filteredNotifications = useMemo(() => {
        if (typeFilter === 'all') return notifications;
        return notifications.filter((item) => item.type === typeFilter);
    }, [notifications, typeFilter]);

    const markRead = useMutation({
        mutationFn: (id: string) => notificationApi.markRead(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['notifications'] });
            qc.invalidateQueries({ queryKey: ['notifications-unread'] });
        },
    });

    const markAllRead = useMutation({
        mutationFn: () => notificationApi.markAllRead(),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['notifications'] });
            qc.invalidateQueries({ queryKey: ['notifications-unread'] });
        },
    });

    const groupedNotifications = useMemo(() => {
        return filteredNotifications.reduce<Record<string, Notification[]>>((groups, item) => {
            const key = formatDate(item.created_at);
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
            return groups;
        }, {});
    }, [filteredNotifications]);

    const unreadCount = notifications.filter((item) => !item.is_read).length;

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-content-primary">
                        {t('notifications.title', 'Notifications')}
                    </h1>
                    <p className="mt-1 text-sm text-content-tertiary">
                        {t('notifications.subtitle', 'Review approvals, plaza replies, and system notices in one feed.')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={unreadCount > 0 ? 'warning' : 'secondary'}>
                        {t('notifications.unreadCount', '{{count}} unread').replace('{{count}}', String(unreadCount))}
                    </Badge>
                    <Button
                        variant="secondary"
                        onClick={() => setUnreadOnly(!unreadOnly)}
                    >
                        {unreadOnly
                            ? t('notifications.showAll', 'Show all')
                            : t('notifications.showUnreadOnly', 'Unread only')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => markAllRead.mutate()}
                        disabled={unreadCount === 0}
                        loading={markAllRead.isPending}
                    >
                        {t('layout.markAllRead', 'Mark all read')}
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {FILTER_TYPES.map((value) => (
                    <Button
                        key={value}
                        variant={typeFilter === value ? 'default' : 'secondary'}
                        size="sm"
                        onClick={() => setTypeFilter(value)}
                    >
                        {t(FILTER_LABEL_KEYS[value])}
                    </Button>
                ))}
            </div>

            {isLoading ? (
                <Card>
                    <CardContent className="pt-4 text-sm text-content-tertiary">
                        {t('common.loading', 'Loading...')}
                    </CardContent>
                </Card>
            ) : filteredNotifications.length === 0 ? (
                <Card>
                    <CardContent className="pt-4 text-sm text-content-tertiary">
                        {t('notifications.empty', 'No notifications match the current filters.')}
                    </CardContent>
                </Card>
            ) : (
                Object.entries(groupedNotifications).map(([groupLabel, items]) => (
                    <section key={groupLabel} className="grid gap-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">
                            {groupLabel}
                        </div>
                        {items.map((item) => (
                            <Card key={item.id}>
                                <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="grid gap-2">
                                        <div className="flex items-center gap-2">
                                            {!item.is_read && <span className="h-2 w-2 rounded-full bg-accent-primary" />}
                                            <CardTitle className="text-base">{item.title}</CardTitle>
                                            <Badge variant="outline">
                                                {t(FILTER_LABEL_KEYS[(item.type as NotificationType) ?? 'system'], item.type)}
                                            </Badge>
                                        </div>
                                        <p className="text-sm leading-6 text-content-secondary">{item.body}</p>
                                        <div className="text-xs text-content-tertiary">{formatRelative(item.created_at)}</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {!item.is_read && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => markRead.mutate(item.id)}
                                            >
                                                {t('notifications.markRead', 'Mark read')}
                                            </Button>
                                        )}
                                        {item.link && (
                                            <Button
                                                size="sm"
                                                onClick={async () => {
                                                    const destination = item.link;
                                                    if (!destination) return;
                                                    if (!item.is_read) {
                                                        await markRead.mutateAsync(item.id);
                                                    }
                                                    navigate(destination);
                                                }}
                                            >
                                                {t('notifications.open', 'Open')}
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                            </Card>
                        ))}
                    </section>
                ))
            )}
        </div>
    );
}
