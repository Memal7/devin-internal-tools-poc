import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Okta from "next-auth/providers/okta";

export type Env = Record<string, string | undefined>;

export const DEV_LOGIN_PROVIDER_ID = "dev-login";

export const OIDC_PROVIDERS = {
  entra: { id: "microsoft-entra-id", label: "Microsoft Entra ID", prefix: "AUTH_MICROSOFT_ENTRA_ID" },
  okta: { id: "okta", label: "Okta", prefix: "AUTH_OKTA" },
} as const;

export type OidcProviderKey = keyof typeof OIDC_PROVIDERS;

/** The dev login is opt-in via env and is never available in production builds. */
export function isDevLoginEnabled(env: Env = process.env): boolean {
  return env.AUTH_DEV_LOGIN_ENABLED === "true" && env.NODE_ENV !== "production";
}

/** Returns the configured OIDC provider, or null when SSO is disabled (the default). */
export function getOidcProviderKey(env: Env = process.env): OidcProviderKey | null {
  const value = (env.AUTH_OIDC_PROVIDER ?? "none").trim().toLowerCase();
  if (value === "" || value === "none") return null;
  if (value === "entra" || value === "okta") return value;
  throw new Error(`Invalid AUTH_OIDC_PROVIDER "${value}". Use none, entra or okta.`);
}

function requiredOidcEnv(env: Env, key: OidcProviderKey) {
  const { prefix } = OIDC_PROVIDERS[key];
  const names = [`${prefix}_ID`, `${prefix}_SECRET`, `${prefix}_ISSUER`] as const;
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`AUTH_OIDC_PROVIDER=${key} requires ${missing.join(", ")}`);
  }
  return { clientId: env[names[0]] as string, clientSecret: env[names[1]] as string, issuer: env[names[2]] as string };
}

export function buildOidcProvider(env: Env = process.env): Provider | null {
  const key = getOidcProviderKey(env);
  if (!key) return null;
  const options = requiredOidcEnv(env, key);
  return key === "entra" ? MicrosoftEntraID(options) : Okta(options);
}

export function buildProviders(
  authorizeDevLogin: (credentials: Partial<Record<"email", unknown>>) => Promise<{ id: string; email: string; name: string } | null>,
  env: Env = process.env,
): Provider[] {
  const providers: Provider[] = [];
  if (isDevLoginEnabled(env)) {
    providers.push(
      Credentials({
        id: DEV_LOGIN_PROVIDER_ID,
        name: "Demo user",
        credentials: { email: { label: "Email", type: "email" } },
        authorize: (credentials) => authorizeDevLogin(credentials),
      }),
    );
  }
  const oidc = buildOidcProvider(env);
  if (oidc) providers.push(oidc);
  return providers;
}
