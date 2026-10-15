# FORK.md

`Stoots/zfit` is a personal fork of [`CodeWithCJ/SparkyFitness`](https://github.com/CodeWithCJ/SparkyFitness). To keep upstream syncs clean, edit upstream-owned files (`CHANGELOG.md`, `.github/`, existing docs, `AGENTS.md`) minimally. Fork-only material lives here:

- `FORK.md` (this file)
- `agent-docs/` (fork additions: `HANDOVER.md`, `deployment-smoke.md`)
- `docs/adr/`, `docs/agents/`
- `scripts/deployment-smoke*`, `scripts/fork-check-commits*`, `scripts/fork-check-pr-body*`, `.github/workflows/deployment-smoke-checks.yml`

## Where to start

- Current state and next steps: `agent-docs/HANDOVER.md`.
- Work queue: GitHub issues on `Stoots/zfit` (see `docs/agents/issue-tracker.md`). #5 and #7 have active preparatory branches, but implementation remains blocked until open issue #4 is resolved; #6 and #8 follow. Specs: #1 and #9 (#9 supersedes #1 for session identity).
- Deployment verification: `agent-docs/deployment-smoke.md`.
- Before delivery: review changes against `main` on both repo standards and the originating issue/spec (`agent-docs/pr-review-checklist.md`), then verify each commit's affected package typecheck. Green tests alone did not catch the PR #20 spec gaps.
- Local verification: run multi-file database suites with Vitest `--no-file-parallelism`; place mobile Jest caches under `~/.cache` via `--cacheDirectory`. The `jest-expo` runtime lacks `Promise.withResolvers`.

## Delivery checks

Before pushing, run `node --test scripts/fork-check-*.test.mjs` and `node scripts/fork-check-commits.mjs origin/main`. The commit check fails on missing CI test files, forbidden commit text, or edits to `db_schema_backup.sql`; inspect its upstream-owned-file warnings. For commit-by-commit typechecking, add `--typecheck` (uses temporary worktrees under `~/.cache` and the local pnpm store).

Before opening a PR, save its complete body to a file and run `node scripts/fork-check-pr-body.mjs <body-file>`. Use one closing keyword per issue on its own line. `.agents/skills/pr-submission/SKILL.md` is upstream-owned, so this fork-specific check lives here.

The fork adds a narrow `Promise.withResolvers` restriction in upstream-owned `SparkyFitnessMobile/eslint.config.js`; keep that addition during upstream syncs.

## Syncing upstream

The fork was 184 commits behind upstream as of 2026-10-12.

```bash
git remote add upstream https://github.com/CodeWithCJ/SparkyFitness.git   # if missing
git fetch upstream
git switch -c sync/upstream-YYYYMMDD
git merge upstream/main    # in small steps (merge intermediate upstream commits/tags one batch at a time)
```

- Do not hand-resolve `pnpm-lock.yaml`: take either side, then regenerate it with `pnpm install`.
- Never hand-edit or regenerate `db_schema_backup.sql` locally.
- Run each package's `pnpm run validate` and its CI test script (see `.github/workflows/ci-tests.yml`) before merging the branch.

## GitHub Actions policy

Inherited workflows that are upstream-only, need upstream secrets, or would publish or open PRs are disabled in the repo settings (no file edits, so syncs stay clean):

```bash
gh workflow disable <file>.yml -R Stoots/zfit   # and `gh workflow enable <file>.yml -R Stoots/zfit` to restore
```

| Disabled workflow                                                                                                                          | Why                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `release-please.yml`, `draft-release.yml`, `release-assets.yml`, `release-published-notifier.yml`                                          | Upstream release process; opens release PRs, publishes assets |
| `umbrel-app-submit.yml`, `umbrel-app-update.yml`                                                                                           | Submits to upstream Umbrel app store; needs upstream secrets  |
| `schema-backup.yml`                                                                                                                        | Opens automated PRs; upstream-owned snapshot                  |
| `nix-update-hashes.yml`, `auto-merge-bot-prs.yml`                                                                                          | Opens or merges bot PRs                                       |
| `auto-docker-deploy.yml`, `manual-docker-deploy.yml`                                                                                       | Publishes Docker images; needs registry secrets               |
| `helm-release.yml`, `helm-chart-version.yml`                                                                                               | Publishes chart / bumps versions upstream                     |
| `docs-deploy.yml`                                                                                                                          | Deploys upstream GitHub Pages site                            |
| `android.yml`, `ios-build.yml`                                                                                                             | Signed builds; need upstream secrets                          |
| `sync-translations.yml`                                                                                                                    | Needs translation service secrets; opens PRs                  |
| `pr-license-enforcement.yml`, `pr-validation.yml`, `first-contributor-welcome.yml`, `pr-merged-issue-notifier.yml`, `issue-auto-label.yml` | Upstream contributor and community automation                 |

Kept enabled: `ci-tests.yml`, `pr-validation-tests.yml`, `docs-test.yml`, `helm-tests.yml`, `deployment-smoke-checks.yml`. Check the live state with `gh workflow list --all -R Stoots/zfit`.

## Fork changelog

Upstream `CHANGELOG.md` is release-please managed; fork changes are recorded here instead.

### Unreleased

#### Bug fixes

- Show only the next pending Training Program workout on web and mobile dashboards (ordered by effective date), keeping the session picker for standalone Workout Plans and falling back to all plans if Programs fail to load.
- Reject `missed` outcomes for future Planned Sessions so an accidental click cannot trigger an irreversible auto-shift; index Program session diary links.
- Restore per-set RPE entry in started workouts, including timed cardio, with decimal effort values retained in resumed drafts and workout save requests.
- Show prescribed set notes on workout start and provide editable exercise notes that persist with the workout.

#### Features

- Make the fork web app installable from iPhone Safari with correctly sized icons, standalone launch metadata, safe-area spacing, and phone-sized Training Programs, Workout Sessions, and Cardio Tests controls.
- Cooper run Test Attempts (#4): entry, edit, dated history, and trend graph on web and mobile; native acceptance pending per `agent-docs/cooper-manual-acceptance.md`.
- Normalize stored exercise and diary exercise names with consistent capitalization (#10).
- Bind Program Planned Sessions to exact Workout Sessions and retain session-level prescriptions (#11).
- Support optional sessions and linking a completed workout after its scheduled date (#12).
- Preview and apply selected future prescriptions in bulk with Program-aware conflict checks (#13).
- Add owner-scoped Workout Plan consolidation preflight, explicit mappings, replay-safe transactions, and private rollback receipts (#14). Live cutover remains separately approval-gated.
- Training Programs: authoring, outcomes, and optional auto-shift (issues #2, #3). See `docs/src/features/exercises/training-programs.md` and `docs/adr/`.

#### Developer tooling

- Add a warm-cache deployment smoke command that verifies the browser's loaded frontend asset and live upcoming-workout order, with private JSON/screenshot evidence and CI acceptance checks (`agent-docs/deployment-smoke.md`).
- Run the Training Program integration suite in CI against Postgres; trigger consumer checks for shared-contract changes.
- Add guarded, isolated PostgreSQL acceptance jobs for consolidation and bulk workflows; require the JSON report checker to reject missing, skipped or incomplete suites. The existing migration-check job runs the RLS matrix.
