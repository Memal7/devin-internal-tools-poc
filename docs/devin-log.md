# Build log

Built on Oct 12, 2026 with Devin Cloud (Normal agent, Max plan).

Build time: ~2h wall clock for the three Devin sessions, including my
reviews and merges. One-time setup before that (repo, guardrail files,
GitHub connection, Devin environment) took ~30min.

Usage: 6% of the weekly included quota, $0 on-demand. Devin only shows
included usage as a total, not per session. All three sessions are listed
as "Included in quota" (size XS).

I wrote [AGENTS.md](../AGENTS.md), the
[PR template](../.github/pull_request_template.md), the
[KYC spec](specs/kyc-review-queue.md) and the
[skill](../.agents/skills/new-internal-tool/SKILL.md). Devin wrote the
rest. I reviewed and merged each PR.

| Session | What | Devin time | My corrections | PR |
|---|---|---|---|---|
| 1 | Platform layer | ~23 min | 0 | [#1](https://github.com/Memal7/devin-internal-tools-poc/pull/1): 82 files, 87 tests |
| 2 | Refunds app | ~26 min | 1 | [#2](https://github.com/Memal7/devin-internal-tools-poc/pull/2): 137 tests |
| 3 | KYC queue | ~12 min | 0 | [#3](https://github.com/Memal7/devin-internal-tools-poc/pull/3): 22 files, 188 tests |

## Session 1: platform layer

One prompt. Devin built auth, roles, the audit log, approvals, PII masking
and the shared UI. Before opening the PR it logged in as each of the five
demo users in its own browser. CI passed on the first run.

I approved two things Devin suggested: an environment setup and a
browser-testing skill.

In review I checked the self-approval rule in the code. `decideApproval()`
rejects it and writes `approval.self_approval_blocked` to the audit log.
The audit table is protected by DB triggers, an ORM guard and a test,
which is more than I asked for.

npm audit shows 5 high findings, all in dev-only ESLint dependencies.
Devin reported them and didn't force a fix. I think that was right.

## Session 2: refunds

Devin picked up the testing skill from session 1 on its own.

While it was testing, I noticed the Refunds card appeared three times on
the home page. All tests were green. I sent one message and guessed the
app was registered three times. Wrong guess: the home page rendered one
card per nav entry, and Refunds has three. Devin fixed that, made
registration idempotent anyway and added a test.

CI failed once. Devin had written a test that sends five refund requests
for the same payment in parallel, and SQLite locking made it time out. It
replaced the test with a deterministic one and said so in the PR. The
over-refund check still holds, and the worst case is a refused request,
not a double refund. OK for a PoC. Before production I'd want the
parallel test running against Postgres.

Environment: the first snapshot was built before there was any code, so
setup failed. Later npm 10.8.3 crashed on a clean install. Devin proposed
npm 11 and I approved it. The version should be pinned.

After this session I wrote the skill and added two rules from what
happened: check that the app shows up exactly once on the home page, and
don't replace a failing test without explaining why.

## Session 3: KYC queue

The prompt was one line pointing at the skill and the spec. Devin posted
a plan first, reused the platform approvals (so four-eyes and auditing
came with it), checked the home page, and changed one existing test
without removing any assertions. No corrections from me. 22 files,
compared to 82 for the platform.

One workaround: approval rules only understand money amounts, and KYC
needs a risk score. The platform will need more general rules.

## What I checked in review

- PR #1: CI, the security checklist, and the self-approval rule in code.
- PR #2: that the `src/platform/` changes were only the registry and home
  page fix, that the refund check runs in one transaction, and the
  replaced test.
- PR #3: that the only platform change was registering the app, and the
  home page screenshot.

## Open before production

- Parallel refund test against Postgres.
- The app registry lives in `src/platform/` and imports the apps, so the
  platform depends on the apps. It should be the other way round, with
  CODEOWNERS and a dependency check in CI.
- Approval rules beyond money amounts.
- Pin Node and npm versions.
- The 5 npm audit findings.
- The usual hardening: Postgres, Entra ID or Okta, hosting, secrets
  management, pen test, SOC 2 evidence.

## Session Insights

Devin's own retros flagged the same two problems I found in session 2:
it didn't check shared pages, and it didn't account for SQLite locking.
For session 1 it noted it never confirmed reading AGENTS.md, although it
followed it. For session 3 it suggested a better prompt: say what's
already on main and point at the refunds app as the reference.

## How I'd run this with a team

1. Rules go in AGENTS.md and the PR template.
2. Each new tool gets a ~10-line spec in docs/specs/.
3. The session prompt is one line pointing at the skill and the spec.
4. Review: CI, the checklist, the critical control in code, and click
   through the app.
5. Anything found in review goes back into AGENTS.md or the skill.
