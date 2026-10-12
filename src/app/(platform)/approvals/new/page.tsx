import Link from "next/link";
import { createDemoApprovalAction } from "@/platform/approvals/actions";
import { demoPaymentRule } from "@/platform/approvals/rules";
import { requirePermission } from "@/platform/rbac/enforce";
import { EntityForm, type FieldDef } from "@/platform/ui/EntityForm";
import { PageHeader } from "@/platform/ui/PageHeader";

const fields: FieldDef[] = [
  { name: "summary", label: "Summary", type: "text", required: true, placeholder: "Supplier payment for invoice 1234" },
  { name: "amount", label: "Amount", type: "text", inputMode: "decimal", required: true, placeholder: "1500.00", help: "Stored as integer minor units (cents)." },
  { name: "currency", label: "Currency", type: "select", defaultValue: "EUR", options: ["EUR", "USD", "GBP"].map((c) => ({ value: c, label: c })) },
  { name: "beneficiaryName", label: "Beneficiary name (PII)", type: "text", required: true },
  { name: "beneficiaryIban", label: "Beneficiary IBAN (PII)", type: "text", required: true, placeholder: "DE89 3704 0044 0532 0130 00" },
];

export default async function NewDemoApprovalPage() {
  await requirePermission("create", { type: "approval" });
  return (
    <div className="max-w-xl">
      <PageHeader
        title="New demo approval request"
        description={`Platform demo only (no business app yet). Rule ${demoPaymentRule.key}: ${demoPaymentRule.description}`}
        actions={<Link href="/approvals" className="text-sm text-sky-700 hover:underline">Back</Link>}
      />
      <EntityForm fields={fields} action={createDemoApprovalAction} submitLabel="Submit for approval" />
    </div>
  );
}
