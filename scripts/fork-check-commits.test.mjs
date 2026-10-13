import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const script = new URL("./fork-check-commits.mjs", import.meta.url).pathname;

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(cwd, path, content) {
  const target = join(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "fork-commits-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  write(
    cwd,
    ".github/workflows/ci-tests.yml",
    "run: pnpm exec vitest run tests/existing.test.ts\nrun: node --test ../.github/scripts/assert.test.mjs\n",
  );
  write(cwd, "SparkyFitnessServer/tests/existing.test.ts", "test\n");
  write(cwd, ".github/scripts/assert.test.mjs", "test\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "initial");
  return { cwd, base: git(cwd, "rev-parse", "HEAD") };
}

function commit(cwd, message) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
}

function check(cwd, base) {
  return spawnSync(process.execPath, [script, base], { cwd, encoding: "utf8" });
}

test("passes valid paths and reports upstream-owned edits as warnings", () => {
  const { cwd, base } = fixture();
  try {
    write(cwd, "CHANGELOG.md", "changed\n");
    commit(cwd, "update docs");
    const result = check(cwd, base);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /WARNING.*CHANGELOG\.md/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("finds a workflow test reference missing from that commit", () => {
  const { cwd, base } = fixture();
  try {
    write(
      cwd,
      ".github/workflows/ci-tests.yml",
      "run: pnpm exec vitest run tests/later.test.ts\n",
    );
    commit(cwd, "name later suite");
    write(cwd, "SparkyFitnessServer/tests/later.test.ts", "test\n");
    commit(cwd, "add later suite");
    const result = check(cwd, base);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tests\/later\.test\.ts/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("finds a missing test script outside package test folders", () => {
  const { cwd, base } = fixture();
  try {
    write(
      cwd,
      ".github/workflows/ci-tests.yml",
      "run: node --test ../.github/scripts/later.test.mjs\n",
    );
    commit(cwd, "name later script");
    const result = check(cwd, base);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.github\/scripts\/later\.test\.mjs/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fails on a schema backup edit", () => {
  const { cwd, base } = fixture();
  try {
    write(cwd, "db_schema_backup.sql", "changed\n");
    commit(cwd, "update schema backup");
    const result = check(cwd, base);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /db_schema_backup\.sql/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("checks commit messages for attribution", () => {
  const { cwd, base } = fixture();
  try {
    write(cwd, "note.md", "changed\n");
    commit(cwd, "Generated with a code assistant");
    const result = check(cwd, base);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /attribution/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("typechecks a changed package in a temporary worktree", () => {
  const { cwd, base } = fixture();
  try {
    write(cwd, "SparkyFitnessMobile/config.js", "changed\n");
    commit(cwd, "update mobile");
    write(cwd, "bin/pnpm", '#!/bin/sh\nprintf "%s\\n" "$*" >> "$LOG_FILE"\n');
    chmodSync(join(cwd, "bin/pnpm"), 0o755);
    const log = join(cwd, "pnpm.log");
    const result = spawnSync(process.execPath, [script, "--typecheck", base], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: cwd,
        LOG_FILE: log,
        PATH: join(cwd, "bin") + ":" + process.env.PATH,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(log, "utf8"),
      "install --offline --frozen-lockfile --ignore-scripts\nrun typecheck\n",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
