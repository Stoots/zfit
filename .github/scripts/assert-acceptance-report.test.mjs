import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertAcceptanceReport } from "./assert-acceptance-report.mjs";

const suitePath = "tests/workoutProgramConsolidation.integration.test.ts";
const otherPath = "tests/rlsPermissionMatrix.integration.test.ts";
const specification = `${suitePath}=2`;

function suite(name = suitePath, count = 2) {
  return {
    name,
    status: "passed",
    assertionResults: Array.from({ length: count }, () => ({
      status: "passed",
    })),
  };
}

function report(testResults = [suite()]) {
  const total = testResults.reduce(
    (sum, result) => sum + result.assertionResults.length,
    0,
  );
  return {
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numPassedTests: total,
    numTotalTests: total,
    // Nested describes make this unrelated to the number of files.
    numPassedTestSuites: 19,
    testResults,
  };
}

test("accepts exact and slash-boundary repo suffixes with per-file passed totals", () => {
  const input = report([
    suite(`/runner/repository/SparkyFitnessServer/${suitePath}`),
    suite(otherPath, 3),
  ]);
  assert.deepEqual(
    assertAcceptanceReport(input, [specification, `${otherPath}=2`]),
    [
      { path: suitePath, passed: 2 },
      { path: otherPath, passed: 3 },
    ],
  );
});

test("rejects an empty, duplicate or malformed expected suite contract", () => {
  for (const specifications of [
    [],
    undefined,
    [specification, specification],
    [""],
    [suitePath],
    [`${suitePath}=0`],
    [`${suitePath}=-1`],
    [`${suitePath}=1.5`],
    [`${suitePath}=01`],
    [`${suitePath}=Infinity`],
    [`${suitePath}=9007199254740992`],
    ["=2"],
    [" =2"],
    [null],
  ]) {
    assert.throws(() => assertAcceptanceReport(report(), specifications));
  }
});

test("rejects missing expected files rather than trusting aggregate passed suites", () => {
  assert.throws(
    () => assertAcceptanceReport(report([]), [specification]),
    /Missing expected/,
  );
  assert.throws(
    () => assertAcceptanceReport(report(), [specification, `${otherPath}=1`]),
    /Missing expected/,
  );
});

test("rejects duplicate matches, unexpected files and non-boundary suffixes", () => {
  for (const input of [
    report([suite(), suite(`/runner/${suitePath}`)]),
    report([suite(), suite("tests/unexpected.test.ts")]),
    report([suite(`prefix${suitePath}`)]),
    report([suite(`${suitePath}.bak`)]),
    report([suite(otherPath)]),
  ]) {
    assert.throws(() => assertAcceptanceReport(input, [specification]));
  }
  assert.throws(
    () =>
      assertAcceptanceReport(report(), [
        specification,
        "workoutProgramConsolidation.integration.test.ts=1",
      ]),
    /ambiguous/,
  );
});

test("rejects failed or skipped assertions even with green suite and summary fields", () => {
  for (const status of [
    "failed",
    "pending",
    "todo",
    "skipped",
    "disabled",
    undefined,
  ]) {
    const input = report();
    input.testResults[0].assertionResults[1] = { status };
    assert.throws(
      () => assertAcceptanceReport(input, [specification]),
      /Non-passed assertion/,
    );
  }
  const input = report();
  input.testResults[0].assertionResults[0] = null;
  assert.throws(
    () => assertAcceptanceReport(input, [specification]),
    /Non-passed assertion/,
  );
});

test("rejects failed or pending suites and empty or undersized assertion runs", () => {
  for (const status of ["failed", "pending", "todo", undefined]) {
    const input = report();
    input.testResults[0].status = status;
    assert.throws(
      () => assertAcceptanceReport(input, [specification]),
      /Suite did not pass/,
    );
  }
  for (const count of [0, 1]) {
    assert.throws(
      () =>
        assertAcceptanceReport(report([suite(suitePath, count)]), [
          specification,
        ]),
      /minimum/,
    );
  }
});

test("rejects false success and malformed report structures", () => {
  for (const input of [
    null,
    [],
    {},
    "report",
    { ...report(), success: false },
    { ...report(), success: "true" },
  ]) {
    assert.throws(() => assertAcceptanceReport(input, [specification]));
  }
  for (const testResults of [
    undefined,
    null,
    {},
    [null],
    [{ status: "passed" }],
    [suite("")],
  ]) {
    assert.throws(() =>
      assertAcceptanceReport({ ...report(), testResults }, [specification]),
    );
  }
  for (const assertionResults of [undefined, null, {}]) {
    const input = report();
    input.testResults[0].assertionResults = assertionResults;
    assert.throws(
      () => assertAcceptanceReport(input, [specification]),
      /Missing assertions/,
    );
  }
});

test("rejects missing or inconsistent failure, pending and todo summaries", () => {
  for (const field of ["numFailedTests", "numPendingTests", "numTodoTests"]) {
    for (const value of [undefined, 1, -1, "0", null]) {
      assert.throws(() =>
        assertAcceptanceReport({ ...report(), [field]: value }, [
          specification,
        ]),
      );
    }
  }
  for (const field of ["numFailedTestSuites", "numPendingTestSuites"]) {
    assert.throws(() =>
      assertAcceptanceReport({ ...report(), [field]: 1 }, [specification]),
    );
  }
  for (const field of ["numPassedTests", "numTotalTests"]) {
    for (const value of [0, 3, "2", null]) {
      assert.throws(() =>
        assertAcceptanceReport({ ...report(), [field]: value }, [
          specification,
        ]),
      );
    }
  }
});

test("CLI returns failure for missing, malformed and falsely green skipped reports", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "acceptance-report-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = fileURLToPath(
    new URL("./assert-acceptance-report.mjs", import.meta.url),
  );
  const path = join(directory, "report.json");
  const run = (...args) =>
    spawnSync(process.execPath, [executable, ...args], { encoding: "utf8" });
  for (const args of [[], [path, specification]]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
  writeFileSync(path, "{not json");
  assert.equal(run(path, specification).status, 1);
  const skipped = report();
  skipped.testResults[0].assertionResults[0].status = "pending";
  writeFileSync(path, JSON.stringify(skipped));
  assert.equal(run(path, specification).status, 1);
  writeFileSync(path, JSON.stringify(report()));
  assert.equal(run(path).status, 1);
  const accepted = run(path, specification);
  assert.equal(accepted.status, 0);
  assert.equal(accepted.stdout, `${suitePath}: 2 passed\n`);
  assert.equal(accepted.stderr, "");
});
