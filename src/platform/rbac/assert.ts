import { AuthenticationError, AuthorizationError } from "@/platform/errors";
import { can } from "./policy";
import type { AuthUser, Resource } from "./types";

/** Throws unless `can(user, action, resource)` allows it. Use in services. */
export function assertCan(
  user: AuthUser | null | undefined,
  action: string,
  resource: Resource,
  message?: string,
): asserts user is AuthUser {
  if (!user) throw new AuthenticationError();
  if (!can(user, action, resource)) throw new AuthorizationError(message);
}
