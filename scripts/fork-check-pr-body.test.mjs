import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("./fork-check-pr-body.mjs", import.meta.url).pathname;

function run(input, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    input,
    encoding: "utf8",
  });
}

test("accepts separate closing lines from stdin", () => {
  const result = run("Closes #10\nCloses #11\n");
  assert.equal(result.status, 0, result.stderr);
});

test("rejects joined closing references from a file", () => {
  const directory = mkdtempSync(join(tmpdir(), "fork-pr-body-"));
  try {
    const file = join(directory, "body.md");
    writeFileSync(file, "Fixes #1 and #2\n");
    const result = run("", [file]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /one closing keyword per issue/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects comma joined closing references", () => {
  const result = run("Closes #10, #11\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /one closing keyword per issue/i);
});

test("rejects attribution in PR text", () => {
  for (const body of [
    "Co-Authored-By: Claude <example@example.com>",
    "Generated with a code assistant",
    "Reviewed by Copilot",
    "🤖",
  ]) {
    const result = run(body);
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, /attribution/i);
  }
});
