import * as React from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
            {icon && (
                <div className="text-3xl mb-3 text-content-tertiary" aria-hidden="true">
                    {icon}
                </div>
            )}
            <h3 className="text-sm font-medium text-content-secondary">{title}</h3>
            {description && (
                <p className="mt-1 text-xs text-content-tertiary max-w-sm">{description}</p>
            )}
            {action && (
                <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    onClick={action.onClick}
                >
                    {action.label}
                </Button>
            )}
        </div>
    );
}
