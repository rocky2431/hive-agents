import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/format';

interface TokenUsageBarProps {
    used: number;
    max?: number;
    label: string;
    variant?: 'compact' | 'full';
    className?: string;
}

export function TokenUsageBar({ used, max, label, variant = 'full', className }: TokenUsageBarProps) {
    const percentage = max && max > 0 ? Math.min((used / max) * 100, 100) : 0;
    const isHigh = percentage > 80;
    const isMedium = percentage > 50;

    const barColor = isHigh ? 'bg-error' : isMedium ? 'bg-warning' : 'bg-success';

    if (variant === 'compact') {
        return (
            <div className={cn('flex items-center gap-2 text-xs tabular-nums', className)}>
                <span className="text-content-secondary">{label}</span>
                <span className="font-medium text-content-primary">{formatTokens(used)}</span>
                {max != null && (
                    <span className="text-content-tertiary">/ {formatTokens(max)}</span>
                )}
            </div>
        );
    }

    return (
        <div className={cn('space-y-1', className)}>
            <div className="flex items-center justify-between text-xs">
                <span className="text-content-secondary">{label}</span>
                <span className="tabular-nums font-medium text-content-primary">
                    {formatTokens(used)}
                    {max != null && <span className="text-content-tertiary"> / {formatTokens(max)}</span>}
                </span>
            </div>
            {max != null && max > 0 && (
                <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
                    <div
                        className={cn('h-full rounded-full transition-all', barColor)}
                        style={{ width: `${percentage}%` }}
                        role="progressbar"
                        aria-valuenow={used}
                        aria-valuemax={max}
                        aria-label={`${label}: ${formatTokens(used)} of ${formatTokens(max)}`}
                    />
                </div>
            )}
        </div>
    );
}
