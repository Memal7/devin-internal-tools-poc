import { redirect } from "next/navigation";
import { devLoginAction, oidcLoginAction } from "@/platform/auth/actions";
import { OIDC_PROVIDERS, getOidcProviderKey, isDevLoginEnabled } from "@/platform/auth/config";
import { DEMO_USERS } from "@/platform/auth/demo-users";
import { getCurrentUser } from "@/platform/auth/session";
import { RoleBadges } from "@/platform/ui/RoleBadges";

const ERRORS: Record<string, string> = {
  signin: "Sign-in failed. Has the database been seeded (npm run setup)?",
  invalid: "Invalid sign-in request.",
  disabled: "This sign-in method is disabled.",
  AccessDenied: "Your account is not provisioned for this application.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCurrentUser()) redirect("/");
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const error = errorKey ? (ERRORS[errorKey] ?? "Sign-in failed.") : undefined;
  const devLogin = isDevLoginEnabled();
  const oidcKey = getOidcProviderKey();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Internal Tools Kit</h1>
          <p className="text-sm text-slate-600">Sign in to continue.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {oidcKey && (
          <form action={oidcLoginAction}>
            <button type="submit" className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
              Sign in with {OIDC_PROVIDERS[oidcKey].label}
            </button>
          </form>
        )}
        {devLogin && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700">Dev login: pick a demo user</h2>
            <p className="mb-3 text-xs text-slate-500">Local development and review only. Disabled in production.</p>
            <ul className="space-y-2">
              {DEMO_USERS.map((user) => (
                <li key={user.email}>
                  <form action={devLoginAction}>
                    <input type="hidden" name="email" value={user.email} />
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-slate-400 hover:bg-slate-50"
                    >
                      <span>
                        <span className="block text-sm font-medium">{user.email}</span>
                        <span className="block text-xs text-slate-500">{user.note}</span>
                      </span>
                      <RoleBadges roles={user.roles} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!devLogin && !oidcKey && (
          <p className="text-sm text-slate-600">No sign-in method is configured. See .env.example.</p>
        )}
      </div>
    </main>
  );
}
