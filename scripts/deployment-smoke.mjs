import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const timeout = 30_000;

export function assertSnapshot(snapshot, expectedEntry) {
  assert.equal(
    snapshot.entry,
    expectedEntry,
    "Browser is running a different frontend build",
  );
  assert.equal(
    snapshot.controlled,
    true,
    "Service worker is not controlling this page; warm-cache verification was not exercised",
  );
  assert.equal(
    snapshot.unobstructed,
    true,
    "Close open dialogs before capturing the upcoming-workout surface",
  );
  assert.ok(
    snapshot.expected.length > 0,
    "No eligible upcoming workouts; this account cannot exercise the workout-ordering check",
  );
  for (const card of snapshot.expected) {
    assert.match(
      card.workoutSessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Expected workout is missing a stable session UUID",
    );
    assert.ok(
      Array.isArray(card.prescription) && card.prescription.length > 0,
      "Expected workout is missing its session prescription",
    );
  }
  assert.deepEqual(
    snapshot.actual,
    snapshot.expected,
    "Upcoming workout cards differ from the live Training Program schedule",
  );
}

export function expectedWorkoutCards(
  programs,
  plans,
  entries,
  libraryPlans = [],
) {
  const logged = new Set(
    entries
      .flatMap((entry) => [entry, ...(entry.exercises || [])])
      .filter((entry) => entry.workout_plan_assignment_id != null)
      .map((entry) => String(entry.workout_plan_assignment_id)),
  );
  const eligible = (session) =>
    !session.assignments.every((assignment) =>
      logged.has(String(assignment.id)),
    );
  const card = (plan, session, plannedSession = null) => ({
    workoutSessionId: session.id,
    workoutPlanId: String(plan.id),
    trainingProgramSessionId: plannedSession?.id ?? null,
    prescription: session.assignments,
  });
  const plannedSessions = programs.flatMap((program) =>
    program.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) => week.sessions),
    ),
  );
  const linkedPlanIds = new Set(
    plannedSessions.map((session) => String(session.workout_plan_id)),
  );
  const candidates = new Map(plans.map((plan) => [String(plan.id), plan]));
  for (const plan of libraryPlans) {
    const ownedAndBound = programs.some(
      (program) =>
        program.user_id === plan.user_id &&
        program.phases.some((phase) =>
          phase.weeks.some((week) =>
            week.sessions.some(
              (session) => String(session.workout_plan_id) === String(plan.id),
            ),
          ),
        ),
    );
    if (ownedAndBound && !candidates.has(String(plan.id))) {
      candidates.set(String(plan.id), plan);
    }
  }
  const byId = new Map(
    [...candidates.values()].flatMap((plan) =>
      plan.sessions.map((session) => [session.id, { plan, session }]),
    ),
  );
  // Choose the whole earliest day before filtering logged prescriptions, just
  // as the dashboard does; never promote a later day when today's cards are logged.
  const pending = plannedSessions
    .filter((session) => {
      const candidate = byId.get(session.workout_session_id);
      return (
        session.status === "planned" &&
        candidate &&
        String(candidate.plan.id) === String(session.workout_plan_id)
      );
    })
    .sort((left, right) =>
      left.effective_date.localeCompare(right.effective_date),
    );
  const expected = [];
  const nextDate = pending[0]?.effective_date;
  for (const planned of pending) {
    if (planned.effective_date !== nextDate) break;
    const { plan, session } = byId.get(planned.workout_session_id);
    if (eligible(session)) expected.push(card(plan, session, planned));
  }
  for (const plan of plans) {
    const session = plan.next_session;
    if (session && eligible(session) && !linkedPlanIds.has(String(plan.id))) {
      expected.push(card(plan, session));
    }
  }
  return expected;
}

// Also used as the browser wait predicate: no label or whole-plan fallback.
export function readWorkoutCards(expected) {
  const actual = [...document.querySelectorAll("button")]
    .filter((button) => button.textContent.trim() === "Start Workout")
    .map((button) => {
      const root = button.closest("[data-workout-session-id]");
      return {
        workoutSessionId: root?.getAttribute("data-workout-session-id") ?? null,
        workoutPlanId: root?.getAttribute("data-workout-plan-id") ?? null,
        trainingProgramSessionId:
          root?.getAttribute("data-training-program-session-id") || null,
        prescription: JSON.parse(
          root?.getAttribute("data-workout-session-prescription") || "null",
        ),
      };
    });
  if (expected === undefined) return actual;
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  };
  return (
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected))
  );
}

async function snapshot(page) {
  const data = await page.evaluate(async () => {
    async function get(path) {
      const response = await fetch(`/api${path}`, { credentials: "include" });
      if (!response.ok)
        throw new Error(
          `${path}: HTTP ${response.status}; use a signed-in, owner-account Diary in English`,
        );
      return response.json();
    }
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const [programs, plans, entries, libraryPlans] = await Promise.all([
      get("/training-programs"),
      get(`/workout-plan-templates/active/${today}`),
      get(`/v2/exercise-entries/by-date?selectedDate=${today}`),
      get("/workout-plan-templates"),
    ]);
    return {
      entry: new URL(
        document.querySelector('script[type="module"][src]')?.src ||
          location.href,
      ).pathname,
      controlled: Boolean(navigator.serviceWorker?.controller),
      unobstructed: !document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      ),
      programs,
      plans,
      entries,
      libraryPlans,
    };
  });
  const { programs, plans, entries, libraryPlans, ...surface } = data;
  return {
    ...surface,
    expected: expectedWorkoutCards(programs, plans, entries, libraryPlans),
    actual: await page.evaluate(readWorkoutCards),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      url: { type: "string" },
      "cdp-url": { type: "string" },
      container: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm deployment:smoke --phase warm|verify --url https://HOST/ --cdp-url http://127.0.0.1:9222 --output /tmp/deployment-smoke [--container FRONTEND_CONTAINER]

Use a dedicated Chrome profile, signed in to the public-origin Diary in English.
Run warm BEFORE deployment and verify AFTER deployment, with the same browser and output directory.
Verify compares the loaded entry asset with the running container and checks exact session UUIDs and prescriptions for every earliest-day Program workout plus unrelated active standalone plans.
Inactive owner plans bound by a Program remain eligible; shared or unbound inactive plans do not become standalone previews.
Caching remains enabled. Stale builds trigger a normal service-worker update and one reload.
The browser stays open. Reports and screenshots contain private workout data, but no cookies.`);
    return;
  }
  assert.ok(
    ["warm", "verify"].includes(values.phase),
    "--phase must be warm or verify",
  );
  assert.ok(
    values.url && values["cdp-url"] && values.output,
    "--url, --cdp-url, and --output are required",
  );
  const url = new URL(values.url);
  assert.ok(
    url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password,
    "--url must be the application root without credentials, query, or fragment",
  );
  assert.ok(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)),
    "Use HTTPS for the public origin",
  );
  const output = resolve(values.output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const statePath = resolve(output, "warm.json");
  const report = {
    phase: values.phase,
    url: url.href,
    startedAt: new Date().toISOString(),
  };
  let browser;
  try {
    browser = await puppeteer.connect(
      values["cdp-url"].startsWith("ws")
        ? { browserWSEndpoint: values["cdp-url"], defaultViewport: null }
        : { browserURL: values["cdp-url"], defaultViewport: null },
    );
    const pages = await browser.pages();
    const page = pages.find((candidate) => candidate.url() === url.href);
    assert.ok(
      page,
      `Open ${url.href} in the connected browser, sign in, and select the owner's Diary in English`,
    );
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    const session = await page.createCDPSession();
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.detach();
    if (values.phase === "warm") {
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForFunction(() =>
        Boolean(navigator.serviceWorker?.controller),
      );
      const baseline = await snapshot(page);
      assert.ok(
        baseline.expected.length > 0,
        "This account has no eligible upcoming workouts",
      );
      report.baseline = baseline;
      report.targetId = targetInfo.targetId;
      report.browserEndpoint = browser.wsEndpoint();
      await writeFile(statePath, JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
    } else {
      assert.ok(values.container, "--container is required for verify");
      const warm = JSON.parse(await readFile(statePath, "utf8"));
      assert.equal(warm.url, url.href, "Warm and verify origins must match");
      assert.equal(
        warm.browserEndpoint,
        browser.wsEndpoint(),
        "Keep the same browser running between warm and verify",
      );
      assert.equal(
        warm.targetId,
        targetInfo.targetId,
        "Keep the warmed Diary tab open between warm and verify",
      );
      const inspection = JSON.parse(
        execFileSync("docker", ["inspect", values.container], {
          encoding: "utf8",
        }),
      )[0];
      assert.equal(
        inspection.State.Health?.Status,
        "healthy",
        "Frontend container is not healthy",
      );
      const html = execFileSync(
        "docker",
        ["exec", values.container, "cat", "/usr/share/nginx/html/index.html"],
        { encoding: "utf8" },
      );
      const expectedEntry = html.match(
        /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/,
      )?.[1];
      assert.ok(expectedEntry, "Cannot identify the container entry asset");
      report.image = inspection.Image;
      report.expectedEntry = expectedEntry;
      report.warmedEntry = warm.baseline.entry;
      await page.reload({ waitUntil: "networkidle2" });
      report.initial = await snapshot(page);
      if (report.initial.entry !== expectedEntry) {
        await page.evaluate(async () => {
          const registrations =
            await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            registrations.map((registration) => registration.update()),
          );
        });
        await page.waitForFunction(async () => {
          const registrations =
            await navigator.serviceWorker.getRegistrations();
          return registrations.every(
            (registration) => !registration.installing && !registration.waiting,
          );
        });
        await page.reload({ waitUntil: "networkidle2" });
        report.workerUpdated = true;
      }
      // Wait for the exact-session Program query and prescription to render.
      const expected = (await snapshot(page)).expected;
      await page.waitForFunction(readWorkoutCards, {}, expected);
      report.final = await snapshot(page);
      assertSnapshot(report.final, expectedEntry);
      await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent.trim() === "Start Workout")
          .closest("[data-workout-session-id]")
          .scrollIntoView({ block: "start" }),
      );
      await page.screenshot({ path: resolve(output, "upcoming-workouts.png") });
    }
    report.passed = true;
    console.log(
      `${values.phase === "warm" ? "WARMED" : "PASS"} ${url.origin}: ${values.phase === "warm" ? report.baseline.entry : `${report.final.actual.length} workout cards; ${report.final.entry}`}`,
    );
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    throw error;
  } finally {
    await writeFile(
      resolve(output, `${values.phase}.json`),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    await browser?.disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
