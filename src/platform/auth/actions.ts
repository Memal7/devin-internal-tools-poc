"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_LOGIN_PROVIDER_ID, OIDC_PROVIDERS, getOidcProviderKey, isDevLoginEnabled } from "./config";
import { signIn, signOut } from "./index";

const devLoginSchema = z.object({ email: z.email().max(200) });

export async function devLoginAction(formData: FormData): Promise<void> {
  if (!isDevLoginEnabled()) redirect("/login?error=disabled");
  const parsed = devLoginSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/login?error=invalid");
  try {
    await signIn(DEV_LOGIN_PROVIDER_ID, { email: parsed.data.email, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=signin");
    throw error;
  }
}

export async function oidcLoginAction(): Promise<void> {
  const key = getOidcProviderKey();
  if (!key) redirect("/login?error=disabled");
  await signIn(OIDC_PROVIDERS[key].id, { redirectTo: "/" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
