# How this was built with Devin

Total prototype time: ~2h wall clock (17:40–19:40, Oct 12, 2026), including
repo and Devin setup. All application code was written by Devin Cloud
sessions. I wrote AGENTS.md, the PR template, the KYC spec and the
new-internal-tool skill, and reviewed and merged every PR.

**Total usage for the whole prototype: 6% of one week's included quota on
the Max plan ($200/month); $0.00 on-demand credit used.** Devin reports
included usage only as a total, not per session; all three sessions are
listed as "Included in quota" in Usage history.

| Session | Goal | Devin work time | Usage | My messages | Outcome |
|---|---|---|---|---|---|
| 1 | Platform layer (auth, RBAC, audit, approvals, PII, shared UI) | ~23 min | Included in quota (size XS), $0.00 on-demand | 1 (the prompt) + 2 approvals (env setup, testing skill) | PR #1: 82 files, 87 tests, CI green on first run |
| 2 | Refunds app | ~26 min | Included in quota (size XS), $0.00 on-demand | 2 (prompt + 1 correction: Refunds card shown 3x) + 1 approval (env fix) | PR #2: CI failed once, self-fixed; 137 tests |
| 3 | KYC Review Queue from a 10-line spec via skill | ~12 min | Included in quota (size XS), $0.00 on-demand | 1 (one-line instruction) | PR #3: 22 files, 188 tests total |

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
  Session 3 followed both rules.
- Environment: the first build failed (no package.json yet). Devin
  diagnosed an npm 10.8.3 install crash and proposed a verified fix
  (npm 11). For production, pin the npm version.
- npm audit: 5 high-severity issues in dev-only ESLint dependencies,
  flagged by Devin, not force-fixed.
- Platform gap: the approval rules are money-only; KYC needed a
  risk-score rule, so the shared platform will need to evolve.

## Devin's own retrospective (Session Insights)
- Session 1 (low): Devin didn't explicitly confirm reading AGENTS.md,
  although the implementation followed its rules. It found and fixed an
  authorization bug in decideApproval while seeding data.
- Session 2 (medium): the concurrent test didn't account for SQLite
  locking. Devin should have checked shared pages (the home page) during
  browser verification, which is the issue I caught. (Low) It didn't use
  an npm 11 note from memory until the build broke.
- Session 3: no issues of note. Suggested prompt improvements for next
  time: state the current repo state upfront, point to the Refunds app as
  the reference implementation, and spell out the testing approach and
  regression checks.

Takeaway: the agent's own retrospective flagged the same gaps the human
review found. Feeding these back into AGENTS.md and the skill is how the
next apps get faster and safer.
