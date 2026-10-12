import Link from "next/link";
import type { ReactNode } from "react";
import { buildTableHref, PAGE_SIZES, type FilterDef, type TableParams } from "./table-params";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  basePath: string;
  columns: Column<T>[];
  rows: T[];
  total: number;
  params: TableParams;
  filters?: readonly FilterDef[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

/**
 * Server-rendered table. Pagination, filtering and sorting are query-string driven and
 * executed by the server query (see parseTableParams). Works without client JavaScript.
 */
export function DataTable<T>({
  basePath,
  columns,
  rows,
  total,
  params,
  filters = [],
  rowKey,
  emptyMessage = "No results.",
}: DataTableProps<T>) {
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));
  const firstRow = total === 0 ? 0 : (params.page - 1) * params.pageSize + 1;
  const lastRow = Math.min(total, params.page * params.pageSize);

  return (
    <div className="space-y-4">
      {filters.length > 0 && (
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          {filters.map((filter) => (
            <label key={filter.name} className="flex flex-col text-xs font-medium text-slate-600">
              {filter.label}
              {filter.type === "select" ? (
                <select
                  name={filter.name}
                  defaultValue={params.filters[filter.name] ?? ""}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                >
                  <option value="">Any</option>
                  {filter.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={filter.type}
                  name={filter.name}
                  defaultValue={params.filters[filter.name] ?? ""}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              )}
            </label>
          ))}
          <input type="hidden" name="sort" value={params.sort.field} />
          <input type="hidden" name="dir" value={params.sort.direction} />
          <input type="hidden" name="pageSize" value={params.pageSize} />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Apply filters
          </button>
          <Link href={basePath} className="px-2 py-1.5 text-sm text-slate-600 hover:underline">
            Reset
          </Link>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => {
                const active = params.sort.field === column.key;
                const nextDirection = active && params.sort.direction === "asc" ? "desc" : "asc";
                return (
                  <th key={column.key} scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                    {column.sortable ? (
                      <Link
                        href={buildTableHref(basePath, params, { page: 1, sort: { field: column.key, direction: nextDirection } })}
                        className="inline-flex items-center gap-1 hover:underline"
                        aria-sort={active ? (params.sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {column.header}
                        <span aria-hidden className="text-slate-400">
                          {active ? (params.sort.direction === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-2 align-top text-slate-800 ${column.className ?? ""}`}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600" aria-label="Pagination">
        <span>
          {firstRow}–{lastRow} of {total}
        </span>
        <div className="flex items-center gap-2">
          {PAGE_SIZES.map((size) => (
            <Link
              key={size}
              href={buildTableHref(basePath, params, { page: 1, pageSize: size })}
              className={`rounded px-2 py-1 ${size === params.pageSize ? "bg-slate-200 font-semibold" : "hover:bg-slate-100"}`}
            >
              {size}
            </Link>
          ))}
          <span className="mx-2">
            Page {Math.min(params.page, pageCount)} / {pageCount}
          </span>
          {params.page > 1 ? (
            <Link href={buildTableHref(basePath, params, { page: params.page - 1 })} className="rounded border px-2 py-1 hover:bg-slate-100">
              Previous
            </Link>
          ) : (
            <span className="rounded border px-2 py-1 text-slate-300">Previous</span>
          )}
          {params.page < pageCount ? (
            <Link href={buildTableHref(basePath, params, { page: params.page + 1 })} className="rounded border px-2 py-1 hover:bg-slate-100">
              Next
            </Link>
          ) : (
            <span className="rounded border px-2 py-1 text-slate-300">Next</span>
          )}
        </div>
      </nav>
    </div>
  );
}
