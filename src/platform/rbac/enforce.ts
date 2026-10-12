import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getCurrentUser } from "@/platform/auth/session";
import { isPlatformError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError } from "@/platform/errors";
import { can, hasPermission, permissionFor } from "./policy";
import type { AuthUser, Resource } from "./types";

/** Pages: returns the signed-in user, or redirects to /login. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Pages: returns the user if allowed, otherwise redirects to /login or /forbidden. */
export async function requirePermission(action: string, resource: Resource): Promise<AuthUser> {
  const user = await requireUser();
  if (!can(user, action, resource)) redirect("/forbidden");
  return user;
}

type RouteHandler<C> = (request: Request, context: C) => Promise<Response>;

/** API routes: 401 when signed out, 403 when `can()` denies, otherwise runs the handler. */
export function withApiPermission<C>(
  action: string,
  resource: Resource | ((request: Request, context: C) => Resource | Promise<Resource>),
  handler: (args: { request: Request; context: C; user: AuthUser }) => Promise<Response>,
): RouteHandler<C> {
  return async (request, context) => {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    const target = typeof resource === "function" ? await resource(request, context) : resource;
    if (!can(user, action, target)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
      return await handler({ request, context, user });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export interface SecureActionConfig<S extends z.ZodType, T> {
  schema: S;
  action: string;
  resource: (input: z.infer<S>) => Resource | Promise<Resource>;
  /**
   * "full" (default) runs can() including resource policies. "role" checks only the role
   * permission; use it when the service enforces the resource policy against the stored
   * record itself (e.g. four-eyes in decideApproval, which also audits blocked attempts).
   */
  check?: "full" | "role";
  handler: (args: { user: AuthUser; input: z.infer<S> }) => Promise<T>;
}

/**
 * Server actions: validates input with Zod, then calls `can()` on the server, then runs
 * the handler. Services should still call `assertCan()` for defense in depth.
 */
export function secureAction<S extends z.ZodType, T>(config: SecureActionConfig<S, T>) {
  return async (rawInput: unknown): Promise<ActionResult<T>> => {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: new AuthenticationError().message };
    const parsed = config.schema.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    const resource = await config.resource(parsed.data);
    const allowed =
      config.check === "role"
        ? hasPermission(user, permissionFor(config.action, resource))
        : can(user, config.action, resource);
    if (!allowed) return { ok: false, error: new AuthorizationError().message };
    try {
      return { ok: true, data: await config.handler({ user, input: parsed.data }) };
    } catch (error) {
      if (isPlatformError(error)) return { ok: false, error: error.message };
      console.error("secureAction failed", error instanceof Error ? error.name : "unknown error");
      return { ok: false, error: "Something went wrong." };
    }
  };
}

export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) result[key] = value;
  }
  return result;
}
