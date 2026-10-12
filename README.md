# Internal Tools Kit (PoC)

A governed platform layer for fintech operations tools (payments, refunds, KYC). It provides the
security and workflow primitives that business apps build on: authentication, deny-by-default
RBAC, an append-only audit log, four-eyes approvals, PII masking and shared UI.

> This repository currently contains **only the platform layer**. No business app (refunds, KYC, …)
> is registered yet; see `docs/specs/` for upcoming apps.

## Run it

Requirements: Node.js 20.18+ (22 recommended).

```bash
npm run setup   # install deps, create .env (random AUTH_SECRET), migrate + seed SQLite
npm run dev     # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`.

## Demo users

The dev login page (`/login`) lets you pick a seeded user. Dev login is enabled by
`AUTH_DEV_LOGIN_ENABLED=true` and is always disabled when `NODE_ENV=production`.

| Email                 | Roles               | What to try                                                       |
| --------------------- | ------------------- | ----------------------------------------------------------------- |
| `viewer@demo.local`   | viewer              | Read-only: approvals list, PII stays masked, no audit log         |
| `operator@demo.local` | operator            | Create approval requests, reveal PII (audited)                    |
| `approver@demo.local` | approver            | Approve/decline requests created by others                        |
| `lead@demo.local`     | operator + approver | Create a request, then try to approve it: blocked (four-eyes)     |
| `admin@demo.local`    | admin               | Everything, including the audit log at `/admin/audit`             |

## Single sign-on (optional)

OIDC is disabled by default and switched on via env vars only (see `.env.example`):

- `AUTH_OIDC_PROVIDER=entra` + `AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER`
- `AUTH_OIDC_PROVIDER=okta` + `AUTH_OKTA_ID/SECRET/ISSUER`

OIDC users must already exist in the `users` table (roles are assigned there, not by the IdP).

## Architecture

```
src/
  app/                 Next.js App Router pages, API routes (thin, call platform modules)
  platform/
    auth/              Auth.js config, dev login, optional Entra ID / Okta, session -> AuthUser
    rbac/              roles + permissions, can(user, action, resource), requirePermission (pages),
                       withApiPermission (API routes), secureAction (server actions, Zod-validated)
    audit/             withAudit() (mutation + audit event in one transaction), audit queries
    approvals/         generic approval requests, threshold rules, four-eyes enforcement
    pii/               maskPII(), field registry, audited revealPII() (requires pii:reveal)
    ui/                AppShell + navigation, DataTable (server-side paging/filter/sort), EntityForm
    apps/              app registry: future apps register nav, permissions, approval rules, PII fields
prisma/                schema (SQLite locally, PostgreSQL-portable), migrations, seed
tests/                 Vitest: authorization, approvals (incl. self-approval), audit, PII, auth config
```

Key rules (see `Agents.md`):

- **Deny by default.** `can()` returns `false` unless a role grants `<resource>:<action>` and every
  resource policy (e.g. four-eyes) allows it. Every page, API route and server action checks on the server.
- **Audit everything.** Every create/update/delete goes through `withAudit()`, which writes actor,
  action, entity, before/after (PII masked) and a UTC timestamp. `audit_events` is append-only,
  enforced by a Prisma client guard and database triggers.
- **Four-eyes.** `decideApproval()` rejects decisions by the requester (even admins) and audits the attempt.
- **PII masked by default.** Reveals require `pii:reveal` and are audited (field only, never the value).
- **Money** is stored as integer minor units plus an ISO 4217 currency code.

### Adding an app

Create `src/apps/<name>/` and add an `AppManifest` to `src/platform/apps/registry.ts` with its
navigation, role permissions, resource policies, approval rules and PII resolvers. Use the shared
`DataTable`/`EntityForm`, `requirePermission`/`secureAction` and `withAudit()`.
