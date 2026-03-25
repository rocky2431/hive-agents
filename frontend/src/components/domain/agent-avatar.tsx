import { cn } from '@/lib/cn';
import type { AgentStatus } from '@/types';
import { AGENT_STATUS_CONFIG } from '@/lib/constants';

interface AgentAvatarProps {
    name: string;
    avatarUrl?: string;
    status?: AgentStatus;
    size?: 'sm' | 'md' | 'lg';
    showStatusDot?: boolean;
    className?: string;
}

const sizeMap = {
    sm: { container: 'h-6 w-6 text-[10px]', dot: 'h-2 w-2 -bottom-0.5 -right-0.5 border' },
    md: { container: 'h-8 w-8 text-xs', dot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5 border-2' },
    lg: { container: 'h-12 w-12 text-sm', dot: 'h-3 w-3 bottom-0 right-0 border-2' },
};

function getInitials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

export function AgentAvatar({ name, avatarUrl, status, size = 'md', showStatusDot = false, className }: AgentAvatarProps) {
    const s = sizeMap[size];
    const statusConfig = status ? AGENT_STATUS_CONFIG[status] : undefined;

    return (
        <div className={cn('relative inline-flex shrink-0', className)}>
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={`${name} avatar`}
                    className={cn('rounded-full object-cover', s.container)}
                />
            ) : (
                <div
                    className={cn(
                        'rounded-full flex items-center justify-center font-semibold bg-surface-hover text-content-secondary',
                        s.container,
                    )}
                    aria-label={`${name} avatar`}
                >
                    {getInitials(name)}
                </div>
            )}
            {showStatusDot && statusConfig && (
                <span
                    className={cn('absolute rounded-full border-surface-secondary', s.dot)}
                    style={{ backgroundColor: statusConfig.dotColor }}
                    aria-label={statusConfig.label}
                />
            )}
        </div>
    );
}
