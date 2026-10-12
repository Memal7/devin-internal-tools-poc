> How this was built with Devin, with time, usage and findings per session: [docs/devin-log.md](docs/devin-log.md)

# Internal Tools Kit (PoC)

A governed platform layer for fintech operations tools (payments, refunds, KYC). It provides the
security and workflow primitives that business apps build on: authentication, deny-by-default
RBAC, an append-only audit log, four-eyes approvals, PII masking and shared UI.

> Registered business apps: **Refunds** (`src/apps/refunds/`) and **KYC Review Queue** (`src/apps/kyc/`), see below. Upcoming apps are
> specified in `docs/specs/`.

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

## Refunds

`src/apps/refunds/` is the first business app on the platform layer. It is registered in
`src/platform/apps/registry.ts` (navigation, permissions, four-eyes policy, approval rule, PII resolver).

- **Data.** `payments` (customer name = PII, amount in cents, currency, status, created at, amount
  already reserved for refunds) and `refunds` (payment, amount in cents, reason, status, requested by,
  decided by, decision reason, timestamps). The seed creates 300 deterministic EUR payments plus demo refunds.
- **Statuses.** `requested` → `approved` / `declined`, or `auto_approved` straight away.
- **Rules.**
  - Total refunds per payment (including ones still awaiting approval) can never exceed the payment
    amount. The amount is reserved atomically (`UPDATE … WHERE refundedMinor <= amount - refund`) so
    concurrent requests cannot over-refund; a declined refund releases its reservation.
  - Up to **500.00 EUR (50 000 cents)** a refund is auto-approved. Above that, a platform approval
    request is created via `amountThresholdRule` (rule `refunds.refund`; other currencies always need approval).
  - Only an approver who is **not the requester** can approve or decline (four-eyes, enforced by an
    app resource policy, by the refund service and by the platform approvals module). Declining needs a reason.
    Decisions made on the generic `/approvals` page are synced back to the refund.
  - Every mutation (payment seed, refund request, reservation, approve/decline, release, blocked
    self-approval) goes through `withAudit()` / the audit log. Customer names are masked in lists,
    detail pages and audit events; reveals need `pii:reveal` and are audited.
- **Permissions.**

  | Role     | `payment:read` | `refund:read` | `refund:create` | `refund:decide` |
  | -------- | :------------: | :-----------: | :-------------: | :-------------: |
  | viewer   |       ✓        |       ✓       |                 |                 |
  | operator |       ✓        |       ✓       |        ✓        |                 |
  | approver |       ✓        |       ✓       |                 |        ✓        |
  | admin    |       ✓        |       ✓       |        ✓        |        ✓        |

- **Pages.** `/refunds` (DataTable: filter by status, amount range in EUR and created date; sort by
  date, amount, status), `/refunds/payments` (payments to refund), `/refunds/new` (EntityForm) and
  `/refunds/[id]` (refund, payment, approval status, decision form and audit history).

### Refunds demo

1. `npm run setup && npm run dev`, open http://localhost:3000/login.
2. **operator@demo.local**: open *Refunds → Payments*, pick a succeeded payment, click *Refund*.
   Request `120.00` with a reason → status **Auto-approved**. Request a second refund above the
   remaining balance → *Total refunds would exceed the payment amount.* Request `750.00` on a payment
   of at least that amount → status **Requested**, with a pending approval on the detail page.
3. **approver@demo.local**: open that refund from *Refunds* (filter status *Requested*), approve it
   (or decline with a reason). The detail page shows the decision and the audit history.
4. **lead@demo.local** (operator + approver): request a refund above 500.00 EUR, then try to approve
   it on the detail page or on `/approvals` → blocked with *You cannot approve or decline your own
   request (four-eyes rule).*, and the attempt shows up in the audit history. Lead can still decide
   refunds requested by others.
5. **admin@demo.local**: `/admin/audit` shows every refund event.

## KYC Review Queue

`src/apps/kyc/` lets compliance analysts review new customers' identity checks (spec:
`docs/specs/kyc-review-queue.md`). Registered in `src/platform/apps/registry.ts` (navigation,
permissions, assigned-analyst and four-eyes policies, approval rule `kyc.high-risk-approval`, PII resolver).

- **Data.** `kyc_cases`: customer name, date of birth and document number (all PII, masked by default
  in lists, detail pages and audit snapshots), document type, ISO country, risk score 0–100, status,
  assigned analyst, decision reason, UTC timestamps. The seed creates 200 deterministic cases
  (~20% with risk score ≥ 70, every status represented) through the audited services.
- **Workflow.** `pending` → (operator claims, case is assigned to them) `in_review` → `approved` /
  `rejected` / `escalated`, always with a reason. Only the assigned analyst can decide. Decided cases are final.
- **Four-eyes.** Approving a case with risk score **≥ 70** creates a platform approval request; the
  case stays in review (locked) until a different user with the approver role confirms it (case →
  approved) or declines it with a reason (case back with the analyst, who can reject or escalate).
  Self-approval is blocked and audited. Decisions made on `/approvals` are synced back to the case.
- **Permissions.**

  | Role     | `kyc:read` | `kyc:claim` | `kyc:decide` (own cases) | `kyc:confirm` | `pii:reveal` |
  | -------- | :--------: | :---------: | :----------------------: | :-----------: | :----------: |
  | viewer   |     ✓      |             |                          |               |              |
  | operator |     ✓      |      ✓      |            ✓             |               |      ✓       |
  | approver |     ✓      |             |                          |       ✓       |      ✓       |
  | admin    |     ✓      |      ✓      |            ✓             |       ✓       |      ✓       |

- **Pages.** `/kyc` (DataTable: filter by status, risk-score range and assigned analyst; sort by risk
  score and created date) and `/kyc/[id]` (masked PII with *Reveal*, approval status, actions, history from the audit log).

### KYC demo

1. `npm run setup && npm run dev`, open http://localhost:3000/login.
2. **viewer@demo.local**: open *KYC Review Queue → Review queue*. Names are masked; a case page shows
   masked PII, no *Reveal* and no action buttons.
3. **operator@demo.local**: filter status *Pending*, open a case with risk score ≥ 70 and click
   *Reveal* on the name (audited), then *Claim case*. Choose *Approve* with a reason → *approval
   requested*; the case stays *In review*, awaiting a second approver. Claim a low-risk case and reject it.
4. **approver@demo.local**: open that case (filter *In review*, sort by risk score) and confirm the
   approval → **Approved**. Declining needs a reason and sends the case back to the analyst.
5. **lead@demo.local** (operator + approver): claim a high-risk case, approve it, then try to confirm
   your own approval (on the case page via `/approvals`) → blocked with *You cannot approve or decline
   your own request (four-eyes rule).*, recorded in the history.
6. **admin@demo.local**: `/admin/audit`, entity type `KycCase`, shows every status change and reveal.

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
    apps/              app registry: apps register nav, permissions, approval rules, PII fields
  apps/
    refunds/           Refunds app: manifest, permissions, rules, service, queries, actions, pages, seed
prisma/                schema (SQLite locally, PostgreSQL-portable), migrations, seed
tests/                 Vitest: authorization, approvals (incl. self-approval), audit, PII, auth config, refunds
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
