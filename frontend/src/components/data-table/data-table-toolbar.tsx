import type { Table } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    searchColumn?: string;
    searchPlaceholder?: string;
    actions?: React.ReactNode;
}

export function DataTableToolbar<TData>({
    table,
    searchColumn,
    searchPlaceholder,
    actions,
}: DataTableToolbarProps<TData>) {
    const { t } = useTranslation();
    const column = searchColumn ? table.getColumn(searchColumn) : undefined;

    return (
        <div className="flex items-center justify-between gap-3 pb-3">
            {column && (
                <Input
                    placeholder={searchPlaceholder || t('common.search', 'Search...')}
                    value={(column.getFilterValue() as string) ?? ''}
                    onChange={(e) => column.setFilterValue(e.target.value)}
                    className="max-w-xs"
                />
            )}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}
