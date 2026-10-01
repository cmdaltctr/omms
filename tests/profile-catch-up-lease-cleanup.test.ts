import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const generatedDirs: string[] = [];
const repoRoot = join(import.meta.dir, "..");
const libsqlUrl = pathToFileURL(Bun.resolveSync("@libsql/client", repoRoot)).href;

afterEach(() => {
  for (const dir of generatedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([
  { test: "profile-catch-up-lease", prefix: "omms-catch-up-lease-", expectedClients: 4 },
  { test: "user-prompt-learning-order", prefix: "omms-learning-order-", expectedClients: 1 },
])(
  "$test closes its real libSQL clients before removing its temporary directory",
  ({ test, prefix, expectedClients }) => {
    const dir = mkdtempSync(join(tmpdir(), "omms-db-cleanup-preload-"));
    generatedDirs.push(dir);
    const preload = join(dir, "db-cleanup-preload.mjs");

    writeFileSync(
      preload,
      `
import { mock } from "bun:test";
import * as fs from "node:fs";
import { basename } from "node:path";
import * as libsql from ${JSON.stringify(libsqlUrl)};

const createClient = libsql.createClient;
const realRmSync = fs.rmSync;
const clients = new Set();

mock.module("@libsql/client", () => ({
  ...libsql,
  createClient: (...args) => {
    const client = createClient(...args);
    clients.add(client);
    return client;
  },
}));

function rmSync(path, options) {
  if (basename(String(path)).startsWith(${JSON.stringify(prefix)})) {
    const openClients = [...clients].filter((client) => client.closed === false).length;
    console.log("DB_CLEANUP:" + JSON.stringify({ trackedClients: clients.size, openClients }));
    if (openClients > 0) {
      const error = new Error("simulated Windows lock while libSQL clients remain open");
      error.code = "EBUSY";
      throw error;
    }
  }
  return realRmSync(path, options);
}

mock.module("node:fs", () => ({
  ...fs,
  default: { ...fs.default, rmSync },
  rmSync,
}));
`,
      "utf8"
    );

    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        "test",
        "--preload",
        preload,
        join(repoRoot, `tests/${test}.test.ts`),
      ],
      cwd: repoRoot,
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${child.stdout.toString()}\n${child.stderr.toString()}`;
    const removal = output.match(/DB_CLEANUP:(.*)$/m);

    expect(child.exitCode, output).toBe(0);
    expect(removal, output).not.toBeNull();
    expect(JSON.parse(removal![1]!)).toEqual({ trackedClients: expectedClients, openClients: 0 });
  },
  30_000
);
