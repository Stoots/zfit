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
  assert.deepEqual(
    snapshot.actual,
    snapshot.expected,
    "Upcoming workout cards differ from the live Training Program schedule",
  );
}

async function snapshot(page) {
  return page.evaluate(async () => {
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
    const [programs, plans, entries] = await Promise.all([
      get("/training-programs"),
      get(`/workout-plan-templates/active/${today}`),
      get(`/v2/exercise-entries/by-date?selectedDate=${today}`),
    ]);
    const logged = new Set(
      entries
        .flatMap((entry) => [entry, ...(entry.exercises || [])])
        .filter((entry) => entry.workout_plan_assignment_id != null)
        .map((entry) => String(entry.workout_plan_assignment_id)),
    );
    const eligible = plans.filter(
      (plan) =>
        plan.next_assignment &&
        !(plan.assignments || []).some((assignment) =>
          logged.has(String(assignment.id)),
        ),
    );
    const sessions = programs.flatMap((program) =>
      program.phases.flatMap((phase) =>
        phase.weeks.flatMap((week) => week.sessions),
      ),
    );
    const linkedIds = new Set(
      sessions.map((session) => String(session.workout_plan_id)),
    );
    const pending = sessions
      .filter((session) => session.status === "planned")
      .sort((left, right) =>
        left.effective_date.localeCompare(right.effective_date),
      );
    const rankedIds = [
      ...new Set(pending.map((session) => String(session.workout_plan_id))),
    ];
    const byId = new Map(eligible.map((plan) => [String(plan.id), plan]));
    const nextId = rankedIds.find((id) => byId.has(id));
    const expected = [
      ...(nextId === undefined ? [] : [byId.get(nextId).plan_name]),
      ...eligible
        .filter((plan) => !linkedIds.has(String(plan.id)))
        .map((plan) => plan.plan_name),
    ];
    const actual = [...document.querySelectorAll("button")]
      .filter((button) => button.textContent.trim() === "Start Workout")
      .map((button) =>
        button
          .closest("div.mb-3")
          ?.querySelector("p")
          ?.textContent.replace(/^(Sequential|Active) plan: /, ""),
      );
    return {
      entry: new URL(
        document.querySelector('script[type="module"][src]')?.src ||
          location.href,
      ).pathname,
      controlled: Boolean(navigator.serviceWorker?.controller),
      unobstructed: !document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      ),
      expected,
      actual,
    };
  });
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
Verify compares the loaded entry asset with the running container and checks the next program workout plus standalone plans.
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
      // Wait for the Training Program query to replace the initial active-plan order.
      const expected = (await snapshot(page)).expected;
      await page.waitForFunction(
        (names) => {
          const actual = [...document.querySelectorAll("button")]
            .filter((button) => button.textContent.trim() === "Start Workout")
            .map((button) =>
              button
                .closest("div.mb-3")
                ?.querySelector("p")
                ?.textContent.replace(/^(Sequential|Active) plan: /, ""),
            );
          return JSON.stringify(actual) === JSON.stringify(names);
        },
        {},
        expected,
      );
      report.final = await snapshot(page);
      assertSnapshot(report.final, expectedEntry);
      await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent.trim() === "Start Workout")
          .closest("div.mb-3")
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
