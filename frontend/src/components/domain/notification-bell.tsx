import { useNavigate } from 'react-router-dom';
import { useUnreadCount } from '@/services/queries/notification.queries';
import { cn } from '@/lib/cn';

interface NotificationBellProps {
    className?: string;
}

export function NotificationBell({ className }: NotificationBellProps) {
    const navigate = useNavigate();
    const { data: unreadCount = 0 } = useUnreadCount();

    return (
        <button
            onClick={() => navigate('/notifications')}
            className={cn(
                'relative rounded-md p-1.5 text-content-secondary hover:bg-surface-hover hover:text-content-primary transition-colors',
                className,
            )}
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6a4 4 0 018 0c0 2 1 3.5 1.5 4.5H2.5C3 9.5 4 8 4 6z" />
                <path d="M6.5 12.5a1.5 1.5 0 003 0" />
            </svg>
            {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    );
}
