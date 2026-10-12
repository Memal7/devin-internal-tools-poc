---
name: new-internal-tool
description: Build a new internal tool app on the platform layer from a short spec in docs/specs/.
argument-hint: <path to spec file>
---

## Procedure
1. Read the spec at $1 and AGENTS.md. Post a short plan (data model,
   permissions, pages, approval rules) before writing code.
2. Add Prisma models, a migration and seed data for the app.
3. Register the app in src/platform/apps/registry.ts and register its
   permissions.
4. Build the pages in src/apps/<app-name>/ using the platform DataTable and
   EntityForm components.
5. Route every data change through withAudit(). Use the platform approvals
   module for any four-eyes rule. Mask PII with maskPII().
6. Write tests: role denials, approval rules including blocked
   self-approval, and audit events for every change.
7. Add a section for the app to the README with demo steps.
8. Run npm run lint, npm run typecheck and npm test. All must pass.
9. Start the app and verify the main flow in the browser as each relevant
   demo user.
10. Open the home page in the browser and confirm the new app appears
    exactly once under "Apps" and in the navigation. Add a screenshot to
    the PR.
11. Open one pull request using the PR template. Do not merge it.

## Forbidden
- Do not change src/platform/ except to register the app and its
  permissions. If a platform bug blocks you, explain it in the PR.
- Do not add new dependencies without justifying them in the PR.
- Do not weaken or replace a failing test without explaining why in the PR.
