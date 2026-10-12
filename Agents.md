# AGENTS.md — Internal Tools Kit

## What this repo is
A proof-of-concept "internal tools kit" for a fintech company (payments,
refunds, KYC). It has two layers:

1. Platform layer (`src/platform/`): authentication, role-based access
   control, audit log, approvals (four-eyes), PII masking, shared UI
   components.
2. Apps (`src/apps/<app-name>/`): business tools built on the platform,
   e.g. `refunds` and `kyc`.

New apps must reuse the platform layer. Never re-implement auth, audit,
approvals or PII masking inside an app.

## Tech stack (do not change without asking)
- Next.js (App Router) with TypeScript in strict mode
- Prisma ORM with SQLite for local development (`prisma/schema.prisma`).
  Keep the schema portable to PostgreSQL: no SQLite-only features.
- Auth.js for authentication: a seeded dev login (one user per role) now;
  an OIDC provider (Entra ID or Okta) must be enableable via env vars only.
- Zod for server-side input validation
- Tailwind CSS for styling
- Vitest for tests
- GitHub Actions for CI

## Commands (keep these script names stable; README and CI depend on them)
- `npm run setup`: install dependencies, run migrations, seed demo data
- `npm run dev`: start the app at http://localhost:3000
- `npm run lint`
- `npm run typecheck`
- `npm test`

## Folder layout
- `src/platform/auth/`: login and session handling
- `src/platform/rbac/`: roles, permissions, the `can()` policy function
- `src/platform/audit/`: `withAudit()` and the audit log viewer
- `src/platform/approvals/`: generic four-eyes approval workflow
- `src/platform/pii/`: `maskPII()` and audited reveal
- `src/platform/ui/`: shared `DataTable` and `EntityForm` components
- `src/apps/<app-name>/`: one folder per business app
- `prisma/`: database schema, migrations, seed script
- `docs/specs/`: short specs for new apps
- `.agents/skills/`: reusable Devin procedures

## Security rules (mandatory: this is a regulated fintech)
1. Deny by default. Every page, API route and server action calls
   `can(user, action, resource)` on the server before reading or writing
   business data. Hiding a button in the UI is not access control.
2. Roles: `viewer` (read only), `operator` (create and work on items),
   `approver` (approve or reject), `admin` (manage users, view audit log).
   A user can have several roles.
3. Audit every change. Every create, update and delete goes through
   `withAudit()`, which records actor, action, entity type, entity id,
   before/after JSON and a UTC timestamp. The `audit_events` table is
   append-only: no update or delete code paths, ever, including in seed
   scripts and tests.
4. Four-eyes principle. When a rule requires approval, the approver must be
   a different user from the requester. Enforce this on the server and
   cover it with tests.
5. PII. Customer names, dates of birth, document numbers, IBANs and card
   data are masked by default with `maskPII()`. Revealing a value requires
   the `pii:reveal` permission and writes an audit event. Never put PII in
   logs or error messages.
6. No secrets in code. Read configuration from environment variables and
   keep a `.env.example` with dummy values only.
7. Validate all input on the server with Zod.
8. Avoid new dependencies. Justify any new dependency in the PR description.

## Coding conventions
- TypeScript strict mode; do not use `any`.
- Store money as integer minor units (cents) plus a currency code. Never
  use floating-point numbers for money.
- Store and compare all timestamps in UTC.
- Use the shared `DataTable` (server-side pagination, filtering, sorting)
  and `EntityForm`. Do not add other UI component libraries.
- Prefer small, focused files with descriptive names.

## Testing
Every PR must include tests for:
- authorization: each role is denied what it should not be able to do
- approval rules, including that self-approval is blocked
- audit events being written for each data change

Seed one demo user per role so a reviewer can log in and click through.

## Pull requests
- Create a branch from `main`; one PR per task. Never push to `main`.
- Before opening a PR, run `npm run lint`, `npm run typecheck` and
  `npm test`. All must pass.
- Start the app and check the main user flow in the browser.
- Fill in the PR template checklist. Explain design decisions and list
  anything you did not finish.

## Do not
- Do not modify `src/platform/` while building an app, except to register
  the app's permissions and navigation entry.
- Do not weaken or skip a security rule to make a test pass. Stop and ask.
- Do not commit `.env` files, database files (`*.db`) or build output.
