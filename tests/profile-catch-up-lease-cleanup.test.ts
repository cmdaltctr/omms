import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runBunTest, SKIP_ON_SLOW_WINDOWS, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

const generatedDirs: string[] = [];
const repoRoot = join(import.meta.dir, "..");
const libsqlUrl = pathToFileURL(Bun.resolveSync("@libsql/client", repoRoot)).href;
const lifecycleUrl = pathToFileURL(join(repoRoot, "src/services/turso/lifecycle.ts")).href;

afterEach(() => {
  for (const dir of generatedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The learning-order child stalls on slow Windows runners. The lease case checks the
// same cleanup with four clients, and the learning-order file runs on its own too.
it.each(
  [
    { test: "profile-catch-up-lease", prefix: "omms-catch-up-lease-", expectedClients: 4 },
    { test: "user-prompt-learning-order", prefix: "omms-learning-order-", expectedClients: 1 },
  ].filter((scenario) => !(SKIP_ON_SLOW_WINDOWS && scenario.test === "user-prompt-learning-order"))
)(
  "$test closes its real libSQL clients before removing its temporary directory",
  async ({ test, prefix, expectedClients }) => {
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

// Import only after wrapping createClient, so the real database clients are tracked.
const lifecycle = await import(${JSON.stringify(lifecycleUrl)});
const closeTurso = lifecycle.closeTursoAndInvalidateCaches;
mock.module(${JSON.stringify(lifecycleUrl)}, () => ({
  ...lifecycle,
  async closeTursoAndInvalidateCaches() {
    await closeTurso();
    // Reproduce Windows cleanup exceeding a nested runner's five-second default.
    await Bun.sleep(6000);
    console.log("SLOW_DB_CLEANUP_FINISHED");
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

    const { exitCode, output } = await runBunTest(
      ["--preload", preload, join(repoRoot, `tests/${test}.test.ts`)],
      { env: { ...process.env, HOME: dir, USERPROFILE: dir } }
    );
    const removal = output.match(/DB_CLEANUP:(.*)$/m);

    expect(exitCode, output).toBe(0);
    expect(output).toContain("SLOW_DB_CLEANUP_FINISHED");
    expect(removal, output).not.toBeNull();
    expect(JSON.parse(removal![1]!)).toEqual({ trackedClients: expectedClients, openClients: 0 });
  },
  TEST_PARENT_TIMEOUT_MS
);
