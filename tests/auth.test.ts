import { describe, expect, it } from "vitest";
import { buildProviders, getOidcProviderKey, isDevLoginEnabled } from "@/platform/auth/config";
import { authorizeDevLogin } from "@/platform/auth/dev-login";
import type { Provider } from "next-auth/providers";
import { createUser } from "./helpers";

// Provider factories keep user overrides (like a custom id) in `options` until Auth.js merges them.
function providerIds(providers: Provider[]): string[] {
  return providers.map((p) => {
    const resolved = typeof p === "function" ? p() : p;
    const options = (resolved as { options?: { id?: string } }).options;
    return options?.id ?? resolved.id;
  });
}

const devEnv = { AUTH_DEV_LOGIN_ENABLED: "true", NODE_ENV: "development" };
const noop = async () => null;

describe("auth configuration", () => {
  it("dev login is opt-in and never enabled in production", () => {
    expect(isDevLoginEnabled(devEnv)).toBe(true);
    expect(isDevLoginEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDevLoginEnabled({ AUTH_DEV_LOGIN_ENABLED: "true", NODE_ENV: "production" })).toBe(false);
  });

  it("OIDC is disabled by default", () => {
    expect(getOidcProviderKey({})).toBeNull();
    expect(getOidcProviderKey({ AUTH_OIDC_PROVIDER: "none" })).toBeNull();
    expect(buildProviders(noop, {}).length).toBe(0);
  });

  it("switches to Entra ID or Okta via env vars only", () => {
    const entra = buildProviders(noop, {
      AUTH_OIDC_PROVIDER: "entra",
      AUTH_MICROSOFT_ENTRA_ID_ID: "id",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "secret",
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
    });
    expect(providerIds(entra)).toEqual(["microsoft-entra-id"]);
    const okta = buildProviders(noop, {
      ...devEnv,
      AUTH_OIDC_PROVIDER: "okta",
      AUTH_OKTA_ID: "id",
      AUTH_OKTA_SECRET: "secret",
      AUTH_OKTA_ISSUER: "https://example.okta.com/oauth2/default",
    });
    expect(providerIds(okta)).toEqual(["dev-login", "okta"]);
  });

  it("fails fast on incomplete or unknown OIDC configuration", () => {
    expect(() => buildProviders(noop, { AUTH_OIDC_PROVIDER: "okta", AUTH_OKTA_ID: "id" })).toThrow(/AUTH_OKTA_SECRET/);
    expect(() => getOidcProviderKey({ AUTH_OIDC_PROVIDER: "github" })).toThrow();
  });
});

describe("dev login", () => {
  it("signs in an existing user", async () => {
    const user = await createUser("viewer");
    expect(await authorizeDevLogin({ email: user.email }, devEnv)).toEqual({ id: user.id, email: user.email, name: user.name });
  });

  it("rejects unknown users, invalid input and disabled dev login", async () => {
    const user = await createUser("viewer");
    expect(await authorizeDevLogin({ email: "nobody@test.local" }, devEnv)).toBeNull();
    expect(await authorizeDevLogin({ email: "not-an-email" }, devEnv)).toBeNull();
    expect(await authorizeDevLogin({}, devEnv)).toBeNull();
    expect(await authorizeDevLogin({ email: user.email }, { NODE_ENV: "production", AUTH_DEV_LOGIN_ENABLED: "true" })).toBeNull();
  });
});
