import { NextResponse } from "next/server";
import { APPROVAL_FILTERS, APPROVAL_SORTABLE, listApprovalRequests } from "@/platform/approvals/queries";
import { getApprovalRule } from "@/platform/approvals/registry";
import { maskObject } from "@/platform/pii/mask";
import { withApiPermission } from "@/platform/rbac/enforce";
import { parseTableParams } from "@/platform/ui/table-params";

/** JSON list of approval requests. PII in payloads is always masked here. */
export const GET = withApiPermission("read", { type: "approval" }, async ({ request, user }) => {
  const url = new URL(request.url);
  const params = parseTableParams(Object.fromEntries(url.searchParams), {
    sortable: APPROVAL_SORTABLE,
    defaultSort: { field: "createdAt", direction: "desc" },
    filters: APPROVAL_FILTERS,
  });
  const { rows, total } = await listApprovalRequests(user, params);
  const data = rows.map((row) => ({
    ...row,
    payload: maskObject(JSON.parse(row.payload) as Record<string, unknown>, getApprovalRule(row.ruleKey)?.payloadPiiFields ?? {}),
  }));
  return NextResponse.json({ data, total, page: params.page, pageSize: params.pageSize });
});
