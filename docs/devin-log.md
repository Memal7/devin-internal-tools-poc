# How this was built with Devin

Total prototype time: ~2h wall clock (17:40–19:40, Oct 12, 2026), including
repo/Devin setup. All code written by Devin Cloud sessions; I wrote
AGENTS.md, the PR template, the KYC spec and the skill, and reviewed/merged
every PR.

| Session | Goal | Devin work time | Usage | My interventions | Outcome |
|---|---|---|---|---|---|
| 1 | Platform layer (auth, RBAC, audit, approvals, PII, UI) | ~23 min | ___ | 0 corrections, 2 approvals (env setup, testing skill) | PR #1: 82 files, 87 tests, CI green |
| 2 | Refunds app | ~26 min | ___ | 1 correction (Refunds card shown 3x on home page), 1 approval (env fix) | PR #2: CI failed once, self-fixed |
| 3 | KYC Review Queue from a 10-line spec via skill | ~12 min | ___ | 0 | PR #3: 22 files, 188 tests total |

## Findings
- App #3 (22 files) was ~8x smaller than the platform PR (82 files):
  new apps reuse auth, audit, approvals and PII masking.
- Human review still mattered: I caught a UI bug that all tests missed
  (duplicate app card). Devin found the real root cause, added a
  regression test, and saved the lesson to memory.
- Devin replaced a failing concurrency test (SQLite lock timeout) with a
  deterministic one and disclosed it. Over-refund protection still holds;
  production needs a real concurrency test against PostgreSQL.
- Lessons became guardrails: the new-internal-tool skill now checks that
  each app appears exactly once and forbids silently replacing tests.
- Environment: the first build failed (no package.json yet). Devin
  diagnosed an npm 10.8.3 install crash and proposed a verified fix
  (npm 11). For production, pin the npm version.
- npm audit: 5 high-severity issues in dev-only ESLint dependencies,
  flagged by Devin, not force-fixed.
- Platform gap: the approval rules are money-only; KYC needed a
  risk-score rule, so the shared platform will need to evolve.
