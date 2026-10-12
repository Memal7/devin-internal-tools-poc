# Spec: KYC Review Queue

## Purpose
Compliance analysts review new customers' identity checks (KYC) and decide
to approve, reject or escalate each case. High-risk cases need a second
person to approve (four-eyes).

## Location
`src/apps/kyc/`, built on the platform layer, following AGENTS.md.

## Data model: KycCase
- customerName (PII)
- dateOfBirth (PII)
- documentType: passport | national_id | driving_licence
- documentNumber (PII)
- country (ISO 2-letter code)
- riskScore: integer 0–100
- status: pending | in_review | approved | rejected | escalated
- assignedAnalystId (nullable)
- decisionReason (required when approved, rejected or escalated)
- createdAt, updatedAt (UTC)

## Workflow
1. New cases start as `pending`.
2. An `operator` claims a pending case: it becomes `in_review` and is
   assigned to them. Only the assigned analyst can act on it.
3. The analyst approves, rejects or escalates, always with a reason.
4. If riskScore >= 70, "approve" does not finish the case. It creates an
   approval request that a user with the `approver` role must confirm,
   and that approver must not be the analyst who requested it.
5. Every status change and every PII reveal is audited.

## Permissions
- viewer: see the queue and case details (PII masked)
- operator: claim cases, approve/reject/escalate their own cases
- approver: confirm or decline high-risk approvals
- admin: everything, plus the audit log
- `pii:reveal` (operator, approver, admin): reveal masked fields

## Pages
- Queue: server-side paginated table, filter by status, risk score range
  and assigned analyst; sort by risk score and created date.
- Case detail: masked PII with a "Reveal" button, status history from the
  audit log, and action buttons shown only if the user is allowed.

## Seed data
200 cases with realistic fake data, a spread of risk scores (about 20%
>= 70) and all statuses represented.

## Tests (required)
- Allowed and blocked status transitions
- Only the assigned analyst can decide a case
- High-risk approval needs a second, different user (self-approval blocked)
- Each role is denied what it should not do
- Audit events are written for every status change and PII reveal

## Done when
- All tests pass and the app runs with `npm run setup` and `npm run dev`
- The KYC queue appears in the navigation
- README has a short "KYC Review Queue" section with demo steps
- PR opened using the PR template
