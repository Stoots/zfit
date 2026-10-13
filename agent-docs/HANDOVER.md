# Handover

_Last updated: 2026-10-14_

Read this after `AGENTS.md` and `FORK.md`. It records the landing state and the next work. Verify live issue and branch status before starting a ticket.

## Private operator notes

Deployment targets, rollback files, Penpot design-file IDs and local tool setup are private and never committed. On the owner's machine they live in `agent-docs/private/` (gitignored). Read `agent-docs/private/penpot-and-deployment-handover.md` there before deploying or touching Penpot. If the folder is absent, ask the owner to perform that work.

## Landed on `main`

- Training Programs authoring, outcomes and optional auto-shift (#2–#3); see `docs/src/features/exercises/training-programs.md` and ADR 0001.
- PR #15 (merge `3af43c044`): Cooper run Test Attempts (#4) on web and mobile, with shared validation, persistence and RLS. Phone acceptance remains open.
- PR #20 (merge `0668e3bd9`): exercise-name capitalization (#10); exact, prescribed Workout Sessions (#11); optional and late-completed sessions (#12); bulk future-prescription edits (#13); guarded owner-scoped consolidation (#14). Live consolidation cutover requires a separate owner decision. The fork changelog in `FORK.md` records user-facing changes.
- The earlier dashboard, cache, future-miss, workout playback and CI cleanup remains on `main`. The PR #20 review preserved the web/mobile dashboard fallback and the future-miss `409` behavior while changing the session contract.

## Next work

The issue queue is on `Stoots/zfit` (`docs/agents/issue-tracker.md`). Specs #1 and #9 and ADR 0003 set the accepted design; #9 supersedes #1 for session identity. #5–#8 were labelled `ready-for-agent` on 2026-10-13.

1. #5 Sprint/Power Tests (`feat/5-sprint-power-tests`) and #7 Phase/Cardio Tests (`feat/7-phase-cardio-tests`) are in progress.
2. #6 follows those branches, then #8.
3. Cleanup tickets #16, #17, #19 and #21 remain to be scheduled.

Owner decisions and acceptance: #18 (delegate edit access), #14 (live consolidation cutover) and #4 (phone check). Keep private cutover identifiers out of the issue tracker.

## Known gaps and upgrade notes

- Local database suites can deadlock when run together. The migration-check CI list now uses `--no-file-parallelism`; use that flag for local multi-file DB runs too.
- The Cooper migration was renamed from `20261009130000_create_cardio_test_attempts.sql` to `20261012130000_create_cardio_test_attempts.sql`. A database that applied the old filename needs its `schema_migrations` row renamed before upgrade.
- Workout Sessions migrations are dated `20261011*`, before the main-branch `20261012*` migrations. Fresh-install and upgrade paths therefore apply them in different orders; both paths were exercised in PR #20 CI.
- The #11 commit (`f65b5ca1d`) lists `exerciseNameMigration.integration.test.ts` and `exerciseNameCapitalisation.integration.test.ts` in its CI command, but those files arrive in the subsequent #10 commits. The merged branch has both files. If replaying commits individually, validate the #11 commit with its present tests and validate the complete CI list once the #10 commits are applied.
- Native Cooper acceptance remains open per `agent-docs/cooper-manual-acceptance.md`. Native mobile changes in the landing were validated by Jest and typecheck, not a device or emulator.
- No web regression yet covers the Program editor's “plan required” save validation. Mobile still fetches Programs for every user (usually an empty list). Same-day sessions with a later `sort_order` than a missed session are not auto-shifted by design; revisit only if the product decision changes.
- The fork's upstream sync remains pending. Use the branch procedure in `FORK.md`; the 184-commit count there is a 2026-10-12 snapshot. `puppeteer-core` in the root tooling manifest supports the fork-only smoke tool and may cause sync conflicts.

## Landing verification

- PR #15 delivery reported frontend, mobile and server validation; full frontend/mobile suites; and persisted Cooper/RLS checks against disposable PostgreSQL. See the PR and `agent-docs/cooper-manual-acceptance.md` for the remaining phone check.
- PR #20 delivery reported frontend, mobile and server validation; 190 frontend suites (1,753 tests), 499 mobile suites (7,690 tests), serial migration-check suites, upgrade-path tests and guarded consolidation acceptance. The landing review corrected spec gaps that those green suites initially missed.
