import { describe, expect, it } from "vitest";
import { homeAppCards } from "@/app/(platform)/home-apps";
import { refundsApp } from "@/apps/refunds/manifest";
import { registerApps, registeredApps } from "@/platform/apps/registry";
import type { AppManifest } from "@/platform/apps/types";
import { listApprovalRules } from "@/platform/approvals/registry";
import { ROLES } from "@/platform/rbac/roles";
import { buildNavigation } from "@/platform/ui/navigation";
import { fakeUser } from "./helpers";

const ids = (apps: readonly { id: string }[]) => apps.map((a) => a.id);

describe("app registry", () => {
  it("registers every app exactly once", () => {
    expect(registeredApps.length).toBeGreaterThan(0);
    expect(new Set(ids(registeredApps)).size).toBe(registeredApps.length);
    expect(registeredApps.filter((a) => a === refundsApp)).toHaveLength(1);
    expect(Object.isFrozen(registeredApps)).toBe(true);
  });

  it("is idempotent: registering the same manifest again is a no-op", () => {
    expect(registerApps([refundsApp, refundsApp, refundsApp])).toEqual([refundsApp]);
  });

  it("rejects two different manifests with the same id", () => {
    const clash: AppManifest = { ...refundsApp, name: "Refunds v2" };
    expect(() => registerApps([refundsApp, clash])).toThrow('Duplicate app id "refunds"');
  });

  it("registers each app's approval rules once", () => {
    const keys = listApprovalRules().map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("home page app cards", () => {
  for (const role of ROLES) {
    it(`${role}: every registered app the role can open appears exactly once`, () => {
      const user = fakeUser(role);
      const cards = homeAppCards(user);
      const visible = registeredApps.filter((app) => buildNavigation(user).some((s) => s.title === app.name));
      expect(ids(cards)).toEqual(ids(visible));
      expect(new Set(ids(cards)).size).toBe(cards.length);
    });
  }

  it("operator (3 Refunds nav entries) gets a single Refunds card linking to the list", () => {
    expect(homeAppCards(fakeUser("operator"))).toEqual([
      { id: "refunds", name: "Refunds", description: refundsApp.description, href: "/refunds" },
    ]);
  });

  it("links to the first nav entry the user may open, and hides apps with none", () => {
    const app: AppManifest = {
      ...refundsApp,
      id: "test-app",
      nav: [
        { label: "Admin only", href: "/x/admin", permission: "audit:read" },
        { label: "Approvals", href: "/x/approvals", permission: "approval:read" },
      ],
    };
    expect(homeAppCards(fakeUser("viewer"), [app]).map((c) => c.href)).toEqual(["/x/approvals"]);
    expect(homeAppCards(fakeUser(), [app])).toEqual([]);
    expect(homeAppCards(fakeUser("viewer"), registerApps([app, app]))).toHaveLength(1);
  });
});
