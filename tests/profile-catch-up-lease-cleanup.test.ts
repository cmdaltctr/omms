import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const generatedDirs: string[] = [];
const repoRoot = join(import.meta.dir, "..");
const leaseTest = join(repoRoot, "tests/profile-catch-up-lease.test.ts");
// This is deliberately the same .js module URL used by the lease source.
const connectionManagerUrl = pathToFileURL(
  join(repoRoot, "src/services/turso/connection-manager.js")
).href;

afterEach(() => {
  for (const dir of generatedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("closes the lease test's real libSQL clients before removing its temporary directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-catch-up-lease-preload-"));
  generatedDirs.push(dir);
  const preload = join(dir, "lease-cleanup-preload.mjs");

  writeFileSync(
    preload,
    `
import { mock } from "bun:test";
import * as fs from "node:fs";
import { tursoConnectionManager } from ${JSON.stringify(connectionManagerUrl)};

const getConnection = tursoConnectionManager.getConnection.bind(tursoConnectionManager);
const realRmSync = fs.rmSync;
const clients = new Set();

tursoConnectionManager.getConnection = async (...args) => {
  const db = await getConnection(...args);
  clients.add(db.getClient());
  return db;
};

function rmSync(path, options) {
  const directory = String(path);
  if (/(^|[\\\\/])omms-catch-up-lease-[^\\\\/]+$/.test(directory)) {
    const openClients = [...clients].filter((client) => client.closed === false).length;
    console.log("LEASE_CLEANUP:" + JSON.stringify({ trackedClients: clients.size, openClients }));
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
    cmd: [process.execPath, "test", "--preload", preload, leaseTest],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${child.stdout.toString()}\n${child.stderr.toString()}`;
  const removal = output.match(/LEASE_CLEANUP:(.*)$/m);

  expect(child.exitCode, output).toBe(0);
  expect(removal, output).not.toBeNull();
  expect(JSON.parse(removal![1]!)).toEqual({ trackedClients: 4, openClients: 0 });
}, 30_000);
