import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertAcceptanceReport } from "./assert-acceptance-report.mjs";

const suitePath = "tests/workoutProgramConsolidation.integration.test.ts";
const otherPath = "tests/workoutPlanBulk.integration.test.ts";

function suite(
  path = suitePath,
  names = ["case one", "case two"],
  status = "passed",
) {
  return {
    name: path,
    status: "passed",
    assertionResults: names.map((fullName) => ({ fullName, status })),
  };
}

function report(testResults = [suite()], collection = false) {
  const total = testResults.reduce(
    (sum, result) => sum + result.assertionResults.length,
    0,
  );
  return {
    success: true,
    numFailedTests: 0,
    numPendingTests: collection ? total : 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numPassedTests: collection ? 0 : total,
    numTotalTests: total,
    numPassedTestSuites: 19,
    testResults,
  };
}

const collected = () =>
  report([suite(suitePath, ["case one", "case two"], "skipped")], true);

test("accepts complete passing suites with independent collected test identities", () => {
  const actual = report([
    suite(`/runner/SparkyFitnessServer/${suitePath}`),
    suite(otherPath, ["third"]),
  ]);
  const expected = report(
    [
      suite(suitePath, ["case one", "case two"], "skipped"),
      suite(otherPath, ["third"], "skipped"),
    ],
    true,
  );
  assert.deepEqual(
    assertAcceptanceReport(actual, expected, [suitePath, otherPath]),
    [
      { path: suitePath, passed: 2 },
      { path: otherPath, passed: 1 },
    ],
  );
});

test("rejects a missing collected test even with self-consistent passing totals", () => {
  const expected = report(
    [suite(suitePath, ["case one", "case two", "case three"], "skipped")],
    true,
  );
  assert.throws(
    () => assertAcceptanceReport(report(), expected, [suitePath]),
    /Missing collected test/,
  );
});

test("rejects uncollected, duplicate, and unidentified report tests", () => {
  for (const names of [
    ["case one", "unexpected"],
    ["case one", "case one"],
    ["case one", ""],
  ]) {
    assert.throws(() =>
      assertAcceptanceReport(report([suite(suitePath, names)]), collected(), [
        suitePath,
      ]),
    );
  }
});

test("rejects missing, empty, duplicate, unexpected, and ambiguous suites", () => {
  for (const results of [
    [],
    [suite(suitePath, [])],
    [suite(), suite()],
    [suite("tests/other.test.ts")],
    [suite(`prefix${suitePath}`)],
  ]) {
    assert.throws(() =>
      assertAcceptanceReport(report(results), collected(), [suitePath]),
    );
  }
  assert.throws(
    () =>
      assertAcceptanceReport(report(), collected(), [
        suitePath,
        "workoutProgramConsolidation.integration.test.ts",
      ]),
    /ambiguous|Missing expected/,
  );
});

test("rejects skipped, failed, pending, or todo assertions and suites", () => {
  for (const status of ["skipped", "failed", "pending", "todo", undefined]) {
    const failedAssertion = report();
    failedAssertion.testResults[0].assertionResults[0].status = status;
    assert.throws(
      () => assertAcceptanceReport(failedAssertion, collected(), [suitePath]),
      /Non-passed/,
    );
    const failedSuite = report();
    failedSuite.testResults[0].status = status;
    assert.throws(
      () => assertAcceptanceReport(failedSuite, collected(), [suitePath]),
      /Suite did not pass/,
    );
  }
});

test("rejects inconsistent summaries and malformed collection", () => {
  for (const field of ["numFailedTests", "numPendingTests", "numTodoTests"]) {
    assert.throws(() =>
      assertAcceptanceReport({ ...report(), [field]: 1 }, collected(), [
        suitePath,
      ]),
    );
  }
  for (const field of ["numPassedTests", "numTotalTests"]) {
    assert.throws(() =>
      assertAcceptanceReport({ ...report(), [field]: 1 }, collected(), [
        suitePath,
      ]),
    );
  }
  for (const collection of [
    null,
    {},
    report([], true),
    { ...collected(), success: false },
    { ...collected(), numFailedTests: 1 },
    { ...collected(), numPassedTests: 1 },
    { ...collected(), numTotalTests: 1 },
    { ...collected(), numPendingTests: 1 },
  ]) {
    assert.throws(() =>
      assertAcceptanceReport(report(), collection, [suitePath]),
    );
  }
  assert.throws(() => assertAcceptanceReport(report(), collected(), []));
  assert.throws(() =>
    assertAcceptanceReport(report(), collected(), [suitePath, suitePath]),
  );
});

test("CLI checks both JSON files and reports the passing count", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "acceptance-report-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = fileURLToPath(
    new URL("./assert-acceptance-report.mjs", import.meta.url),
  );
  const resultPath = join(directory, "report.json");
  const collectionPath = join(directory, "collection.json");
  const run = (...args) =>
    spawnSync(process.execPath, [executable, ...args], { encoding: "utf8" });
  assert.equal(run().status, 1);
  writeFileSync(resultPath, JSON.stringify(report()));
  assert.equal(run(resultPath).status, 1);
  writeFileSync(collectionPath, JSON.stringify(collected()));
  assert.equal(run(resultPath, collectionPath).status, 1);
  const accepted = run(resultPath, collectionPath, suitePath);
  assert.equal(accepted.status, 0);
  assert.equal(accepted.stdout, `${suitePath}: 2 passed\n`);
  assert.equal(accepted.stderr, "");
  writeFileSync(resultPath, "{invalid");
  assert.equal(run(resultPath, collectionPath, suitePath).status, 1);
});
