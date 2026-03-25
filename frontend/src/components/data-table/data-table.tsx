import {
    type ColumnDef,
    type ColumnFiltersState,
    type SortingState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import { VList } from 'virtua';
import { cn } from '@/lib/cn';
import { DataTablePagination } from './data-table-pagination';

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    searchColumn?: string;
    searchPlaceholder?: string;
    pageSize?: number;
    virtualizeThreshold?: number;
    toolbar?: React.ReactNode;
    emptyMessage?: string;
    className?: string;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    pageSize = 20,
    virtualizeThreshold = 50,
    toolbar,
    emptyMessage = 'No results.',
    className,
}: DataTableProps<TData, TValue>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

    const useVirtual = data.length > virtualizeThreshold;

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: useVirtual ? undefined : getPaginationRowModel(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        state: { sorting, columnFilters, ...(useVirtual ? {} : { pagination: { pageIndex: 0, pageSize } }) },
    });

    const rows = table.getRowModel().rows;

    return (
        <div className={cn('w-full', className)}>
            {toolbar}

            <div className="rounded-lg border border-edge-default overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-surface-secondary">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        scope="col"
                                        className="px-3 py-2 text-left text-xs font-medium text-content-secondary"
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(header.column.columnDef.header, header.getContext())}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                </table>

                {rows.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-content-tertiary">
                        {emptyMessage}
                    </div>
                ) : useVirtual ? (
                    <VList style={{ height: Math.min(rows.length * 44, 600) }}>
                        {rows.map((row) => (
                            <div
                                key={row.id}
                                className="flex border-b border-edge-subtle last:border-0 hover:bg-surface-hover transition-colors"
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <div key={cell.id} className="flex-1 px-3 py-2.5 text-sm text-content-primary">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </VList>
                ) : (
                    <table className="w-full text-sm">
                        <tbody>
                            {rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className="border-b border-edge-subtle last:border-0 hover:bg-surface-hover transition-colors"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className="px-3 py-2.5 text-content-primary">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {!useVirtual && <DataTablePagination table={table} />}
        </div>
    );
}
