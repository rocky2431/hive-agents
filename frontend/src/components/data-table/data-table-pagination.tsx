import type { Table } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
}

export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
    const { t } = useTranslation();
    const pageIndex = table.getState().pagination.pageIndex;
    const pageCount = table.getPageCount();

    if (pageCount <= 1) return null;

    return (
        <div className="flex items-center justify-between px-2 py-3">
            <div className="text-xs text-content-tertiary tabular-nums">
                {t('common.page', 'Page')} {pageIndex + 1} / {pageCount}
                <span className="ml-2">
                    ({table.getFilteredRowModel().rows.length} {t('common.rows', 'rows')})
                </span>
            </div>
            <div className="flex items-center gap-1">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    ←
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    →
                </Button>
            </div>
        </div>
    );
}
