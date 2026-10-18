# Cardio Tests: phone web acceptance

This repeatable procedure covers #95 / #1 US19 and the Cardio Test portion of T4.
Use the web app at **390×844 CSS pixels, touch enabled, device scale 3**. Native
screens are outside the fork's scope. This supplements the jsdom coverage in
`SparkyFitnessFrontend/src/tests/pages/CardioTests.test.tsx`; jsdom cannot prove
phone layout or actual Recharts rendering.

## Isolated setup

Requires Bash on Linux, Docker, Node, pnpm and `setsid`. Run the following blocks
in the **same Bash shell**, starting at the repository root. These commands mirror
`scripts/fork-player-e2e.mjs` without running its player scenario or adding a helper
script. Never use a live database, source the repository `.env`, or reuse another
worker's container. Change the example ports/name if they are occupied; 8080 is
reserved for the player script.

### Start PostgreSQL and the isolated server

```bash
set -euo pipefail
set +m
repo_root="$PWD"
export TMPDIR="$repo_root/tmp-work"
mkdir -p "$TMPDIR"
pnpm install --frozen-lockfile
export db_port=55495
export server_port=3395
export preview_port=8095
export preview_origin="http://localhost:${preview_port}"
container_name=zfit-test-95
run_dir=$(mktemp -d "$TMPDIR/cardio-phone.XXXXXX")
server_pid=
preview_pid=
container_started=false

cleanup() {
  for child_pid in "$preview_pid" "$server_pid"; do
    if [ -n "$child_pid" ]; then
      kill -TERM -- "-$child_pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for child_pid in "$preview_pid" "$server_pid"; do
    if [ -n "$child_pid" ]; then
      kill -KILL -- "-$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  server_pid=
  preview_pid=
  if [ "$container_started" = true ]; then
    docker rm -f -v "$container_name" || true
    container_started=false
  fi
  rm -rf -- "${run_dir:?}/uploads"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Fail before creating resources if a required port is already occupied.
node --input-type=module <<'NODE'
import { createServer } from 'node:net';
for (const port of [process.env.db_port, process.env.server_port, process.env.preview_port]) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(Number(port), '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
}
NODE
password=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")
auth_secret=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")
encryption_key=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
docker run --detach --rm --name "$container_name" \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=player_e2e \
  -p "127.0.0.1:${db_port}:5432" postgres:18.3-alpine
container_started=true
for attempt in {1..120}; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres

# Suppress dotenv only in this disposable server, keeping index.ts as its boot path.
REPO_ROOT="$repo_root" node --input-type=module > "$run_dir/no-dotenv.mjs" <<'NODE'
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dotenv = pathToFileURL(resolve(process.env.REPO_ROOT, 'SparkyFitnessServer/node_modules/dotenv/lib/main.js')).href;
console.log(`import dotenv from ${JSON.stringify(dotenv)}; dotenv.config = () => ({ parsed: {} });`);
NODE
(
  cd "$repo_root/SparkyFitnessServer"
  exec setsid env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
    NODE_ENV=development \
    SPARKY_FITNESS_DB_HOST=127.0.0.1 SPARKY_FITNESS_DB_PORT="$db_port" \
    SPARKY_FITNESS_DB_NAME=player_e2e SPARKY_FITNESS_DB_USER=postgres \
    SPARKY_FITNESS_DB_PASSWORD="$password" \
    SPARKY_FITNESS_APP_DB_USER=player_app SPARKY_FITNESS_APP_DB_PASSWORD="$password" \
    SPARKY_FITNESS_SERVER_PORT="$server_port" \
    SPARKY_FITNESS_FRONTEND_URL="$preview_origin" BETTER_AUTH_URL="$preview_origin" \
    BETTER_AUTH_SECRET="$auth_secret" SPARKY_FITNESS_API_ENCRYPTION_KEY="$encryption_key" \
    SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS=true SPARKY_FITNESS_LOG_LEVEL=error \
    SPARKY_FITNESS_CUSTOM_UPLOADS_DIRECTORY="$run_dir/uploads" \
    ./node_modules/.bin/tsx --import "$run_dir/no-dotenv.mjs" index.ts
) > "$run_dir/server.log" 2>&1 &
server_pid=$!
for attempt in {1..120}; do
  kill -0 "$server_pid"
  if curl --fail --silent "http://localhost:${server_port}/api/auth/ok"; then
    break
  fi
  sleep 1
done
curl --fail --silent "http://localhost:${server_port}/api/auth/ok"
```

The normal server startup applies migrations and RLS to the fresh database. The
app child receives only the inline isolated environment; Docker retains the
current shell's context settings. Credentials are random and disposable. Keep
this shell open; its EXIT/INT/TERM traps own cleanup, including on failure.

### Build and start production preview

Still in the same shell, run:

```bash
cd "$repo_root/SparkyFitnessFrontend"
VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" pnpm exec vite build
(
  exec setsid env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
    NODE_ENV=development VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" \
    pnpm exec vite preview --host localhost --port "$preview_port" --strictPort
) > "$run_dir/preview.log" 2>&1 &
preview_pid=$!
for attempt in {1..120}; do
  kill -0 "$preview_pid"
  if curl --fail --silent "$preview_origin/api/auth/ok"; then
    break
  fi
  sleep 1
done
curl --fail --silent "$preview_origin/api/auth/ok"
printf '\nOpen %s; logs: %s\n' "$preview_origin" "$run_dir"
```

Both Vite invocations receive the backend host/port; the preview API proxy must
target this server. Do not use the development server. Open `$preview_origin` in
a fresh Chromium profile at the viewport specified above. Create a synthetic
ordinary user through `/api/auth/sign-up/email`, mark only that user's disposable
`onboarding_status` complete, then sign in through the preview origin.

Create a synthetic fixed-date Program named **Phone Cardio Acceptance**, goal
**Verify four protocols**, dates **2026-10-01–2026-10-18**, with phase **Testing**
(goal **Measure recovery**), one week spanning **2026-10-08–2026-10-14**, and a
**Scheduled ramp** Planned Session on **2026-10-08**, bound to `ramp`. API fixture
creation is fine; create every Test Attempt through the web form.

### Cleanup after the checks

Save screenshots and logs first, close the test browser, then run in the same
shell (even if a check failed):

```bash
cleanup
trap - EXIT INT TERM
unset password auth_secret encryption_key
cd "$repo_root"
test ! -d "$run_dir/uploads"
test -z "$(docker ps -aq --filter "name=^/${container_name}$")"
printf 'Cleaned disposable database, process groups and uploads; logs retained in %s\n' "$run_dir"
```

This stops only the tracked server/preview process groups, removes only the
container this shell created (including its anonymous volume), and removes its
isolated uploads. Logs and the temporary dotenv preload remain in `$run_dir` for
evidence. Do not remove other containers or broad temporary directories.

## Entry, reload and edit

For each protocol below, enter the first attempt on **2026-10-08**, save, reload,
enter the second on **2026-10-15**, save and reload. Tap the first history row's
**Edit**, verify all original fields, replace them with the edit values, save and
reload again. Expect exactly two records, unchanged attempt identity, correct
dates/values in history, and updated graph points. Capture the filled form, edit
form, final chart and final history at the phone viewport.

| Protocol                               | First values                            | Second values                           | Edit first to                           | Expected final result                                                                                                 |
| -------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cooper run                             | 2400 m                                  | 2550 m                                  | 2450 m                                  | Two distances: 2,450 and 2,550 m; two plotted points                                                                  |
| Five 6-second sprints, 54-second rests | 900, 800, 700, 600, 500 W               | 0, 0, 0, 0, 0 W                         | 1000, 800, 700, 600, 500 W              | Five effort series / ten points; maximum 1000 W, drop-off 500 W (50.0%); all-zero attempt maximum/drop-off 0 W (0.0%) |
| Two 30-second efforts, 60-second rest  | Peak/average 800/600, 750/550 W         | 850/650, 800/600 W                      | 810/610, 760/560 W                      | All four measurements retained; four series / eight points                                                            |
| Ramp (100 W initially, +20 W/min)      | 300 W, peak 180 bpm, one-minute 180 bpm | 320 W, peak 181 bpm, one-minute 185 bpm | 310 W, peak 182 bpm, one-minute 182 bpm | Watts and HRR series / four points; edited HRR 0 bpm and standalone HRR −4 bpm                                        |

For **ramp**, open the Program first and tap the Planned Session's **Record Test
Attempt**. Confirm protocol, assessment selection and prefilled date. Retain that
selection on save and edit. The second attempt must use **Standalone Test
Attempt**. After editing, reload the Program: the same Planned Session must show
**Completed** and **Linked Test Attempt: 2026-10-08**. Capture before/after Program
history too. Check a positive HRR in the form (e.g. peak 181, one-minute 145 →
36 bpm) before replacing it with the zero/negative boundary values above.

## Phone layout and evidence gate

- Tap the controls using touch emulation; enter numbers using keyboard input.
  For automated Chromium date fields, the native input setter followed by
  bubbling `input`/`change` events is an acceptable equivalent of date-picker
  entry. Do not submit forms through an API or inject saved attempts.
- Confirm no horizontal document overflow; the form, chart, date ticks, legend,
  history values and Edit/Save actions must fit and remain readable. Scroll each
  chart into view, confirm the expected series/point counts and inspect the
  screenshot. Tap plotted points and confirm the date and values in the tooltip.
  In dark mode, measure the tooltip date against its background: require at least
  **4.5:1** contrast (the unthemed power tooltip previously measured **1.10:1**).
- Save dated scenario outcomes, viewport settings, production build/server logs,
  before/after screenshots, and the commit tested. Do not claim actual iOS Safari
  or physical-device acceptance from Chromium emulation.
- Stop the preview, server and browser and remove only the disposable container
  after the run, including on failure.

## Recorded run

Passed on **2026-10-18 04:57 UTC** against base `c7358571a` plus the shared
power-tooltip theme fix, using PostgreSQL 18.3, server 3395 and production preview 8095. All four protocols passed the procedure above: two dates, saved edits with
stable IDs and no duplicates, literal history values, actual chart point counts
(2/10/8/4), touch tooltips and no horizontal document overflow. Ramp's linked
attempt retained its assessment through editing; the other remained standalone;
the reloaded Program showed Completed and the linked date. HRR 36 preview,
0 saved and −4 saved were verified. Final screenshots were visually inspected.

The initial dark sprint tooltip failed the contrast gate at **1.10:1**; reusing
the existing shared tooltip theme raised its date contrast to **16.29:1**, matching
the other three charts. The repeatable procedure is the committed acceptance
protection; the disposable browser driver remains outside Git.

Local run evidence is retained under the owner's
`orch-20261018d/shots-95/`: `{cooper_run,sprint_6s,power_30s,ramp}-before-entry.png`,
`*-edit.png`, `*-after-chart.png`, `*-after-history.png`, `*-tooltip.png`,
`ramp-positive-hrr.png`, `ramp-program-{before,after}.png`, and
`evidence/results.json` plus build/server logs. `red/sprint_6s-tooltip.png` and
`red/failure.txt` preserve the failing contrast probe. These are local operator
artifacts, not portable repository links. An unrelated release-check network-error
toast appears above the final Program screenshot; its completed row remains
visible. This run does not establish physical iPhone/Safari behavior.
