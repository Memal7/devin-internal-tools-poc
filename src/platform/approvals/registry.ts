import { registeredApps } from "@/platform/apps/registry";
import { demoPaymentRule, type ApprovalRule } from "./rules";

const rules: readonly ApprovalRule[] = [demoPaymentRule, ...registeredApps.flatMap((app) => app.approvalRules ?? [])];

export function getApprovalRule(key: string): ApprovalRule | undefined {
  return rules.find((rule) => rule.key === key);
}

export function listApprovalRules(): readonly ApprovalRule[] {
  return rules;
}
