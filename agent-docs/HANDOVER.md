# Handover

_Last updated: 2026-10-12_

Read this after `AGENTS.md` and `FORK.md`. It records where work stands and what to do next. Update it at the end of every session that changes the state below.

## Private operator notes

Deployment targets, rollback files, Penpot design-file IDs and local tool setup are private and never committed. On the owner's machine they live in `agent-docs/private/` (gitignored). Read `agent-docs/private/penpot-and-deployment-handover.md` there before deploying or touching Penpot. If the folder is absent, you are not on the owner's machine: do not deploy, and ask the owner.

## Current state

### Shipped (on `main`)

- Training Programs: authoring, outcomes, optional auto-shift (issues #2, #3; closed). See `docs/src/features/exercises/training-programs.md`, ADR 0001.

### Done in the 2026-10-12 cleanup (review fixes)

- **Dashboard next workout (web + mobile):** `selectDashboardWorkoutPlans` (`shared/src/utils/dashboardWorkoutPlans.ts`) returns `{ programPlan, standalonePlans }`. The Program workout is a single preview with no session picker; standalone plans keep the session picker (`SparkyFitnessFrontend/src/pages/Diary/DashboardPlanCard.tsx`, `SparkyFitnessMobile/src/components/WorkoutPlanBanner.tsx`). While Programs load, no plan banners show; if the Programs query fails, or when acting on behalf of another user, all eligible plans show as standalone.
- **Cache invalidation:** web `trainingProgramKeys` factory (`src/api/keys/exercises.ts`); plan and diary mutations invalidate Programs and vice versa. Mobile `invalidateExerciseCache` includes `trainingProgramsQueryKey`.
- **Server:** a `missed` outcome on a session dated after the athlete's today returns 409 (prevents irreversible auto-shift). New migration `20261012120000_index_training_program_session_entries.sql` indexes the diary FKs. `HttpError` (`SparkyFitnessServer/utils/errors.ts`) replaces the model-layer `TrainingProgramError`; plan deletion again wraps unexpected DB errors. Long repository functions split.
- **Tests in CI:** `trainingPrograms.integration.test.ts` fails (rather than silently skips) under `CI` without a database, and now runs in the `migration-check` job, which has Postgres. `ci-tests.yml` also triggers on `shared/**`.
- **Web UI split:** `TrainingProgramEditor.tsx` and `TrainingPrograms.tsx` split into focused components plus `useProgramDraft`. An unselected plan blocks save (`trainingPrograms.planRequired`).
- **Workout playback:** per-set RPE entry and editable exercise notes (web).
- **Fork hygiene:** `FORK.md` (sync procedure, Actions policy, fork changelog); upstream-owned `CHANGELOG.md`, `.github/copilot-instructions.md` and `docs/src/developer/troubleshooting.md` restored to upstream; deployment smoke docs moved to `agent-docs/deployment-smoke.md`; stale guide claims fixed; `frontend` removed from `pnpm-workspace.yaml`.

### Not yet done: owner action needed on GitHub

These were blocked for the agent and must be run by the owner (see `FORK.md`):

1. Disable the upstream-only workflows listed in `FORK.md` _before_ Actions runs anything (`gh workflow disable <file>.yml`). They are all still active; `release-please`, `schema-backup` and `nix-update-hashes` fire on push to `main`.
2. Issue labels: create `spec`; move #1 and #9 from `ready-for-agent` to `spec`; remove `ready-for-agent` from closed #2 and #3; keep `ready-for-agent` only on unblocked tickets (#4, #10, #11) and mark the blocked ones `needs-triage`.
3. Commit `3471c221a` (already on `origin/main`) had tool narration in its message. It is reworded locally, so pushing needs `git push --force-with-lease origin main`.

## Next work (in order)

The work queue is GitHub issues on `Stoots/zfit` (`docs/agents/issue-tracker.md`). Specs: #1 (Programs, Cardio Tests, AI) and #9 (session-level plans), whose session decisions supersede #1. ADR 0003 is the accepted design.

1. **#11: session-level Workout Sessions.** Unblocked; the foundation for #12–#14. Today `training_program_sessions.workout_plan_id` is `NOT NULL`, recorded sessions freeze it, and the name snapshot is plan-keyed. Plan a nullable `workout_session_id` with an explicit, queryable "legacy whole-plan / ambiguous" state, so #14's preflight can list unmapped references. `selectDashboardWorkoutPlans` and both dashboards must move to the session contract in the same change; do not ship a partially migrated contract.
2. **#10: exercise-name capitalisation.** Unblocked and independent.
3. **#4: Cooper run Tests.** Unblocked; it unblocks #5–#8.
4. Then #12 → #13 → #14 (the consolidation cutover is approval-gated; keep live identifiers out of the issue tracker).

## Known gaps / follow-ups

- Upstream sync: the fork is 184 commits behind `CodeWithCJ/SparkyFitness` (`upstream` remote configured). Sync on a branch before starting #11 to avoid a larger conflict later.
- No test yet for the web "plan required" save validation in the Program editor.
- Mobile fetches Programs for every user (cheap empty list); fine until it matters.
- Native mobile changes have not been verified on a device or emulator; only jest and typecheck.
- Same-day sessions with a later `sort_order` than a missed session are not auto-shifted (documented behaviour; revisit with #12).
- `puppeteer-core` sits in the root `package.json` for the fork-only smoke tool; move it if it causes upstream sync conflicts.

## Verification at handover

- `pnpm run validate`: frontend, mobile and server pass.
- Jest: web Training Programs, playback, dashboard selector and dashboard card suites (35 tests); mobile ExerciseSummary and Programs API (8 tests).
- Server: `trainingPrograms.integration.test.ts` passed (26) against a disposable Postgres 18 container with migrations applied; the RLS matrix and plan-template tests pass.
- `node --test scripts/deployment-smoke.test.mjs`: 7 pass.
