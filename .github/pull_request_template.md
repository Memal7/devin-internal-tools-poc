## Summary
<!-- What does this PR do, and why? -->

## Changes
<!-- Main files/areas changed -->

## Security checklist
- [ ] Every page, API route and server action calls `can()` on the server
- [ ] Every data change goes through `withAudit()`
- [ ] No update/delete code path for `audit_events`
- [ ] Four-eyes rules enforced on the server (self-approval blocked), if relevant
- [ ] PII masked by default with `maskPII()`; reveal requires `pii:reveal` and is audited
- [ ] No PII in logs or error messages
- [ ] Server-side input validation with Zod
- [ ] No secrets committed; new config added to `.env.example` with dummy values
- [ ] No new dependencies, or each one is justified below

## Tests
- [ ] Authorization tests (each role denied what it should not do)
- [ ] Approval rule tests, including self-approval blocked (if relevant)
- [ ] Audit event tests for each data change
- [ ] `npm run lint`, `npm run typecheck` and `npm test` all pass

## How I verified
<!-- Steps taken in the browser, which demo users were used, screenshots -->

## Design decisions
<!-- Important choices and trade-offs -->

## Not done / follow-ups
<!-- Anything left out, known limitations -->
