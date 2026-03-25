import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { messageApi } from '../services/api';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/domain/empty-state';
import { formatRelative } from '@/lib/date';

const ACTION_ICONS: Record<string, string> = {
    agent: '🤖',
};

export default function Messages() {
    const { t } = useTranslation();
    const { data: messages = [], isLoading } = useQuery({
        queryKey: ['messages-inbox'],
        queryFn: () => messageApi.inbox(100),
        refetchInterval: 15000,
    });

    return (
        <div className="mx-auto max-w-3xl p-6">
            <div className="mb-5 flex items-center justify-between">
                <h1 className="text-xl font-semibold">{t('messages.title')}</h1>
            </div>

            {isLoading && (
                <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-20 w-full rounded-lg" />
                    ))}
                </div>
            )}

            {!isLoading && messages.length === 0 && (
                <EmptyState
                    icon="📭"
                    title={t('messages.empty', 'No messages yet')}
                />
            )}

            <div className="flex flex-col gap-0.5">
                {messages.map((msg: any) => (
                    <div
                        key={msg.id}
                        className="rounded-lg border-l-3 border-l-edge-subtle bg-surface-primary/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
                    >
                        <div className="mb-1.5 flex items-center gap-2">
                            <span className="text-sm">{ACTION_ICONS[msg.sender_type] || '·'}</span>
                            <span className="text-sm font-semibold text-content-primary">
                                {msg.sender_name}
                            </span>
                            {msg.session_title && (
                                <Badge variant="secondary" className="text-[11px]">
                                    {msg.session_title}
                                </Badge>
                            )}
                            <span className="ml-auto text-xs text-content-tertiary tabular-nums">
                                {formatRelative(msg.created_at)}
                            </span>
                        </div>
                        <div className="line-clamp-2 text-sm leading-relaxed text-content-secondary whitespace-pre-wrap">
                            {msg.content}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
