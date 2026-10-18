# Frontend Deployment Smoke Gate

Fork-only tooling: `scripts/deployment-smoke.mjs`, `scripts/deployment-smoke.test.mjs`, `pnpm deployment:smoke`, `pnpm deployment:check`, and `.github/workflows/deployment-smoke-checks.yml`.

A healthy container does not prove that an existing browser is running the new frontend. Production builds use a service worker (`SparkyFitnessFrontend/vite.config.ts`); a navigation can still load an older cached entry asset after the container has changed.

`pnpm deployment:smoke` connects to an existing Chrome/Chromium through its loopback debugging endpoint. It does not launch a browser or store login cookies. Use a dedicated profile, sign in at the **public app origin**, select your own Diary in English with today's date, dismiss announcements and other dialogs, and leave that root-page tab open. Verification rejects dialog-obstructed surfaces rather than accepting correct cards hidden behind a modal.

## Before deploying

```bash
export SMOKE_OUTPUT="$(mktemp -d /tmp/sparky-smoke.XXXXXX)"
pnpm deployment:smoke --phase warm --url https://YOUR_HOST/ \
  --cdp-url http://127.0.0.1:9222 --output "$SMOKE_OUTPUT"
```

## After deploying

Use the same browser, tab, URL, and output directory:

```bash
pnpm deployment:smoke --phase verify --url https://YOUR_HOST/ \
  --cdp-url http://127.0.0.1:9222 --output "$SMOKE_OUTPUT" \
  --container YOUR_FRONTEND_CONTAINER
```

The gate compares the browser's module-entry asset with the healthy running frontend container and checks up to four upcoming Program workouts plus unrelated standalone plans against the live schedule. Cardio Test assessments occupy queue slots but are not treated as workout playback cards. Program selection uses pending session effective dates and authored tie order; diary assignments logged today do not hide a future occurrence of a reusable Workout Session. Completed/missed Program sessions do not appear as standalone previews. An account without eligible workouts cannot pass this feature check. Requests are read-only; no workouts are started or logged.

Caching stays enabled. If the browser loads a stale entry, the command requests a normal service-worker update and reloads once. It records the initial and final snapshots and exits nonzero if the expected build or workout order is not reached. Inspect `verify.json` and the scoped `upcoming-workouts.png`; the report records whether worker refresh was needed. Keep these private: reports and screenshots contain workout data, and `warm.json` includes a browser debugging endpoint.

## Manual diagnosis

Compare the loaded `script[type="module"]` URL with the deployed `index.html`. Update the site's worker through browser developer tools and reload, then verify visible behavior. A fresh incognito session, disabled service workers, or cache clearing alone does not exercise an existing client's update path. `localhost` and the public hostname have separate browser caches.

## CI and local runbooks

`pnpm deployment:check` runs the smoke acceptance regressions and the fixture-based deployment runner tests; `.github/workflows/deployment-smoke-checks.yml` runs them in CI without production credentials. For a full backend/frontend deployment, [`pnpm deploy:live`](../FORK.md#scripted-live-deployment)
wraps backup, warm, build, exact image pinning, server/frontend startup, and verify.
Use `pnpm deploy:live --dry-run` to inspect the plan without any commands or file
reads/writes; `--help` lists target overrides and image rollback usage. It requires
a clean `main` checkout and this same authenticated browser prerequisite. An image
rollback does not undo database migrations. Failed steps stop deployment and print
rollback information; no automatic database restore is attempted. Rollback restores
images and starts server then frontend before warming and verifying the browser.

Deployment target settings belong in the installation's private local runbook
beside its live Compose file; locate the target with `docker compose ls` rather
than assuming the repository's production helper manages it. Keep deployment
evidence (saved Compose, database dump, smoke reports) private.
