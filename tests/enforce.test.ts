import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthUser } from "@/platform/rbac/types";
import { fakeUser } from "./helpers";

const session = vi.hoisted(() => ({ user: null as AuthUser | null }));

vi.mock("@/platform/auth/session", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { requirePermission, requireUser, secureAction, withApiPermission } = await import("@/platform/rbac/enforce");

beforeEach(() => {
  session.user = null;
});

describe("requirePermission (pages)", () => {
  it("redirects anonymous users to /login", async () => {
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    await expect(requirePermission("read", { type: "audit" })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects users without the permission to /forbidden", async () => {
    for (const role of ["viewer", "operator", "approver"] as const) {
      session.user = fakeUser(role);
      await expect(requirePermission("read", { type: "audit" })).rejects.toThrow("REDIRECT:/forbidden");
    }
  });

  it("returns the user when allowed", async () => {
    session.user = fakeUser("admin");
    await expect(requirePermission("read", { type: "audit" })).resolves.toEqual(session.user);
  });
});

describe("withApiPermission (API routes)", () => {
  const handler = withApiPermission("create", { type: "approval" }, async () => Response.json({ ok: true }));
  const call = () => handler(new Request("http://localhost/api/test"), {});

  it("returns 401 when signed out", async () => {
    expect((await call()).status).toBe(401);
  });

  it("returns 403 for roles without the permission", async () => {
    for (const role of ["viewer", "approver"] as const) {
      session.user = fakeUser(role);
      expect((await call()).status).toBe(403);
    }
  });

  it("runs the handler when allowed", async () => {
    session.user = fakeUser("operator");
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("secureAction (server actions)", () => {
  const handlerSpy = vi.fn(async ({ input }: { input: { amount: number } }) => input.amount * 2);
  const action = secureAction({
    schema: z.object({ amount: z.number().int().positive() }),
    action: "create",
    resource: () => ({ type: "approval" }),
    handler: handlerSpy,
  });

  beforeEach(() => {
    handlerSpy.mockClear();
  });

  it("rejects anonymous calls without running the handler", async () => {
    expect(await action({ amount: 1 })).toMatchObject({ ok: false });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("rejects users without the permission", async () => {
    session.user = fakeUser("viewer");
    expect(await action({ amount: 1 })).toEqual({ ok: false, error: "You are not allowed to do this." });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("validates input with Zod before running the handler", async () => {
    session.user = fakeUser("operator");
    const result = await action({ amount: -5 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.amount).toBeTruthy();
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("runs the handler when allowed and valid", async () => {
    session.user = fakeUser("operator");
    expect(await action({ amount: 21 })).toEqual({ ok: true, data: 42 });
  });
});
