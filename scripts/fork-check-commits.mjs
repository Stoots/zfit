#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lintText } from "./fork-check-pr-body.mjs";

const workflowPath = ".github/workflows/ci-tests.yml";
// Fork-owned GitHub files, as listed in FORK.md.
const forkOwnedPath = (path) =>
  path.startsWith(".github/workflows/fork-") ||
  path === ".github/workflows/deployment-smoke-checks.yml" ||
  path.startsWith(".github/scripts/assert-acceptance-report");
const protectedPath = (path) =>
  path === "CHANGELOG.md" ||
  path === "AGENTS.md" ||
  path === "db_schema_backup.sql" ||
  (path.startsWith(".github/") && !forkOwnedPath(path)) ||
  path.startsWith("SparkyFitnessFrontend/src/components/ui/");
// The native app stays at upstream behaviour; fork features ship to web (FORK.md).
const nativeAppPath = (path) => path.startsWith("SparkyFitnessMobile/");

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : undefined,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ??
        result.stderr?.trim() ??
        bin + " " + args.join(" ") + " exited " + result.status,
    );
  }
  return result.stdout?.trim() ?? "";
}

function workflowTests(source) {
  const matches = source.matchAll(
    /(?:(?:\.\.\/)?\.github\/scripts\/|(?:SparkyFitness(?:Server|Frontend|Mobile)\/)?(?:src\/)?(?:__tests__|tests)\/)[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g,
  );
  return new Set(
    [...matches].map(([path]) => {
      if (path.startsWith("../.github/")) return path.slice(3);
      if (path.startsWith(".github/")) return path;
      if (path.startsWith("SparkyFitness")) return path;
      if (path.startsWith("src/tests/")) return "SparkyFitnessFrontend/" + path;
      if (path.startsWith("__tests__/")) return "SparkyFitnessMobile/" + path;
      return "SparkyFitnessServer/" + path;
    }),
  );
}

function changedPackages(paths) {
  const packages = new Set();
  for (const path of paths) {
    if (path.startsWith("SparkyFitnessFrontend/"))
      packages.add("SparkyFitnessFrontend");
    if (path.startsWith("SparkyFitnessMobile/"))
      packages.add("SparkyFitnessMobile");
    if (path.startsWith("SparkyFitnessServer/"))
      packages.add("SparkyFitnessServer");
    if (
      path.startsWith("shared/") ||
      path === "package.json" ||
      path === "pnpm-lock.yaml" ||
      path === "pnpm-workspace.yaml"
    ) {
      packages.add("SparkyFitnessFrontend");
      packages.add("SparkyFitnessMobile");
      packages.add("SparkyFitnessServer");
    }
  }
  return packages;
}

function typecheckCommit(sha, paths) {
  const packages = changedPackages(paths);
  if (!packages.size) return;
  const cache = join(homedir(), ".cache");
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(join(cache, "zfit-commit-check-"));
  const checkout = join(scratch, "checkout");
  try {
    command("git", ["worktree", "add", "--detach", checkout, sha]);
    command(
      "pnpm",
      ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      {
        cwd: checkout,
        inherit: true,
      },
    );
    for (const name of packages) {
      console.log("TYPECHECK " + sha.slice(0, 9) + " " + name);
      command("pnpm", ["run", "typecheck"], {
        cwd: join(checkout, name),
        inherit: true,
      });
    }
  } finally {
    if (existsSync(checkout)) {
      command("git", ["worktree", "remove", "--force", checkout]);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const typecheck = args.includes("--typecheck");
  const ranges = args.filter((arg) => arg !== "--typecheck");
  if (ranges.length !== 1) {
    throw new Error(
      "Usage: node scripts/fork-check-commits.mjs [--typecheck] <base>[..<head>]",
    );
  }
  const range = ranges[0].includes("..") ? ranges[0] : ranges[0] + "..HEAD";
  const commits = command("git", ["rev-list", "--reverse", range])
    .split("\n")
    .filter(Boolean);
  let failures = 0;
  let warnings = 0;

  for (const sha of commits) {
    const short = sha.slice(0, 9);
    const paths = command("git", [
      "diff-tree",
      "--root",
      "-r",
      "-m",
      "--no-commit-id",
      "--name-only",
      sha,
    ])
      .split("\n")
      .filter(Boolean);
    for (const path of new Set(paths.filter(protectedPath))) {
      if (path === "db_schema_backup.sql") {
        console.error("ERROR " + short + ": " + path + " must not change");
        failures++;
      } else {
        console.log("WARNING " + short + ": review upstream-owned " + path);
        warnings++;
      }
    }
    for (const path of new Set(paths.filter(nativeAppPath))) {
      console.log("WARNING " + short + ": native app is frozen; " + path);
      warnings++;
    }

    const message = command("git", ["show", "-s", "--format=%B", sha]);
    for (const error of lintText(message)) {
      console.error("ERROR " + short + ": " + error);
      failures++;
    }

    const workflow = command("git", ["show", sha + ":" + workflowPath]);
    for (const path of workflowTests(workflow)) {
      const result = spawnSync("git", ["cat-file", "-e", sha + ":" + path], {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        console.error("ERROR " + short + ": workflow names missing " + path);
        failures++;
      }
    }

    if (typecheck) {
      try {
        typecheckCommit(sha, paths);
      } catch (error) {
        console.error("ERROR " + short + ": typecheck: " + error.message);
        failures++;
      }
    }
  }

  console.log(
    "Checked " +
      commits.length +
      " commits: " +
      failures +
      " errors, " +
      warnings +
      " warnings.",
  );
  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
