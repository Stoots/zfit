import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  renameSync,
  statSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { deploy, pinImages, writeCompose } from "./fork-deploy.mjs";

const compose = `services:
  sparkyfitness-db:
    image: postgres:18.3-alpine # #19 unchanged
  sparkyfitness-server:
    # #82 server
    image: zfit/server@sha256:old # #82 #85 old commit
    pull_policy: never
  sparkyfitness-frontend:
    image: zfit/frontend@sha256:old # #88 frontend
    # #90 next line
    ports: ["3004:80"]
`;

test("pins only the two image lines, preserving nearby issue comments exactly", () => {
  assert.equal(
    pinImages(
      compose,
      { server: "sha256:new-server", frontend: "sha256:new-web" },
      "commit abc #90",
    ),
    `services:
  sparkyfitness-db:
    image: postgres:18.3-alpine # #19 unchanged
  sparkyfitness-server:
    # #82 server
    image: sha256:new-server # commit abc #90
    pull_policy: never
  sparkyfitness-frontend:
    image: sha256:new-web # commit abc #90
    # #90 next line
    ports: ["3004:80"]
`,
  );
});

test("refuses missing or ambiguous services and image lines before changing anything", () => {
  for (const invalid of [
    compose.replace(
      "    image: zfit/server@sha256:old # #82 #85 old commit\n",
      "",
    ),
    compose.replace(
      "    pull_policy: never",
      "    image: another\n    pull_policy: never",
    ),
    compose + "  sparkyfitness-server:\n    image: duplicate\n",
    compose.replace("  sparkyfitness-frontend:", "  other:"),
  ]) {
    assert.throws(
      () =>
        pinImages(invalid, { server: "new", frontend: "new" }, "commit abc"),
      /exactly one/,
    );
  }
});

function fixture(overrides = {}) {
  const commands = [];
  const writes = new Map();
  const messages = [];
  const io = {
    log: (text) => messages.push(text),
    read: (path) => {
      if (path.endsWith("compose-before.yml")) return compose;
      return writes.get(path) ?? compose;
    },
    mkdir: (path) => writes.set(path, "directory"),
    write: (path, value) => writes.set(path, value),
    writeCompose: (path, value) => writes.set(path, value),
    hash: () => "dump-sha256",
    run: (command, args, options) => {
      commands.push({ command, args, options });
      if (command === "git") {
        if (args.includes("--abbrev-ref")) return "main";
        if (args.includes("status")) return "";
        if (args.includes("log")) return "Ship feature (#90)";
        return "abc123";
      }
      if (args[0] === "image") return "sha256:" + "a".repeat(64);
      if (args[0] === "inspect") return "server-id started-at";
      if (args.includes("pg_restore")) return "TABLE DATA public fixture";
      if (args[0] === "logs") return "Migration applied: example.sql";
      return "";
    },
    ...overrides,
  };
  return { io, commands, writes, messages };
}
const options = {
  source: "/fixture/source",
  compose: "/fixture/compose.yml",
  output: "/fixture/evidence",
};

test("dry run describes all steps without invoking commands, reads, or writes", () => {
  const f = fixture({ read: () => assert.fail("dry-run read") });
  deploy({ ...options, dryRun: true }, f.io);
  assert.deepEqual(f.commands, []);
  assert.equal(f.writes.size, 0);
  for (const step of [
    "clean main",
    "pg_dump",
    "warm",
    "build",
    "pin",
    "config -q",
    "server",
    "frontend",
    "verify",
    "DEPLOY-LOG.md",
  ]) {
    assert.ok(f.messages.join("\n").includes(step), step);
  }
});

test("deploy backs up and verifies the dump before building and recreates only application services", () => {
  const f = fixture();
  deploy(options, f.io);
  const calls = f.commands.map(({ command, args }) =>
    [command, ...args].join(" "),
  );
  const index = (text) => calls.findIndex((line) => line.includes(text));
  assert.ok(index("pg_dump") < index("--phase warm"));
  assert.ok(index("pg_restore") < index("build -f"));
  assert.ok(index("config -q") < index("up -d"));
  const ups = calls.filter((line) => line.includes("up -d"));
  assert.equal(ups.length, 2);
  assert.match(
    ups[0],
    /--no-deps --pull never --wait --wait-timeout 90 sparkyfitness-server$/,
  );
  assert.match(
    ups[1],
    /--no-deps --pull never --wait --wait-timeout 90 sparkyfitness-frontend$/,
  );
  assert.ok(index("--phase verify") > index("sparkyfitness-frontend"));
  assert.match(
    f.writes.get("/fixture/evidence/DEPLOY-LOG.md"),
    /PASS[\s\S]*dump-sha256[\s\S]*--rollback/,
  );
  assert.match(
    f.writes.get(options.compose),
    /sha256:a{64} # commit abc123 #90/,
  );
});

test("every failed command stops subsequent commands and prints rollback information", () => {
  const successful = fixture();
  deploy(options, successful.io);
  assert.ok(successful.commands.length > 15);
  for (let failure = 0; failure < successful.commands.length; failure++) {
    const f = fixture();
    const run = f.io.run;
    let count = 0;
    f.io.run = (...args) => {
      if (count++ === failure) throw new Error("injected failure");
      return run(...args);
    };
    assert.throws(() => deploy(options, f.io), /injected failure/);
    assert.equal(count, failure + 1);
    assert.match(f.messages.join("\n"), /Rollback[\s\S]*--rollback/);
  }
});

test("dirty trees and non-main branches fail before creating backups or running Docker", () => {
  for (const [check, value] of [
    ["status", " M file"],
    ["--abbrev-ref", "feature"],
  ]) {
    const f = fixture();
    const run = f.io.run;
    f.io.run = (command, args, opts) =>
      args.includes(check) ? value : run(command, args, opts);
    assert.throws(() => deploy(options, f.io), /clean|main/);
    assert.equal(f.writes.size, 0);
    assert.ok(f.commands.every(({ command }) => command === "git"));
  }
});

test("rollback restores saved image lines while retaining current unrelated compose settings", () => {
  const current = pinImages(
    compose,
    { server: "sha256:new-server", frontend: "sha256:new-web" },
    "commit new #91",
  ).replace('ports: ["3004:80"]', 'ports: ["3999:80"]');
  const f = fixture();
  f.io.read = (path) =>
    path.endsWith("compose-before.yml") ? compose : current;
  deploy({ ...options, rollback: "/fixture/prior-deploy" }, f.io);
  assert.equal(
    f.writes.get(options.compose),
    compose.replace('ports: ["3004:80"]', 'ports: ["3999:80"]'),
  );
  assert.ok(
    f.commands.every(
      ({ args }) =>
        !args.includes("build") &&
        !args.includes("pg_restore") &&
        !args.includes("exec"),
    ),
  );
  assert.equal(f.commands.filter(({ args }) => args.includes("up")).length, 2);
});

test("rollback restores an unavailable app before warming and verifying the browser", () => {
  const f = fixture();
  const run = f.io.run;
  const phases = [];
  f.io.run = (command, args, opts) => {
    if (command === "pnpm") {
      if (f.commands.filter(({ args }) => args.includes("up")).length !== 2)
        throw new Error("HTTP 502: current app unavailable");
      assert.equal(f.writes.get(options.compose), compose);
      phases.push(args[args.indexOf("--phase") + 1]);
    }
    return run(command, args, opts);
  };
  deploy({ ...options, rollback: "/fixture/prior-deploy" }, f.io);
  assert.deepEqual(phases, ["warm", "verify"]);
  assert.match(f.writes.get("/fixture/evidence/DEPLOY-LOG.md"), /Smoke: PASS/);
});

test("failed compose writes preserve the original file and leave rollback usable", () => {
  const directory = mkdtempSync(resolve(process.env.TMPDIR, "deploy-write-"));
  const path = resolve(directory, "compose.yml");
  try {
    writeFileSync(path, compose);
    chmodSync(path, 0o640);
    const f = fixture();
    f.io.read = (file) =>
      file === path ? readFileSync(path, "utf8") : compose;
    f.io.write = (file, content) => {
      if (file === path) {
        writeFileSync(file, content.slice(0, 30));
        throw new Error("ENOSPC injected");
      }
      f.writes.set(file, content);
    };
    f.io.writeCompose = (file, content) =>
      writeCompose(file, content, {
        statSync,
        chmodSync,
        renameSync,
        rmSync,
        writeFileSync: (temporary, value, opts) => {
          writeFileSync(temporary, value.slice(0, 30), opts);
          throw new Error("ENOSPC injected");
        },
      });
    assert.throws(() => deploy({ ...options, compose: path }, f.io), /ENOSPC/);
    assert.equal(readFileSync(path, "utf8"), compose);
    assert.deepEqual(readdirSync(directory), ["compose.yml"]);
    assert.ok(f.commands.every(({ args }) => !args.includes("up")));
    f.io.writeCompose = writeCompose;
    deploy(
      { ...options, compose: path, rollback: "/fixture/prior-deploy" },
      f.io,
    );
    assert.equal(readFileSync(path, "utf8"), compose);
    assert.equal(statSync(path).mode & 0o777, 0o640);
    assert.deepEqual(readdirSync(directory), ["compose.yml"]);
    assert.match(
      f.writes.get("/fixture/evidence/DEPLOY-LOG.md"),
      /Smoke: PASS/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unusable dumps before warming or building", () => {
  const f = fixture();
  const run = f.io.run;
  f.io.run = (command, args, opts) =>
    args.includes("pg_restore") ? "empty TOC" : run(command, args, opts);
  assert.throws(() => deploy(options, f.io), /TABLE DATA/);
  assert.ok(
    f.commands.every(
      ({ command, args }) => command !== "pnpm" && !args.includes("build"),
    ),
  );
});

test("server restart during frontend recreation stops smoke verification", () => {
  const f = fixture();
  const run = f.io.run;
  let inspections = 0;
  f.io.run = (command, args, opts) => {
    if (args.includes("{{.Id}} {{.State.StartedAt}}") && ++inspections === 2)
      return "changed start time";
    return run(command, args, opts);
  };
  assert.throws(() => deploy(options, f.io), /Server identity/);
  assert.ok(f.commands.every(({ args }) => !args.includes("verify")));
});

test("concurrent compose edits are preserved and stop deployment before up", () => {
  const f = fixture();
  let reads = 0;
  f.io.read = () => (++reads === 1 ? compose : compose + "# operator edit\n");
  assert.throws(() => deploy(options, f.io), /Compose changed/);
  assert.equal(f.writes.has(options.compose), false);
  assert.ok(f.commands.every(({ args }) => !args.includes("up")));
});

test("concurrent-edit errors never expose either version of private compose values", () => {
  const f = fixture();
  let reads = 0;
  f.io.read = () =>
    compose +
    `    API_SECRET: ${++reads === 1 ? "old-private-token" : "new-private-token"}\n`;
  let message;
  try {
    deploy(options, f.io);
    assert.fail("concurrent edit must abort");
  } catch (error) {
    message = error.message;
  }
  const output = [
    message,
    ...f.messages,
    f.writes.get("/fixture/evidence/DEPLOY-LOG.md"),
  ].join("\n");
  assert.equal(message, "Compose changed during deploy; refusing to overwrite");
  assert.doesNotMatch(output, /old-private-token|new-private-token/);
  assert.equal(f.writes.has(options.compose), false);
  assert.ok(f.commands.every(({ args }) => !args.includes("up")));
});

test("pinning matches whole lines even when a comment contains the old image text", () => {
  const text = compose.replace(
    "    # #82 server",
    "    # previous:     image: zfit/server@sha256:old # #82 #85 old commit",
  );
  const result = pinImages(
    text,
    { server: "sha256:new-server", frontend: "sha256:new-web" },
    "commit abc #90",
  );
  assert.ok(
    result.includes(
      "    # previous:     image: zfit/server@sha256:old # #82 #85 old commit",
    ),
  );
  assert.ok(
    result.includes("\n    image: sha256:new-server # commit abc #90\n"),
  );
});

test("CLI dry-run with fixture targets and no executable PATH writes nothing, including rollback", () => {
  const directory = mkdtempSync(
    resolve(process.env.TMPDIR ?? "tmp-work", "deploy-dry-run-"),
  );
  try {
    const path = resolve(directory, "compose.yml");
    writeFileSync(path, compose);
    for (const extra of [
      [],
      ["--rollback", resolve(directory, "missing-backup")],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/fork-deploy.mjs",
          "--dry-run",
          "--source",
          resolve(directory, "missing-source"),
          "--compose",
          path,
          "--output",
          resolve(directory, "no-evidence"),
          "--url",
          "https://fixture.invalid/",
          "--project",
          "fixture",
          "--db-container",
          "fixture-db",
          "--server-container",
          "fixture-server",
          "--frontend-container",
          "fixture-web",
          ...extra,
        ],
        { encoding: "utf8", env: { ...process.env, PATH: "" } },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /DEPLOY-LOG.md/);
      assert.deepEqual(readdirSync(directory), ["compose.yml"]);
      assert.equal(readFileSync(path, "utf8"), compose);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
