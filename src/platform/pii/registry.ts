import { registeredApps } from "@/platform/apps/registry";
import { approvalPayloadPiiResolver } from "@/platform/approvals/pii";
import type { PiiResolver } from "./types";

const resolvers: readonly PiiResolver[] = [
  approvalPayloadPiiResolver,
  ...registeredApps.flatMap((app) => app.piiResolvers ?? []),
];

export function getPiiResolver(entityType: string): PiiResolver | undefined {
  return resolvers.find((resolver) => resolver.entityType === entityType);
}
