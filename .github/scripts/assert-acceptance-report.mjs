import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Reject partial, skipped or unexpected acceptance runs, regardless of exit code. */
export function assertAcceptanceReport(report, collection, suitePaths) {
  if (!Array.isArray(suitePaths) || suitePaths.length === 0) {
    throw new Error("At least one SUITE_PATH is required.");
  }
  if (suitePaths.some((path) => typeof path !== "string" || !path.trim())) {
    throw new Error("Expected nonempty SUITE_PATH values.");
  }
  if (new Set(suitePaths).size !== suitePaths.length) {
    throw new Error("Expected suite paths must be unique.");
  }
  if (
    !collection ||
    typeof collection !== "object" ||
    !Array.isArray(collection.testResults)
  ) {
    throw new Error("Collection must be a Vitest JSON report.");
  }
  if (
    collection.success !== true ||
    collection.numFailedTests !== 0 ||
    collection.numTodoTests !== 0 ||
    collection.numPassedTests !== 0
  ) {
    throw new Error("Collection must contain only skipped test identities.");
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

  function collect(results, label) {
    const found = new Map();
    for (const suite of results) {
      if (!suite || typeof suite.name !== "string" || !suite.name) {
        throw new Error(`Every ${label} suite must have a file name.`);
      }
      const matches = suitePaths.filter(
        (path) => suite.name === path || suite.name.endsWith(`/${path}`),
      );
      if (matches.length !== 1) {
        throw new Error(`Unexpected or ambiguous ${label} file: ${suite.name}`);
      }
      const path = matches[0];
      if (found.has(path)) {
        throw new Error(`Duplicate ${label} file: ${path}`);
      }
      if (label === "report" && suite.status !== "passed") {
        throw new Error(`Suite did not pass: ${path}`);
      }
      if (!Array.isArray(suite.assertionResults)) {
        throw new Error(`Missing assertions: ${path}`);
      }
      if (suite.assertionResults.length === 0) {
        throw new Error(`Empty suite: ${path}`);
      }
      const names = new Set();
      for (const assertion of suite.assertionResults) {
        if (
          !assertion ||
          assertion.status !== (label === "report" ? "passed" : "skipped")
        ) {
          throw new Error(
            `Non-${label === "report" ? "passed" : "skipped"} assertion in ${path}`,
          );
        }
        if (
          typeof assertion.fullName !== "string" ||
          !assertion.fullName ||
          names.has(assertion.fullName)
        )
          throw new Error(`Missing or duplicate test identity in ${path}`);
        names.add(assertion.fullName);
      }
      found.set(path, names);
    }
    for (const path of suitePaths) {
      if (!found.has(path))
        throw new Error(`Missing expected ${label} file: ${path}`);
    }
    return found;
  }
  const collected = collect(collection.testResults, "collection");
  const passed = collect(report.testResults, "report");
  const collectedTotal = [...collected.values()].reduce(
    (sum, names) => sum + names.size,
    0,
  );
  if (
    collection.numTotalTests !== collectedTotal ||
    collection.numPendingTests !== collectedTotal
  )
    throw new Error("Collection totals disagree with collected tests.");
  for (const path of suitePaths) {
    for (const name of collected.get(path)) {
      if (!passed.get(path).has(name))
        throw new Error(`Missing collected test in ${path}: ${name}`);
    }
    for (const name of passed.get(path)) {
      if (!collected.get(path).has(name))
        throw new Error(`Unexpected report test in ${path}: ${name}`);
    }
  }
  const total = [...passed.values()].reduce(
    (sum, names) => sum + names.size,
    0,
  );
  for (const field of ["numPassedTests", "numTotalTests"]) {
    if (field in report && report[field] !== total) {
      throw new Error(`${field} disagrees with assertion totals.`);
    }
  }
  // Vitest suite summary counts include nested describes, not just files.
  return suitePaths.map((path) => ({ path, passed: passed.get(path).size }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [reportPath, collectionPath, ...suitePaths] = process.argv.slice(2);
    if (!reportPath || !collectionPath) {
      throw new Error(
        "Usage: assert-acceptance-report.mjs REPORT COLLECTION SUITE_PATH [...]",
      );
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
    for (const { path, passed } of assertAcceptanceReport(
      report,
      collection,
      suitePaths,
    )) {
      console.log(`${path}: ${passed} passed`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
