import { expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import { SettingsImportJobs } from "../src/importer/web-import-jobs.js";
import type { HistoryImportReport } from "../src/importer/run-import.js";

it("returns an additive grouped POST body, reconnects through current, and preserves existing request guards", async () => {
  let calls = 0;
  let finish!: (report: HistoryImportReport) => void;
  const pending = new Promise<HistoryImportReport>((resolve) => {
    finish = resolve;
  });
  const jobs = new SettingsImportJobs({
    readiness: async () => ({
      external: { state: "missing-key", provider: "test", model: null },
      opencode: { available: false, models: [] },
      piReader: { available: true },
      claudeCode: {
        available: true,
        defaultRoot: "/tmp",
        defaultRootFound: true,
        modelChoices: ["external"],
      },
    }),
    waitingPrompts: async () => new Set(),
    resolveSelection: async (_token, selection, { host }) => ({
      identity: { host, kind: "pi-folder", realPath: "/fixture", dev: 1, ino: 2 },
      keys: ["same"],
      cutoff: selection.listedAt,
    }),
    runner: async (_host, _args, run) => {
      calls++;
      run.onProgress?.(1, 2, "PRIVATE PROMPT");
      return pending;
    },
  });
  const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
  const routes = server as unknown as {
    settingsImportJobs: SettingsImportJobs;
    handleRequest(request: Request, address: string): Promise<Response>;
  };
  routes.settingsImportJobs = jobs;
  const body = {
    hosts: ["claude-code", "pi"].map((host) => ({
      host,
      source: "token",
      selection: { mode: "all", revision: "r", excludedKeys: [], listedAt: 1000 },
      modelChoice: "external",
    })),
    options: { dryRun: true, skipProfile: true },
  };
  const send = (path: string, method = "GET", headers: Record<string, string> = {}) =>
    routes.handleRequest(
      new Request(`http://127.0.0.1:4747${path}`, {
        method,
        headers: {
          "x-omms-token": getOrCreateAuthToken(),
          "content-type": "application/json",
          ...headers,
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
      "127.0.0.1"
    );
  expect(
    (await send("/api/settings/imports", "POST", { origin: "https://other.invalid" })).status
  ).toBe(403);
  expect(
    (await send("/api/settings/imports", "POST", { "content-type": "text/plain" })).status
  ).toBe(415);
  expect((await send("/api/settings/imports", "POST", { "x-omms-token": "wrong" })).status).toBe(
    401
  );
  expect(calls).toBe(0);
  const started = await send("/api/settings/imports", "POST");
  expect(started.status).toBe(202);
  const group = await started.json();
  expect(typeof group.id).toBe("string");
  expect(group).toMatchObject({
    dryRun: true,
    hosts: [{ host: "pi" }, { host: "claude-code" }],
  });
  expect(group.job).toBeUndefined();
  for (let i = 0; i < 2; i++) {
    const current = await (await send("/api/settings/imports/current")).json();
    expect(current.job.id).toBe(group.id);
    expect(JSON.stringify(current)).not.toContain("PRIVATE PROMPT");
  }
  expect(calls).toBe(1);
  expect((await send("/api/settings/imports", "POST")).status).toBe(409);
  const cancelled = await (await send("/api/settings/imports/current/cancel", "POST")).json();
  expect(cancelled.job).toMatchObject({ id: group.id, state: "cancelling" });
  finish({
    dryRun: true,
    root: "",
    sessionsDiscovered: 1,
    sessionsLoaded: 1,
    sessionsFilteredOut: 0,
    sessionsUnrecognized: 0,
    unitsTotal: 1,
    unitsWouldImport: 1,
    unitsImported: 0,
    unitsAlreadyHandled: 0,
    unitsSkipped: 0,
    unitsFailed: 0,
    projects: [],
    units: [],
    skipReasons: {},
    loadErrors: [],
    unresolvableSessions: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(jobs.current()?.state).toBe("cancelled");
  expect(calls).toBe(1);
});
