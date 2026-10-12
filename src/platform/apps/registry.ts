import { refundsApp } from "@/apps/refunds/manifest";
import type { AppManifest } from "./types";

/**
 * Business apps register here: add the app's manifest (permissions, navigation entry,
 * approval rules, PII resolvers). This is the only platform file an app should touch.
 *
 * Example:
 *   import { kycApp } from "@/apps/kyc/manifest";
 *   export const registeredApps: readonly AppManifest[] = [kycApp];
 */
export const registeredApps: readonly AppManifest[] = [refundsApp];
