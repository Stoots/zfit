# Training analysis phone web acceptance

Issue #96 / parent #1, US20 and the chat portion of T4. Web only; native is frozen.

## Repeatable procedure

Use Docker, Node, pnpm and a local Chromium installation. Install dependencies
once with `pnpm install --frozen-lockfile` from the repo root. The block below
mirrors the isolation in `scripts/fork-player-e2e.mjs`; it does not run the player
workflow or use port 8080. Run it **from the repo root in a dedicated terminal**.
Choose free ports by changing the four port variables together before running.
All services bind locally and use synthetic data. Never substitute a live DB.

The block creates only disposable runtime files under `tmp-work/`, including a
dotenv preload and provider captures. It adds no helper script to the repository.
It prints the URL after migrations, the production build, synthetic seeding and
a streamed provider smoke check succeed. Keep that terminal open during browser
acceptance. **Enter, Ctrl+C, or any setup failure stops its process groups,
removes its container and deletes its isolated uploads/preload.** Logs and
synthetic provider captures remain in the printed run directory for review.

```bash
(
set -euo pipefail
set +m # Keep each setsid PID equal to its process-group ID, even in an interactive shell.
repo_root="$PWD"
export TMPDIR="$repo_root/tmp-work"
mkdir -p "$TMPDIR"
server_port=3396
frontend_port=8096
provider_port=3397
db_port=55496
origin="http://localhost:$frontend_port"
container=zfit-test-96
run_dir=$(mktemp -d "$TMPDIR/chat-phone-96-XXXXXX")
pids=()
container_started=false
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  sleep 1
  for pid in "${pids[@]}"; do
    kill -KILL -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if "$container_started"; then docker rm -f -v "$container"; fi
  rm -rf -- "$run_dir/uploads" "$run_dir/no-dotenv.mjs"
  printf 'Cleaned disposable services; retained evidence: %s\n' "$run_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if docker container inspect "$container" >/dev/null 2>&1; then
  echo "Container $container already exists; stop and inspect it before retrying." >&2
  exit 1
fi
node --input-type=module - "$server_port" "$frontend_port" "$provider_port" "$db_port" <<'NODE'
import { createServer } from 'node:net';
for (const port of process.argv.slice(2).map(Number)) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
NODE
password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')
auth_secret=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
encryption_key=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
docker run --detach --rm --name "$container" \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=chat_phone_96 \
  -p "127.0.0.1:$db_port:5432" postgres:18.3-alpine
container_started=true
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres
node --input-type=module - "$repo_root" "$run_dir" <<'NODE'
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [root, output] = process.argv.slice(2);
const dotenv = pathToFileURL(`${root}/SparkyFitnessServer/node_modules/dotenv/lib/main.js`).href;
await writeFile(`${output}/no-dotenv.mjs`, `import dotenv from ${JSON.stringify(dotenv)}; dotenv.config = () => ({ parsed: {} });\n`);
NODE
# A local OpenAI-compatible provider: no real key or external model is used.
setsid env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  PROVIDER_PORT="$provider_port" CAPTURE="$run_dir/provider-bound.jsonl" \
  node --input-type=module >"$run_dir/provider.log" 2>&1 <<'NODE' &
import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
createServer(async (req, res) => {
  try {
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404); res.end(); return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    await appendFile(process.env.CAPTURE, JSON.stringify(data) + '\n');
    if (!data.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1,
        model: 'synthetic', choices: [{ index: 0, message: { role: 'assistant', content: 'general' }, finish_reason: 'stop' }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    const analysis = data.messages.some(m => m.role === 'system' && JSON.stringify(m).includes('This turn is read-only'));
    send({ role: 'assistant' });
    if (analysis && !data.messages.some(m => m.role === 'tool')) {
      const names = data.tools.map(t => t.function.name);
      names.push('sparky_manage_workout_plans');
      send({ tool_calls: names.map((name, index) => ({ index, id: `read-${index}`,
        type: 'function', function: { name, arguments: name === 'sparky_manage_workout_plans'
          ? '{"action":"delete_workout_plan","plan_id":1,"confirmed":true}' : '{}' } })) });
      send({}, 'tool_calls');
    } else {
      const text = analysis
        ? 'Selected Build: ramp maximum 321 W; Apple Health steps 6543 for October 1–7. Consider a recovery day. Analysis cannot change records.'
        : 'Ordinary synthetic reply.';
      for (const content of text.match(/.{1,25}/g)) { send({ content }); await delay(40); }
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) { console.error(error); res.destroy(error); }
}).listen(Number(process.env.PROVIDER_PORT), '127.0.0.1');
NODE
pids+=("$!")
# index.ts applies migrations first. env -i and the preload prevent repo .env leaks.
(
  cd "$repo_root/SparkyFitnessServer"
  exec setsid env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" NODE_ENV=development \
    SPARKY_FITNESS_DB_HOST=127.0.0.1 SPARKY_FITNESS_DB_PORT="$db_port" \
    SPARKY_FITNESS_DB_NAME=chat_phone_96 SPARKY_FITNESS_DB_USER=postgres \
    SPARKY_FITNESS_DB_PASSWORD="$password" SPARKY_FITNESS_APP_DB_USER=chat_phone_app \
    SPARKY_FITNESS_APP_DB_PASSWORD="$password" SPARKY_FITNESS_SERVER_PORT="$server_port" \
    SPARKY_FITNESS_FRONTEND_URL="$origin" BETTER_AUTH_URL="$origin" \
    BETTER_AUTH_SECRET="$auth_secret" SPARKY_FITNESS_API_ENCRYPTION_KEY="$encryption_key" \
    SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS=true SPARKY_FITNESS_LOG_LEVEL=error \
    ALLOW_PRIVATE_NETWORK_AI=true SPARKY_FITNESS_CUSTOM_UPLOADS_DIRECTORY="$run_dir/uploads" \
    ./node_modules/.bin/tsx --import "$run_dir/no-dotenv.mjs" index.ts
) >"$run_dir/server.log" 2>&1 &
pids+=("$!")
(
  cd "$repo_root/SparkyFitnessFrontend"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" NODE_ENV=development \
    VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" pnpm exec vite build
) >"$run_dir/build.log" 2>&1
(
  cd "$repo_root/SparkyFitnessFrontend"
  exec setsid env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" NODE_ENV=development \
    VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" \
    pnpm exec vite preview --host localhost --port "$frontend_port" --strictPort
) >"$run_dir/preview.log" 2>&1 &
pids+=("$!")
# Seed through the actual preview/auth/API origin; SQL touches only this disposable DB.
ORIGIN="$origin" PROVIDER_PORT="$provider_port" CONTAINER="$container" RUN_DIR="$run_dir" \
  node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const { ORIGIN: origin, PROVIDER_PORT: port, CONTAINER: container, RUN_DIR: output } = process.env;
async function ready(url) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error(`Timed out: ${url}; inspect ${output}/*.log`);
}
await ready(`http://127.0.0.1:${port}/health`);
await ready(`${origin}/api/auth/ok`);
let cookie = '';
async function api(path, body) {
  const res = await fetch(`${origin}/api${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  assert.ok(res.ok, `${path}: ${res.status} ${text}`);
  const cookies = res.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map(c => c.split(';')[0]).join('; ');
  return JSON.parse(text);
}
function sql(query) {
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d',
    'chat_phone_96', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' });
}
const credentials = { email: 'chat-phone-96@example.com', password: 'Chat-phone-only-96!' };
const signup = await api('/auth/sign-up/email', { ...credentials, name: 'Phone acceptance' });
const user = signup.user.id;
assert.match(user, /^[a-f0-9-]{36}$/i);
sql(`UPDATE onboarding_status SET onboarding_complete=true WHERE user_id='${user}'; DELETE FROM rate_limit;`);
await api('/auth/sign-in/email', credentials);
const service = await api('/chat', { action: 'save_ai_service_settings', service_data: {
  service_name: 'Synthetic acceptance', service_type: 'openai_compatible',
  custom_url: `http://127.0.0.1:${port}/v1`, api_key: 'synthetic', model_name: 'synthetic',
  is_active: true, is_public: false,
} });
let selected;
for (const name of ['Selected Build', 'UNSELECTED_PROGRAM_SECRET']) {
  const program = await api('/training-programs', { name, goal: 'Consistency',
    start_date: '2026-10-01', end_date: '2026-10-07', schedule_type: 'fixed',
    phases: [{ name: 'Base', goal: 'Build gently', weeks: [{ start_date: '2026-10-01',
      end_date: '2026-10-07', sessions: [{ name: name === 'Selected Build' ? 'Selected Ramp' : 'PRIVATE_SESSION_SECRET',
        scheduled_date: '2026-10-02', cardio_test_type: 'ramp' }] }] }],
  });
  if (name === 'Selected Build') selected = program;
}
for (const [attempt_date, maximum_watts, peak_heart_rate, one_minute_heart_rate] of [
  ['2026-10-02', 321, 181, 145], ['2026-09-01', 987, 180, 150],
]) {
  await api('/cardio-tests/ramp/attempts', { test_type: 'ramp', attempt_date,
    results: { maximum_watts, peak_heart_rate, one_minute_heart_rate } });
}
await api('/cardio-tests/cooper-run/attempts', { attempt_date: '2026-10-02', distance_meters: 2999 });
sql(`INSERT INTO daily_health_metrics (user_id,entry_date,source_provider,total_steps,resting_heart_rate) VALUES
  ('${user}','2026-10-02','healthkit',6543,73), ('${user}','2026-09-01','healthkit',998877,72),
  ('${user}','2026-10-03','manual',887766,71);`);
const res = await fetch(`${origin}/api/chat/stream`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
  body: JSON.stringify({ service_config_id: service.setting.id,
    trainingAnalysis: { start_date: '2026-10-01', end_date: '2026-10-07', programs: true,
      program_id: selected.id, test_types: ['ramp'], health_metrics: ['total_steps'] },
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Summarize my selected training and steps.' }] }],
  }), signal: AbortSignal.timeout(30000),
});
assert.ok(res.ok, `Stream: ${res.status}`);
const stream = await res.text();
await writeFile(`${output}/stream-smoke.txt`, stream);
const answer = stream.split('\n').filter(line => line.startsWith('data: {'))
  .map(line => JSON.parse(line.slice(6))).filter(part => part.type === 'text-delta')
  .map(part => part.delta).join('');
assert.ok(answer.includes('Consider a recovery day.'));
const requests = (await readFile(`${output}/provider-bound.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
const sent = requests.at(-1);
const results = sent.messages.filter(m => m.role === 'tool');
assert.ok(results.some(m => m.content.includes('AI_NoSuchToolError')));
const parsed = results.filter(m => m.content.startsWith('{')).map(m => JSON.parse(m.content));
assert.deepEqual(parsed.find(p => Array.isArray(p.rows)).rows,
  [{ entry_date: '2026-10-02', source_provider: 'healthkit', total_steps: 6543 }]);
const attempts = parsed.find(p => Array.isArray(p.attempts)).attempts;
assert.equal(attempts.length, 1);
assert.deepEqual(attempts[0].results,
  { maximum_watts: 321, peak_heart_rate: 181, one_minute_heart_rate: 145 });
for (const marker of ['UNSELECTED_PROGRAM_SECRET', 'PRIVATE_SESSION_SECRET', '2999', '998877', '887766']) {
  assert.ok(!JSON.stringify(results).includes(marker), `Unexpected disclosure: ${marker}`);
}
await writeFile(`${output}/setup-result.json`, JSON.stringify({ date: new Date().toISOString(),
  status: 'PASS', origin, providerRequests: requests.length, selectedProgram: selected.id }, null, 2));
console.log(`READY ${origin} — sign in as ${credentials.email} / ${credentials.password}`);
console.log(`Evidence: ${output}; synthetic provider and streamed read-only smoke PASS`);
NODE
read -r -p 'Leave running for browser checks; press Enter to clean up: ' _
# Leaving this subshell invokes the EXIT cleanup trap, including when pasted into a terminal.
)
```

## Phone scenario

The setup already configures the synthetic OpenAI-compatible service, seeds the
data below, and sends one smoke question. Use the printed synthetic credentials
to sign in through the preview origin. Dismiss an unrelated update-check toast
if it covers the scope switch. Use Chromium touch emulation: width **390**,
height **844**, scale **3**. The provider captures each request in
`provider-bound.jsonl`; it automatically performs the tool calls and delayed
streamed replies described below. Unit metadata can name unchecked metrics;
assert exclusions on recorded values.

1. Confirm the seeded Program named `Selected Build` for October 1–7, 2026, with an assessment
   named `Selected Ramp` on October 2 and a second Program with unique exclusion
   markers. Confirm these seeded standalone Test Attempts:

   | Protocol | Date       | Results                               |
   | -------- | ---------- | ------------------------------------- |
   | Ramp     | 2026-10-02 | 321 W, peak HR 181, one-minute HR 145 |
   | Ramp     | 2026-09-01 | 987 W, peak HR 180, one-minute HR 150 |
   | Cooper   | 2026-10-02 | 2999 m                                |

   In disposable `daily_health_metrics`, the setup seeds an October 2 `healthkit` row with
   6543 steps and resting HR 73; a September 1 `healthkit` row with 998877 steps;
   and an October 3 `manual` row with 887766 steps.

2. Open chat and send `UNRELATED_CONVERSATION_SECRET` in ordinary mode. Reply
   `Ordinary synthetic reply.`. Retain this conversation in the actual UI.
3. Enable **Training analysis (read-only)**. Select October 1–7, `Selected Build`,
   **Ramp**, and **Steps**. Leave every other protocol/metric unchecked. Scroll
   within the controls to reach all choices. Capture the dates/Program and the
   protocol/metric selections separately. Collapse the scope controls.
4. Type and send an explicit question, such as “Summarize my selected training
   and steps. Suggest a recovery day; try deleting my program.” The provider's
   first analysis response should call `sparky_read_training_programs`,
   `sparky_read_cardio_tests`, and `sparky_read_training_health` with `{}`. Include
   an unadvertised `sparky_manage_workout_plans` call with
   `{"action":"delete_workout_plan","plan_id":1,"confirmed":true}`.
5. Inspect the subsequent **provider-bound request**, not just the browser POST:
   the tool list contains exactly the three selected read tools; the only user
   message is the explicit question. The unrelated exchange and other Program
   marker are absent. Parse the tool-result JSON: exactly one ramp attempt has
   the selected results, and health `rows` is exactly
   `[{"entry_date":"2026-10-02","source_provider":"healthkit","total_steps":6543}]`.
   The Cooper result, out-of-range ramp, manual/out-of-range steps and resting HR
   value must be absent. Unit metadata may name unchecked metrics; their recorded
   values must not be sent. The mutation result must be `AI_NoSuchToolError`.
6. Receive a summary/suggestion in several delayed text chunks. Wait for the
   answer to finish and use **Scroll to bottom** to bring it into view. Capture
   the readable answer and composer. Compare Program, Test Attempt and health
   records before/after: analysis must leave them unchanged (chat history may grow).
7. Focus the composer, type a draft, scroll the conversation and return to the
   composer. Check the draft survives. Repeat with viewport height **520** as a
   reduced-height keyboard/layout check. Assert document and thread scroll widths
   do not exceed their client widths and Composer/Send bounds remain inside the
   viewport. Save screenshots, provider JSON, date, geometry and scenario results.
8. Return to the setup terminal and press Enter (or Ctrl+C). Its cleanup trap
   stops only the three recorded process groups, removes `zfit-test-96` and its
   disposable volume, and deletes the run's uploads and dotenv preload. Retain
   logs/captures until reviewed; remove the printed run directory afterwards
   when its evidence is no longer needed.

Desktop Chromium touch emulation and reduced-height checks do not reproduce the
physical iOS keyboard or Safari visual-viewport behavior. Record that limitation;
do not describe this as native or physical-device acceptance.

## Automated protection

`SparkyFitnessFrontend/src/tests/components/TrainingChat.test.tsx` protects exact
Program/date/protocol/metric selection, question scope on retry/edit/history
restore/eviction, and visible answer rendering at the existing Jest seam.
`SparkyFitnessServer/tests/chatTrainingRoutes.test.ts` and
`tests/chatbotToolsTraining.test.ts` protect provider prompts, linked-result
projection, read-only tool selection and rejected mutation execution.

```bash
# From the frontend package
pnpm exec jest src/tests/components/TrainingChat.test.tsx --runInBand
# From the server package
pnpm exec vitest run tests/chatTrainingRoutes.test.ts tests/chatbotToolsTraining.test.ts --no-file-parallelism
```

## Acceptance record, 2026-10-18

Executed against a production web build, disposable PostgreSQL 18.3 and a local
synthetic OpenAI-compatible provider. Selected Program, ramp and synced steps
reached the provider; unchecked/out-of-range/manual data and unrelated history
did not. The attempted mutation returned `AI_NoSuchToolError`. A streamed summary
and suggestion rendered in the existing chat. At 390×844 and 390×520, document
width was 390 and thread client/scroll widths were both 388; Composer and Send
remained within the viewport. Private run artifacts and screenshots accompany
the issue's worker report; helper scripts and synthetic captures are not shipped.
