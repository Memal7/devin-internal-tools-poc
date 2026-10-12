import { describe, expect, it } from "vitest";
import type { AppManifest } from "@/platform/apps/types";
import { buildPermissionMatrix, buildResourcePolicies, PLATFORM_PERMISSIONS as P } from "@/platform/rbac/permissions";
import { can, hasPermission } from "@/platform/rbac/policy";
import { ROLES, type Role } from "@/platform/rbac/roles";
import type { AuthUser, Permission } from "@/platform/rbac/types";
import { buildNavigation } from "@/platform/ui/navigation";
import { fakeUser } from "./helpers";

const ALL: Permission[] = Object.values(P);

const EXPECTED: Record<Role, Permission[]> = {
  viewer: [P.platformRead, P.approvalRead],
  operator: [P.platformRead, P.approvalRead, P.approvalCreate, P.piiReveal],
  approver: [P.platformRead, P.approvalRead, P.approvalDecide, P.piiReveal],
  admin: ALL,
};

function split(permission: Permission) {
  const [type, action] = permission.split(":") as [string, string];
  return { type, action };
}

describe("can(): role permission matrix", () => {
  for (const role of ROLES) {
    for (const permission of ALL) {
      const allowed = EXPECTED[role].includes(permission);
      it(`${role} is ${allowed ? "allowed" : "denied"} ${permission}`, () => {
        const { type, action } = split(permission);
        // Use a resource that satisfies resource policies so only the role check matters.
        const resource = { type, attributes: { requesterId: "someone-else" } };
        expect(can(fakeUser(role), action, resource)).toBe(allowed);
      });
    }
  }
});

describe("can(): deny by default", () => {
  it("denies anonymous users", () => {
    expect(can(null, "read", { type: "platform" })).toBe(false);
    expect(can(undefined, "read", { type: "approval" })).toBe(false);
  });

  it("denies users without roles", () => {
    for (const permission of ALL) {
      const { type, action } = split(permission);
      expect(can(fakeUser(), action, { type })).toBe(false);
    }
  });

  it("denies unknown actions and resource types, even for admin", () => {
    const admin = fakeUser("admin");
    expect(can(admin, "delete", { type: "audit" })).toBe(false);
    expect(can(admin, "update", { type: "audit" })).toBe(false);
    expect(can(admin, "read", { type: "unknown-resource" })).toBe(false);
    expect(can(admin, "", { type: "audit" })).toBe(false);
  });

  it("ignores role strings that are not known roles", () => {
    const forged = { ...fakeUser(), roles: ["superuser"] } as unknown as AuthUser;
    expect(can(forged, "read", { type: "audit" })).toBe(false);
  });

  it("only admin can read the audit log", () => {
    for (const role of ROLES) {
      expect(can(fakeUser(role), "read", { type: "audit" })).toBe(role === "admin");
    }
  });

  it("viewer cannot create, decide or reveal anything", () => {
    const viewer = fakeUser("viewer");
    expect(can(viewer, "create", { type: "approval" })).toBe(false);
    expect(can(viewer, "decide", { type: "approval", attributes: { requesterId: "x" } })).toBe(false);
    expect(can(viewer, "reveal", { type: "pii" })).toBe(false);
  });
});

describe("can(): four-eyes resource policy", () => {
  it("denies deciding your own approval request", () => {
    const lead = fakeUser("operator", "approver");
    expect(can(lead, "decide", { type: "approval", attributes: { requesterId: lead.id } })).toBe(false);
    expect(can(lead, "decide", { type: "approval", attributes: { requesterId: "other-user" } })).toBe(true);
  });

  it("denies deciding when the requester is unknown", () => {
    expect(can(fakeUser("approver"), "decide", { type: "approval" })).toBe(false);
  });

  it("applies to admins too", () => {
    const admin = fakeUser("admin");
    expect(can(admin, "decide", { type: "approval", attributes: { requesterId: admin.id } })).toBe(false);
  });
});

describe("app registration", () => {
  const app: AppManifest = {
    id: "demo",
    name: "Demo app",
    description: "test",
    nav: [{ label: "Demo", href: "/demo", permission: "demo:read" }],
    rolePermissions: { operator: ["demo:read", "demo:create"], viewer: ["demo:read"] },
    resourcePolicies: { "demo:create": (user, resource) => resource.attributes?.ownerId === user.id },
  };
  const config = { matrix: buildPermissionMatrix([app]), resourcePolicies: buildResourcePolicies([app]) };

  it("merges app permissions with platform permissions", () => {
    expect(hasPermission(fakeUser("viewer"), "demo:read", config)).toBe(true);
    expect(hasPermission(fakeUser("viewer"), "demo:create", config)).toBe(false);
    expect(hasPermission(fakeUser("approver"), "demo:read", config)).toBe(false);
    expect(hasPermission(fakeUser("viewer"), P.platformRead, config)).toBe(true);
  });

  it("applies app resource policies", () => {
    const op = fakeUser("operator");
    expect(can(op, "create", { type: "demo", attributes: { ownerId: op.id } }, config)).toBe(true);
    expect(can(op, "create", { type: "demo", attributes: { ownerId: "other" } }, config)).toBe(false);
  });

  it("shows app navigation only to permitted users", () => {
    const titles = (roles: Role[]) => buildNavigation(fakeUser(...roles), [app]).map((s) => s.title);
    expect(titles(["viewer"])).toContain("Demo app");
    expect(titles(["approver"])).not.toContain("Demo app");
  });

  it("shows the audit log link only to admins", () => {
    const hrefs = (role: Role) => buildNavigation(fakeUser(role), []).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs("admin")).toContain("/admin/audit");
    for (const role of ["viewer", "operator", "approver"] as const) expect(hrefs(role)).not.toContain("/admin/audit");
  });
});
