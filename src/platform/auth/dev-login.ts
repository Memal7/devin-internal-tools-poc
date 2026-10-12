import { z } from "zod";
import { isDevLoginEnabled, type Env } from "./config";
import { findAuthUserByEmail } from "./users";

const devLoginSchema = z.object({ email: z.email().max(200) });

/** Signs in an existing seeded user by email. No passwords: dev and review only. */
export async function authorizeDevLogin(
  credentials: Partial<Record<"email", unknown>>,
  env: Env = process.env,
): Promise<{ id: string; email: string; name: string } | null> {
  if (!isDevLoginEnabled(env)) return null;
  const parsed = devLoginSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const user = await findAuthUserByEmail(parsed.data.email);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name };
}
