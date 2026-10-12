import { z } from "zod";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterDef {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "select" | "date";
  readonly options?: readonly FilterOption[];
}

export type SortDirection = "asc" | "desc";

export interface TableConfig {
  sortable: readonly string[];
  defaultSort: { field: string; direction: SortDirection };
  filters: readonly FilterDef[];
  defaultPageSize?: number;
}

export interface TableParams {
  page: number;
  pageSize: number;
  sort: { field: string; direction: SortDirection };
  filters: Record<string, string | undefined>;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;

const RESERVED = new Set(["page", "pageSize", "sort", "dir"]);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Validates table query-string params on the server. Unknown sort fields, filters and
 * select values are dropped, so they can be passed straight into a Prisma query.
 */
export function parseTableParams(searchParams: SearchParams, config: TableConfig): TableParams {
  const page = z.coerce.number().int().min(1).max(100_000).catch(1).parse(first(searchParams.page) ?? 1);
  const pageSize = z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .catch(config.defaultPageSize ?? 25)
    .parse(first(searchParams.pageSize) ?? config.defaultPageSize ?? 25);
  const sortField = first(searchParams.sort);
  const field = sortField && config.sortable.includes(sortField) ? sortField : config.defaultSort.field;
  const dirParam = first(searchParams.dir);
  const direction: SortDirection =
    dirParam === "asc" || dirParam === "desc" ? dirParam : field === sortField ? "asc" : config.defaultSort.direction;

  const filters: Record<string, string | undefined> = {};
  for (const filter of config.filters) {
    if (RESERVED.has(filter.name)) continue;
    const value = first(searchParams[filter.name])?.trim().slice(0, 100);
    if (!value) continue;
    if (filter.type === "select" && !filter.options?.some((option) => option.value === value)) continue;
    if (filter.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    filters[filter.name] = value;
  }
  return { page, pageSize, sort: { field, direction }, filters };
}

export function buildTableHref(basePath: string, params: TableParams, overrides: Partial<TableParams> = {}): string {
  const merged = { ...params, ...overrides, filters: { ...params.filters, ...overrides.filters } };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(merged.filters)) if (value) query.set(name, value);
  query.set("sort", merged.sort.field);
  query.set("dir", merged.sort.direction);
  query.set("pageSize", String(merged.pageSize));
  query.set("page", String(merged.page));
  return `${basePath}?${query.toString()}`;
}
