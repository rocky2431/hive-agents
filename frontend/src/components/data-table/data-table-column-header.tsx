import type { Column } from '@tanstack/react-table';
import { cn } from '@/lib/cn';

interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
    column: Column<TData, TValue>;
    title: string;
}

export function DataTableColumnHeader<TData, TValue>({
    column,
    title,
    className,
}: DataTableColumnHeaderProps<TData, TValue>) {
    if (!column.getCanSort()) {
        return <div className={cn(className)}>{title}</div>;
    }

    const sorted = column.getIsSorted();

    return (
        <button
            className={cn(
                'flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-content-primary -ml-1 px-1 py-0.5 rounded transition-colors',
                className,
            )}
            onClick={() => column.toggleSorting(sorted === 'asc')}
        >
            {title}
            <span className="text-[10px]" aria-hidden="true">
                {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '⇅'}
            </span>
        </button>
    );
}
