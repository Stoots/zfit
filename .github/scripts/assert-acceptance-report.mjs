import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Reject partial, skipped or unexpected acceptance runs, regardless of exit code. */
export function assertAcceptanceReport(report, specifications) {
  if (!Array.isArray(specifications) || specifications.length === 0) {
    throw new Error("At least one SUITE_PATH=MINIMUM is required.");
  }
  const expected = specifications.map((specification) => {
    if (typeof specification !== "string") {
      throw new Error("Expected SUITE_PATH=MINIMUM.");
    }
    const match = /^([^=]+)=([1-9]\d*)$/.exec(specification);
    if (!match || !match[1].trim() || !Number.isSafeInteger(Number(match[2]))) {
      throw new Error(`Invalid suite specification: ${specification}`);
    }
    return { path: match[1], minimum: Number(match[2]) };
  });
  if (new Set(expected.map((suite) => suite.path)).size !== expected.length) {
    throw new Error("Expected suite paths must be unique.");
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Report must be a Vitest JSON object.");
  }
  if (report.success !== true) {
    throw new Error("Report success must be true.");
  }
  for (const field of ["numFailedTests", "numPendingTests", "numTodoTests"]) {
    if (report[field] !== 0) {
      throw new Error(`${field} must be zero.`);
    }
  }
  for (const field of ["numFailedTestSuites", "numPendingTestSuites"]) {
    if (field in report && report[field] !== 0) {
      throw new Error(`${field} must be zero.`);
    }
  }
  if (!Array.isArray(report.testResults)) {
    throw new Error("Report testResults must be an array.");
  }

  const passed = new Map();
  for (const suite of report.testResults) {
    if (!suite || typeof suite.name !== "string" || !suite.name) {
      throw new Error("Every report suite must have a file name.");
    }
    const matches = expected.filter(
      ({ path }) => suite.name === path || suite.name.endsWith(`/${path}`),
    );
    if (matches.length !== 1) {
      throw new Error(`Unexpected or ambiguous report file: ${suite.name}`);
    }
    const target = matches[0];
    if (passed.has(target.path)) {
      throw new Error(`Duplicate report file: ${target.path}`);
    }
    if (suite.status !== "passed") {
      throw new Error(`Suite did not pass: ${target.path}`);
    }
    if (!Array.isArray(suite.assertionResults)) {
      throw new Error(`Missing assertions: ${target.path}`);
    }
    for (const assertion of suite.assertionResults) {
      if (!assertion || assertion.status !== "passed") {
        throw new Error(`Non-passed assertion in ${target.path}`);
      }
    }
    if (suite.assertionResults.length < target.minimum) {
      throw new Error(
        `${target.path}: ${suite.assertionResults.length} passed; minimum ${target.minimum}.`,
      );
    }
    passed.set(target.path, suite.assertionResults.length);
  }
  for (const { path } of expected) {
    if (!passed.has(path)) {
      throw new Error(`Missing expected report file: ${path}`);
    }
  }
  const total = [...passed.values()].reduce((sum, count) => sum + count, 0);
  for (const field of ["numPassedTests", "numTotalTests"]) {
    if (field in report && report[field] !== total) {
      throw new Error(`${field} disagrees with assertion totals.`);
    }
  }
  // Vitest suite summary counts include nested describes, not just files.
  return expected.map(({ path }) => ({ path, passed: passed.get(path) }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [reportPath, ...specifications] = process.argv.slice(2);
    if (!reportPath) {
      throw new Error(
        "Usage: assert-acceptance-report.mjs REPORT SUITE_PATH=MINIMUM [...]",
      );
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    for (const { path, passed } of assertAcceptanceReport(
      report,
      specifications,
    )) {
      console.log(`${path}: ${passed} passed`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
