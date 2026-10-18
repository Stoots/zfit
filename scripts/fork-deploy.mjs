import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

function imageLines(compose) {
  const result = {};
  const lines = compose.split("\n");
  for (const name of ["server", "frontend"]) {
    const header = `  sparkyfitness-${name}:`;
    const starts = lines.flatMap((line, index) =>
      line === header ? [index] : [],
    );
    assert.equal(starts.length, 1, `Expected exactly one ${header}`);
    const found = [];
    for (let i = starts[0] + 1; i < lines.length; i++) {
      if (/^\S|^  \S/.test(lines[i])) break;
      if (/^    image: \S/.test(lines[i])) found.push(lines[i]);
    }
    assert.equal(
      found.length,
      1,
      `Expected exactly one image line for ${name}`,
    );
    assert.equal(
      lines.filter((line) => line === found[0]).length,
      1,
      `Image line for ${name} must occur exactly once`,
    );
    result[name] = found[0];
  }
  return result;
}

function replaceImageLines(compose, replacements) {
  const before = imageLines(compose);
  return compose
    .split("\n")
    .map((line) => {
      const name = ["server", "frontend"].find((name) => line === before[name]);
      return name ? replacements[name] : line;
    })
    .join("\n");
}

export function pinImages(compose, images, comment) {
  assert.match(comment, /^[^\r\n]+$/, "Image comment must be a single line");
  for (const name of ["server", "frontend"])
    assert.match(images[name], /^[\w/:.@-]+$/);
  return replaceImageLines(
    compose,
    Object.fromEntries(
      ["server", "frontend"].map((name) => [
        name,
        `    image: ${images[name]} # ${comment}`,
      ]),
    ),
  );
}

const defaults = {
  source: "/home/zjk/Projects/health/zfit",
  compose: "/srv/zfit/docker-compose.yml",
  project: "zfit",
  url: "https://omarchy.tail42c038.ts.net:8443/",
  cdpUrl: "http://127.0.0.1:9222",
  dbContainer: "sparkyfitness-db",
  serverContainer: "zfit-sparkyfitness-server-1",
  frontendContainer: "zfit-sparkyfitness-frontend-1",
};

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function deploy(options, io = systemIO) {
  const o = { ...defaults, ...options };
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const output = resolve(
    o.output ??
      (o.rollback
        ? resolve(o.rollback, `rollback-${stamp}`)
        : resolve(homedir(), ".local/share/zfit/private", `deploy-${stamp}`)),
  );
  const rollback = `node ${shellQuote(resolve(o.source, "scripts/fork-deploy.mjs"))} --rollback ${shellQuote(output)}`;
  io.log(
    `Evidence: ${output}\nRollback (images only; database migrations are NOT undone): ${rollback}`,
  );
  const plan = o.rollback
    ? [
        "Require clean main; record commit",
        "Save current compose and identities in private rollback evidence directory",
        "Restore only the two image lines from saved compose; show diff; docker compose config -q",
        "Recreate server only (--no-deps --pull never --wait); record migrations and identity",
        "Recreate frontend only (--no-deps --pull never --wait); check server identity",
        "Smoke warm then verify; write DEPLOY-LOG.md with images, migrations and rollback paths",
      ]
    : [
        "Require clean main; record commit and PRs",
        "Create private evidence directory; copy compose; pg_dump -Fc; pg_restore -l; SHA256",
        "Smoke warm (authenticated public-origin browser)",
        "Docker build backend and frontend with unique tags; inspect image IDs",
        "Exactly pin server and frontend image lines; show diff; docker compose config -q",
        "Recreate server only (--no-deps --pull never --wait); record migrations and identity",
        "Recreate frontend only (--no-deps --pull never --wait); check server identity",
        "Smoke verify; write DEPLOY-LOG.md with images, migrations and rollback paths",
      ];
  io.log(JSON.stringify({ ...o, output }, null, 2));
  plan.forEach((step, index) => io.log(`${index + 1}. ${step}`));
  // This branch precedes every filesystem operation and process invocation.
  if (o.dryRun) {
    if (o.rollback)
      io.log(
        "Rollback dry-run does not load saved target settings; displayed targets are defaults/flags. Execution loads deployment.json first.",
      );
    return;
  }
  let stage = "preflight",
    created = false;
  const evidence = [];
  const run = (command, args, extra = {}) => {
    io.log([command, ...args].map((part) => JSON.stringify(part)).join(" "));
    return io.run(command, args, { cwd: o.source, ...extra }).trim();
  };
  const docker = (...args) => run("docker", args);
  const composeCommand = (...args) =>
    docker("compose", "-p", o.project, "-f", o.compose, ...args);
  const smoke = (phase) =>
    run("pnpm", [
      "deployment:smoke",
      "--phase",
      phase,
      "--url",
      o.url,
      "--cdp-url",
      o.cdpUrl,
      "--output",
      resolve(output, "smoke"),
      ...(phase === "verify" ? ["--container", o.frontendContainer] : []),
    ]);
  const write = (file, content) => io.write(resolve(output, file), content);
  try {
    assert.equal(
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      "main",
      "Deploy requires main",
    );
    assert.equal(
      run("git", ["status", "--porcelain", "--untracked-files=all"]),
      "",
      "Deploy requires a clean tree",
    );
    const commit = run("git", ["rev-parse", "HEAD"]);
    const subject = run("git", ["log", "-1", "--format=%s"]);
    const prs = o.prs ?? (subject.match(/#\d+/g) ?? []).join(" ");
    assert.match(
      prs,
      /^(#\d+(\s+#\d+)*)?$/,
      "--prs must contain space-separated #NN references",
    );
    const before = io.read(o.compose);
    imageLines(before);
    const restored = o.rollback
      ? replaceImageLines(
          before,
          imageLines(io.read(resolve(o.rollback, "compose-before.yml"))),
        )
      : null;
    stage = "backup";
    io.mkdir(output);
    created = true;
    write("compose-before.yml", before);
    write(
      "deployment.json",
      JSON.stringify(
        { ...o, output: undefined, rollback: undefined, dryRun: undefined },
        null,
        2,
      ),
    );
    evidence.push(
      `# Deployment ${commit}`,
      `Source: ${o.source}`,
      `PRs: ${prs || "none in HEAD subject"}`,
    );
    for (const container of [o.serverContainer, o.frontendContainer]) {
      evidence.push(
        `Before ${container}: ${docker("inspect", container, "--format", "{{.Image}} {{.Id}} {{.State.StartedAt}}")}`,
      );
    }
    if (!o.rollback) {
      const dump = resolve(output, "pre-deploy.dump");
      run(
        "docker",
        [
          "exec",
          o.dbContainer,
          "sh",
          "-c",
          'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ],
        { outputFile: dump },
      );
      const toc = run(
        "docker",
        ["exec", "-i", o.dbContainer, "pg_restore", "-l"],
        { inputFile: dump },
      );
      assert.ok(toc.includes("TABLE DATA"), "Dump TOC contains no TABLE DATA");
      write("dump-toc.txt", toc);
      evidence.push(`Dump: ${dump}`, `SHA256: ${io.hash(dump)}`);
    }
    if (!o.rollback) {
      stage = "smoke warm";
      smoke("warm");
    }
    let next = restored;
    if (!o.rollback) {
      stage = "build";
      const images = {};
      for (const [name, dockerfile] of [
        ["server", "backend"],
        ["frontend", "frontend"],
      ]) {
        const tag = `zfit/${name}:deploy-${stamp}`;
        docker(
          "build",
          "-f",
          `docker/Dockerfile.${dockerfile}`,
          "-t",
          tag,
          ".",
        );
        const image = docker("image", "inspect", tag, "--format", "{{.Id}}");
        assert.match(
          image,
          /^sha256:[a-f0-9]{64}$/,
          "Expected local Docker image ID",
        );
        images[name] = image;
      }
      next = pinImages(
        before,
        images,
        `commit ${commit}${prs ? ` ${prs}` : ""}`,
      );
    }
    stage = "pin images";
    // Do not overwrite concurrent operator changes made during backup/build/warm.
    if (io.read(o.compose) !== before)
      throw new Error("Compose changed during deploy; refusing to overwrite");
    io.writeCompose(o.compose, next);
    const diff = run(
      "diff",
      ["-u", resolve(output, "compose-before.yml"), o.compose],
      { allowDifference: true },
    );
    io.log(diff);
    write("compose.diff", diff);
    composeCommand("config", "-q");
    const up = (service) =>
      composeCommand(
        "up",
        "-d",
        "--no-deps",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "90",
        `sparkyfitness-${service}`,
      );
    stage = "server up";
    up("server");
    const serverIdentity = () =>
      docker(
        "inspect",
        o.serverContainer,
        "--format",
        "{{.Id}} {{.State.StartedAt}}",
      );
    const identity = serverIdentity();
    const logs = docker("logs", o.serverContainer);
    const migrations = logs
      .split("\n")
      .filter((line) => /migrat/i.test(line))
      .join("\n");
    io.log(`Migration log lines:\n${migrations || "(none)"}`);
    evidence.push(
      `Migrations (server log lines):\n\n${migrations || "(none)"}`,
    );
    stage = "frontend up";
    up("frontend");
    assert.equal(
      serverIdentity(),
      identity,
      "Server identity/start time changed during frontend deployment",
    );
    if (o.rollback) {
      stage = "smoke warm";
      smoke("warm");
    }
    stage = "smoke verify";
    smoke("verify");
    assert.equal(
      serverIdentity(),
      identity,
      "Server identity/start time changed during smoke verification",
    );
    for (const container of [o.serverContainer, o.frontendContainer]) {
      evidence.push(
        `After ${container}: ${docker("inspect", container, "--format", "{{.Image}} {{.Id}} {{.State.StartedAt}}")}`,
      );
    }
    stage = "report";
    write(
      "DEPLOY-LOG.md",
      `Smoke: PASS\n\n${evidence.join("\n\n")}\n\nRollback: ${rollback}\nSaved compose: ${resolve(output, "compose-before.yml")}\nDatabase migrations are not undone by image rollback. Retain the dump and old images.\n`,
    );
    io.log(`Smoke PASS; see ${output}/DEPLOY-LOG.md`);
  } catch (error) {
    io.log(
      `FAILED at ${stage}: ${error.message}\nRollback: ${rollback}\nOnly use rollback after image pinning; migrations require separate recovery review.`,
    );
    if (created) {
      try {
        write(
          "DEPLOY-LOG.md",
          `FAILED at ${stage}: ${error.message}\n\n${evidence.join("\n\n")}\n\nRollback: ${rollback}\n`,
        );
      } catch (reportError) {
        io.log(`Could not write failure report: ${reportError.message}`);
      }
    }
    throw error;
  }
}

export function writeCompose(
  path,
  content,
  fs = { statSync, writeFileSync, chmodSync, renameSync, rmSync },
) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const mode = fs.statSync(path).mode & 0o7777;
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, path);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const systemIO = {
  log: console.log,
  writeCompose,
  read: (path) => readFileSync(path, "utf8"),
  mkdir: (path) => {
    mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
    mkdirSync(path, { mode: 0o700 });
  },
  write: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
  hash: (path) => {
    const file = openSync(path, "r");
    try {
      const hash = createHash("sha256");
      const chunk = Buffer.alloc(1024 * 1024);
      let bytes;
      while ((bytes = readSync(file, chunk, 0, chunk.length, null)) > 0)
        hash.update(chunk.subarray(0, bytes));
      return hash.digest("hex");
    } finally {
      closeSync(file);
    }
  },
  run: (command, args, options) => {
    let input, output;
    try {
      if (options.inputFile) input = openSync(options.inputFile, "r");
      if (options.outputFile)
        output = openSync(options.outputFile, "wx", 0o600);
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: "utf8",
        stdio: [input ?? "ignore", output ?? "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (
        result.status !== 0 &&
        !(options.allowDifference && result.status === 1)
      ) {
        throw new Error(
          `${command} failed (${result.status ?? result.signal}): ${result.stderr ?? ""}`,
        );
      }
      return (
        (result.stdout ?? "") +
        (command === "docker" && args[0] === "logs"
          ? (result.stderr ?? "")
          : "")
      );
    } finally {
      if (input !== undefined) closeSync(input);
      if (output !== undefined) closeSync(output);
    }
  },
};

function main() {
  const { values } = parseArgs({
    options: {
      ...Object.fromEntries(
        [
          "source",
          "compose",
          "project",
          "url",
          "cdp-url",
          "db-container",
          "server-container",
          "frontend-container",
          "output",
          "rollback",
          "prs",
        ].map((name) => [name, { type: "string" }]),
      ),
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm deploy:live [--dry-run] [--rollback DEPLOY_DIR]
Options: --source DIR --compose FILE --project NAME --url URL --cdp-url URL
         --db-container NAME --server-container NAME --frontend-container NAME
         --output PRIVATE_DIR --prs '#90 #91'
Requires a clean main checkout and an authenticated public-origin smoke browser.
Rollback restores image lines only; it never restores the database or undoes migrations.
Dry-run prints the plan and targets, without reading files, running commands or writing.
Rollback uses saved deployment.json settings; explicit flags override them.
Keep evidence private. Old images and database dumps are retained.`);
    return;
  }
  const options = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );
  if (options.rollback && !options.dryRun) {
    const saved = JSON.parse(
      systemIO.read(resolve(options.rollback, "deployment.json")),
    );
    deploy({ ...saved, ...options });
  } else deploy(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
