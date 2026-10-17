import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.TMPDIR ||= resolve(root, "tmp-codex");
await mkdir(process.env.TMPDIR, { recursive: true });
const output = await mkdtemp(resolve(process.env.TMPDIR, "player-e2e-"));
const container = `zfit-player-e2e-${process.pid}-${randomBytes(4).toString("hex")}`;
const origin = "http://localhost:8080";
const children = [];
let stage = "startup";
let browser,
  page,
  containerStarted = false;
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "development",
};
function docker(...args) {
  if (args[0] !== "rm") abort.signal.throwIfAborted();
  return execFileSync("docker", args, {
    encoding: "utf8",
    env,
    timeout: 120_000,
  }).trim();
}
async function freePort(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const chosen = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return chosen;
}
function start(name, command, args, cwd, extra = {}) {
  abort.signal.throwIfAborted();
  const log = createWriteStream(resolve(output, `${name}.log`));
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("error", (error) => {
    child.startError = error;
  });
  children.push(child);
  return child;
}
async function waitFor(check, description, milliseconds = 120_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    abort.signal.throwIfAborted();
    for (const child of children) {
      if (child.startError) throw child.startError;
      assert.equal(
        child.exitCode,
        null,
        `Process exited (${child.exitCode}); see ${output}`,
      );
    }
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}; see ${output}`);
}
async function request(path, body, cookie) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  assert.ok(response.ok, `${path}: ${response.status} ${text}`);
  return {
    data: JSON.parse(text),
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
function sql(query) {
  return docker(
    "exec",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    "player_e2e",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    query,
  );
}
async function tap(selector) {
  const element = await page.waitForSelector(selector, { visible: true });
  await element.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await element.tap();
  await element.dispose();
}
async function cleanup() {
  const results = await Promise.allSettled([
    browser?.close(),
    ...children.map(async (child) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      if (child.exitCode === null)
        await Promise.race([
          new Promise((resolve) => child.once("close", resolve)),
          delay(3000),
        ]);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }),
  ]);
  try {
    if (containerStarted) docker("rm", "-f", "-v", container);
  } catch (error) {
    results.push({ status: "rejected", reason: error });
  }
  for (const result of results)
    if (result.status === "rejected") {
      console.error(`FAIL player:e2e cleanup — ${result.reason.message}`);
      process.exitCode = 1;
    }
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => abort.abort(new Error(signal)));
const watchdog = setTimeout(
  () => abort.abort(new Error("10 minute timeout")),
  600_000,
);

async function run() {
  await freePort(8080); // Fail before creating resources if the sign-in origin is occupied.
  const serverPort = await freePort();
  const password = randomBytes(24).toString("hex");
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_DB=player_e2e",
    "-p",
    `127.0.0.1:${process.env.PLAYER_E2E_DB_PORT || ""}:5432`,
    "postgres:18.3-alpine",
  );
  containerStarted = true;
  const dbPort = docker("port", container, "5432/tcp").split(":").at(-1);
  await waitFor(() => {
    try {
      return docker(
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      ).includes("accepting connections");
    } catch {
      return false;
    }
  }, "PostgreSQL");
  // index.ts remains the boot path; suppress dotenv only in this disposable process.
  const preload = resolve(output, "no-dotenv.mjs");
  await writeFile(
    preload,
    `import dotenv from ${JSON.stringify(new URL("./SparkyFitnessServer/node_modules/dotenv/lib/main.js", new URL("../", import.meta.url)).href)}; dotenv.config = () => ({ parsed: {} });\n`,
  );
  start(
    "server",
    resolve(root, "SparkyFitnessServer/node_modules/.bin/tsx"),
    ["--import", preload, "index.ts"],
    resolve(root, "SparkyFitnessServer"),
    {
      SPARKY_FITNESS_DB_HOST: "127.0.0.1",
      SPARKY_FITNESS_DB_PORT: dbPort,
      SPARKY_FITNESS_DB_NAME: "player_e2e",
      SPARKY_FITNESS_DB_USER: "postgres",
      SPARKY_FITNESS_DB_PASSWORD: password,
      SPARKY_FITNESS_APP_DB_USER: "player_app",
      SPARKY_FITNESS_APP_DB_PASSWORD: password,
      SPARKY_FITNESS_FRONTEND_URL: origin,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
      SPARKY_FITNESS_API_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      SPARKY_FITNESS_SERVER_PORT: String(serverPort),
      SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS: "true",
      SPARKY_FITNESS_LOG_LEVEL: "error",
      SPARKY_FITNESS_CUSTOM_UPLOADS_DIRECTORY: resolve(output, "uploads"),
    },
  );
  const frontEnv = {
    VITE_BACKEND_HOST: "127.0.0.1",
    VITE_BACKEND_PORT: String(serverPort),
  };
  stage = "frontend build";
  const build = start(
    "build",
    resolve(root, "SparkyFitnessFrontend/node_modules/.bin/vite"),
    ["build"],
    resolve(root, "SparkyFitnessFrontend"),
    frontEnv,
  );
  await new Promise((resolve, reject) => {
    build.once("error", reject);
    build.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Build failed: ${output}/build.log`)),
    );
  });
  children.splice(children.indexOf(build), 1);
  start(
    "preview",
    resolve(root, "SparkyFitnessFrontend/node_modules/.bin/vite"),
    ["preview", "--host", "localhost", "--port", "8080", "--strictPort"],
    resolve(root, "SparkyFitnessFrontend"),
    frontEnv,
  );
  stage = "server and preview readiness";
  await waitFor(async () => {
    try {
      return (await fetch(`${origin}/api/auth/ok`)).ok;
    } catch {
      return false;
    }
  }, "server and preview");
  stage = "synthetic seed";
  const email = "player-e2e@example.com";
  const signedUp = await request("/auth/sign-up/email", {
    email,
    password,
    name: "Player E2E",
  });
  const userId = signedUp.data.user.id;
  assert.match(userId, /^[a-f0-9-]{36}$/i);
  sql(
    `UPDATE onboarding_status SET onboarding_complete = true WHERE user_id = '${userId}'; DELETE FROM rate_limit;`,
  );
  const signedIn = await request("/auth/sign-in/email", { email, password });
  const exerciseId = sql(
    `INSERT INTO exercises(name, category, modality, user_id, is_custom, source) VALUES ('E2E Squat', 'Strength', 'weight_reps', '${userId}', true, 'custom') RETURNING id`,
  ).split("\n")[0];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const plan = (
    await request(
      "/workout-plan-templates",
      {
        plan_name: "E2E Plan",
        start_date: today,
        is_active: true,
        schedule_type: "sequential",
        entry_mode: "prompt",
        currentClientDate: today,
        sessions: [
          {
            name: "E2E Strength",
            sort_order: 0,
            day_of_week: null,
            assignments: [
              {
                exercise_id: exerciseId,
                sort_order: 0,
                sets: [
                  {
                    set_number: 1,
                    reps: 8,
                    weight: 20,
                    rest_time: 0,
                    set_type: "Working Set",
                  },
                ],
              },
            ],
          },
        ],
      },
      signedIn.cookie,
    )
  ).data;
  // Bind a Program: its dashboard restart path previously overwrote the saved draft (#79).
  await request(
    "/training-programs",
    {
      name: "E2E Program",
      goal: "Verify persistence",
      start_date: today,
      end_date: today,
      schedule_type: "fixed",
      phases: [
        {
          name: "E2E Phase",
          goal: "Verify persistence",
          weeks: [
            {
              start_date: today,
              end_date: today,
              sessions: [
                {
                  name: "E2E Strength",
                  scheduled_date: today,
                  workout_session_id: plan.sessions[0].id,
                },
              ],
            },
          ],
        },
      ],
    },
    signedIn.cookie,
  );
  stage = "browser sign-in";
  abort.signal.throwIfAborted();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  if (abort.signal.aborted) {
    await browser.close();
    abort.signal.throwIfAborted();
  }
  page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(`${origin}/login`, { waitUntil: "networkidle2" });
  // Sign in through the browser origin so Better Auth creates real browser cookies.
  await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(`Browser sign-in: ${response.status}`);
      const announcement = await fetch("/api/announcement/current").then((r) =>
        r.json(),
      );
      if (announcement?.id)
        localStorage.setItem("dismissedAnnouncementId", announcement.id);
    },
    { email, password },
  );
  await page.goto(origin, { waitUntil: "networkidle2" });
  const startSelector = 'button[aria-label^="Start Workout: E2E Strength"]';
  stage = "log performed set";
  await tap(startSelector);
  await page.waitForSelector("#set-weight-0-0");
  for (const [selector, value] of [
    ["#set-weight-0-0", "37"],
    ["#set-reps-0-0", "11"],
  ]) {
    await tap(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.type(value);
  }
  await tap('[aria-label="Complete set 1"]');
  await page.waitForSelector('[aria-label="Expand E2E Squat"]');
  await tap('[aria-label="Back"]');
  await page.waitForFunction(() => location.pathname === "/");
  stage = "draft restoration";
  await page.reload({ waitUntil: "networkidle2" });
  await tap(startSelector);
  await page.waitForFunction(() =>
    document.querySelector('#set-weight-0-0, [aria-label="Expand E2E Squat"]'),
  );
  if (await page.$('[aria-label="Expand E2E Squat"]'))
    await tap('[aria-label="Expand E2E Squat"]');
  await page.waitForSelector("#set-weight-0-0");
  assert.deepEqual(
    await page.evaluate(() => ({
      weight: document.querySelector("#set-weight-0-0").value,
      reps: document.querySelector("#set-reps-0-0").value,
      completed: document
        .querySelector('[aria-label="Complete set 1"]')
        .getAttribute("data-state"),
    })),
    { weight: "37", reps: "11", completed: "checked" },
    "Draft must survive navigation, reload and Dashboard restart",
  );
  stage = "finish and diary persistence";
  await tap("::-p-text(Finish Workout)");
  await page.waitForSelector("::-p-text(Workout complete)");
  const sets = JSON.parse(
    sql(
      `SELECT COALESCE(json_agg(json_build_object('weight',s.weight,'reps',s.reps,'completed',s.completed_at IS NOT NULL)), '[]') FROM exercise_entry_sets s JOIN exercise_entries e ON e.id=s.exercise_entry_id WHERE e.user_id='${userId}' AND e.exercise_id='${exerciseId}' AND e.entry_date='${today}'`,
    ),
  );
  assert.deepEqual(
    sets,
    [{ weight: 37, reps: 11, completed: true }],
    "Diary must contain exactly the performed set",
  );
}

try {
  await Promise.race([
    run(),
    new Promise((_, reject) =>
      abort.signal.addEventListener(
        "abort",
        () => reject(abort.signal.reason),
        { once: true },
      ),
    ),
  ]);
  console.log("PASS player:e2e — draft restored and performed set saved");
} catch (error) {
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  await writeFile(resolve(output, "failure.txt"), `${stage}: ${error.stack}\n`);
  console.error(
    `FAIL player:e2e — ${stage}: ${error.message}; artifacts: ${output}`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await cleanup();
}
