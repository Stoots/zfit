# FORK.md

`Stoots/zfit` is a personal fork of [`CodeWithCJ/SparkyFitness`](https://github.com/CodeWithCJ/SparkyFitness). To keep upstream syncs clean, edit upstream-owned files (`CHANGELOG.md`, `.github/`, existing docs, `AGENTS.md`) minimally. Fork-only material lives here:

- `FORK.md` (this file), `FORK-CHANGELOG.md`, and `.gitattributes` (`FORK-CHANGELOG.md merge=union`, so concurrent changelog entries merge without conflicts)
- `agent-docs/` (fork additions: `HANDOVER.md`, `deployment-smoke.md`, `fork-review-rules.md`)
- `docs/adr/`, `docs/agents/`
- `scripts/deployment-smoke*`, `scripts/fork-check-commits*`, `scripts/fork-player-e2e*`, `scripts/fork-check-pr-body*`, `.github/scripts/assert-acceptance-report*`, `.github/workflows/deployment-smoke-checks.yml`, `.github/workflows/fork-*.yml`

The native app (`SparkyFitnessMobile/`) stays at upstream behaviour: the owner's iPhone runs the upstream App Store app plus the fork's web app from the Home Screen, so fork features ship to web. `fork-check-commits` warns on native-app changes.

## Where to start

- Current state and next steps: `agent-docs/HANDOVER.md`.
- Work queue: GitHub issues on `Stoots/zfit` (see `docs/agents/issue-tracker.md`); the current order is in `agent-docs/HANDOVER.md`. Specs: #1 and #9 (#9 supersedes #1 for session identity).
- Deployment verification: `agent-docs/deployment-smoke.md`.
- Every PR runs `.github/workflows/fork-checks.yml` (commit and PR-text rules: no assistant or bot attribution, no `db_schema_backup.sql` edits).
- Before delivery: review changes against `main` on both repo standards and the originating issue/spec (`agent-docs/pr-review-checklist.md`, plus `agent-docs/fork-review-rules.md` for AI-provider data paths), then verify each commit's affected package typecheck. Green tests alone did not catch the PR #20 spec gaps.
- Local verification: run multi-file database suites with Vitest `--no-file-parallelism`; place mobile Jest caches under `~/.cache` via `--cacheDirectory`. The `jest-expo` runtime lacks `Promise.withResolvers`.

## Delivery checks

Before pushing, run `node --test scripts/fork-check-*.test.mjs` and `node scripts/fork-check-commits.mjs origin/main`. The commit check fails on missing CI test files, forbidden commit text, or edits to `db_schema_backup.sql`; inspect its upstream-owned-file warnings. For commit-by-commit typechecking, add `--typecheck` (uses temporary worktrees under `~/.cache` and the local pnpm store).

Before opening a PR, save its complete body to a file and run `node scripts/fork-check-pr-body.mjs <body-file>`. Use one closing keyword per issue on its own line. `.agents/skills/pr-submission/SKILL.md` is upstream-owned, so this fork-specific check lives here.

The fork adds a narrow `Promise.withResolvers` restriction in upstream-owned `SparkyFitnessMobile/eslint.config.js`; keep that addition during upstream syncs.

## Syncing upstream

Synced through upstream #2944 on 2026-10-17.

```bash
git remote add upstream https://github.com/CodeWithCJ/SparkyFitness.git   # if missing
git fetch upstream
git switch -c sync/upstream-YYYYMMDD
git merge upstream/main    # in small steps (merge intermediate upstream commits/tags one batch at a time)
```

- Do not hand-resolve `pnpm-lock.yaml`: take either side, then regenerate it with `pnpm install`.
- Never hand-edit or regenerate `db_schema_backup.sql` locally.
- Run each package's `pnpm run validate` and its CI test script (see `.github/workflows/ci-tests.yml`) before merging the branch.
- `.husky/post-merge` reruns `pnpm install --frozen-lockfile` when a pull or merge changes `pnpm-lock.yaml`; stale `node_modules` otherwise break server boot.

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

Kept enabled: `ci-tests.yml`, `pr-validation-tests.yml`, `docs-test.yml`, `helm-tests.yml`, `deployment-smoke-checks.yml`, `fork-guarded-acceptance.yml`. Check the live state with `gh workflow list --all -R Stoots/zfit`.

## Fork changelog

User-facing fork changes are recorded in `FORK-CHANGELOG.md` (upstream `CHANGELOG.md` is release-please managed). The `merge=union` driver only applies to local merges: GitHub still marks a second PR that touches the changelog as conflicting, so run `git merge origin/main` on that branch, push, and let CI rerun.

## Workout player browser test

Run `pnpm player:e2e` from the root after `pnpm install --frozen-lockfile`.
Requires Docker and `/usr/bin/chromium` (override with `CHROME_PATH`). Port 8080
must be free; server and disposable PostgreSQL ports are chosen automatically
(override the database port with `PLAYER_E2E_DB_PORT`). The script builds the web
app and tests a Program workout at 390×844 with touch input: log a set, leave,
reload, restart, verify the draft, finish, and verify the saved diary set.
It uses synthetic data and isolated inline server settings, ignores repo `.env`,
disables scheduled jobs, and removes its processes and database on exit.
Logs and failure screenshots stay under `$TMPDIR` (default `tmp-work/`).
