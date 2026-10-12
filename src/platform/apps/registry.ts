import { refundsApp } from "@/apps/refunds/manifest";
import type { AppManifest } from "./types";

/**
 * Idempotent: listing the same manifest more than once registers it once. Two different
 * manifests with the same id are a configuration error.
 */
export function registerApps(apps: readonly AppManifest[]): readonly AppManifest[] {
  const byId = new Map<string, AppManifest>();
  for (const app of apps) {
    const existing = byId.get(app.id);
    if (existing && existing !== app) throw new Error(`Duplicate app id "${app.id}" in the app registry.`);
    byId.set(app.id, app);
  }
  return Object.freeze([...byId.values()]);
}

/**
 * Business apps register here: add the app's manifest (permissions, navigation entry,
 * approval rules, PII resolvers). This is the only platform file an app should touch.
 *
 * Example:
 *   import { kycApp } from "@/apps/kyc/manifest";
 *   export const registeredApps = registerApps([kycApp]);
 */
export const registeredApps: readonly AppManifest[] = registerApps([refundsApp]);
