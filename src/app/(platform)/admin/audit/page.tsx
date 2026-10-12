import type { AuditEvent } from "@prisma/client";
import { AUDIT_FILTERS, AUDIT_SORTABLE, listAuditEvents } from "@/platform/audit/queries";
import { requirePermission } from "@/platform/rbac/enforce";
import { DataTable, type Column } from "@/platform/ui/DataTable";
import { PageHeader } from "@/platform/ui/PageHeader";
import { parseTableParams, type SearchParams } from "@/platform/ui/table-params";

function JsonCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-sky-700">view</summary>
      <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">
        {JSON.stringify(JSON.parse(value), null, 2)}
      </pre>
    </details>
  );
}

const columns: Column<AuditEvent>[] = [
  { key: "createdAt", header: "Time (UTC)", sortable: true, className: "whitespace-nowrap font-mono text-xs", render: (e) => e.createdAt.toISOString() },
  { key: "actorEmail", header: "Actor", sortable: true, render: (e) => e.actorEmail },
  { key: "action", header: "Action", sortable: true, render: (e) => <code className="text-xs">{e.action}</code> },
  { key: "entityType", header: "Entity", sortable: true, render: (e) => <span className="text-xs">{e.entityType}<br /><code className="text-slate-500">{e.entityId}</code></span> },
  { key: "before", header: "Before", render: (e) => <JsonCell value={e.before} /> },
  { key: "after", header: "After", render: (e) => <JsonCell value={e.after} /> },
  { key: "metadata", header: "Metadata", render: (e) => <JsonCell value={e.metadata} /> },
];

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("read", { type: "audit" });
  const params = parseTableParams(await searchParams, {
    sortable: AUDIT_SORTABLE,
    defaultSort: { field: "createdAt", direction: "desc" },
    filters: AUDIT_FILTERS,
    defaultPageSize: 25,
  });
  const { rows, total } = await listAuditEvents(params);
  return (
    <div>
      <PageHeader title="Audit log" description="Append-only. Admin only. PII in snapshots is stored masked." />
      <DataTable basePath="/admin/audit" columns={columns} rows={rows} total={total} params={params} filters={AUDIT_FILTERS} rowKey={(e) => e.id} />
    </div>
  );
}
