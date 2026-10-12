import { cache } from "react";
import type { AuthUser } from "@/platform/rbac/types";
import { auth } from "./index";
import { findAuthUserById } from "./users";

/**
 * The signed-in user with roles loaded fresh from the database, so role changes apply
 * immediately. Returns null when signed out or when the user no longer exists.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return findAuthUserById(id);
});
