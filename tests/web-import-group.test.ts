import { describe, expect, it } from "bun:test";
import { SettingsImportJobs, validateWebImportRequest } from "../src/importer/web-import-jobs.js";
import type { ImportHost } from "../src/importer/import-args.js";
import type { HistoryImportReport, HistoryImportRun } from "../src/importer/run-import.js";
import type { ImportReadiness } from "../src/importer/import-readiness.js";
import { StaleSelectionError } from "../src/importer/import-sessions.js";

const selection = { mode: "all", excludedKeys: [], revision: "pinned", listedAt: 1000 };
const hosts = ["claude-code", "opencode", "pi"] as const;
const request = (dryRun = true) => ({
  hosts: hosts.map((host) => ({ host, source: host, selection, modelChoice: "external" })),
  options: { dryRun, scope: "current-project", force: true, profileBatch: 2 },
});
const ready: ImportReadiness = {
  external: { state: "ready", provider: "openai-chat", model: "test" },
  opencode: { available: false, models: [] },
  piReader: { available: true },
  claudeCode: {
    available: true,
    defaultRoot: "/tmp/claude",
    defaultRootFound: true,
    modelChoices: ["external"],
  },
};
const report = (dryRun = true): HistoryImportReport => ({
  dryRun,
  root: "/history",
  sessionsDiscovered: 1,
  sessionsLoaded: 1,
  sessionsFilteredOut: 0,
  sessionsUnrecognized: 0,
  unitsTotal: 2,
  unitsWouldImport: dryRun ? 2 : 0,
  unitsImported: dryRun ? 0 : 2,
  unitsAlreadyHandled: 0,
  unitsSkipped: 0,
  unitsFailed: 0,
  unitsHeldBack: 1,
  skipReasons: {},
  projects: [],
  units: [],
  unresolvableSessions: [],
  loadErrors: [],
  profile: {
    promptsRecorded: dryRun ? 0 : 2,
    promptsWouldRecord: dryRun ? 2 : 0,
    promptsAlreadyHandled: 0,
    batchesBuilt: dryRun ? 0 : 1,
    remaining: 0,
  },
});
const resolveSelection = async (
  _token: unknown,
  pinned: unknown,
  options: { host: ImportHost }
) => {
  expect(pinned).toEqual(selection);
  return {
    identity: {
      host: options.host,
      kind: options.host === "opencode" ? ("opencode-db" as const) : ("pi-folder" as const),
      realPath: `/history/${options.host}`,
      dev: 1,
      ino: 2,
    },
    keys: ["same-id"],
    cutoff: 1000,
  };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let finish!: (value: HistoryImportReport) => void;
  const promise = new Promise<HistoryImportReport>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
};
const dependencies = () => ({
  readiness: async () => ready,
  resolveSelection,
  prepareModels: async () => ({}),
  discardSelection: async () => {},
  waitingPrompts: async () => new Set<string>(),
});

describe("grouped web import requests", () => {
  it("normalises hosts in canonical order without losing pinned selections", () => {
    expect(validateWebImportRequest(request())).toMatchObject({
      hosts: [
        { host: "pi", source: "pi", selection },
        { host: "opencode", source: "opencode", selection },
        { host: "claude-code", source: "claude-code", selection },
      ],
      options: request().options,
    });
  });
  it("rejects empty, duplicate, unsupported and per-child options, ambiguous shapes and no output", () => {
    for (const value of [
      { ...request(), hosts: [] },
      { ...request(), hosts: [request().hosts[0], request().hosts[0]] },
      { ...request(), hosts: [{ ...request().hosts[0], host: "codex" }] },
      { ...request(), hosts: [{ ...request().hosts[0], options: { scope: "all-projects" } }] },
      { ...request(), host: "pi" },
      { ...request(), options: { apiKey: "secret" } },
      { ...request(), options: { skipMemories: true, skipProfile: true } },
    ])
      expect(() => validateWebImportRequest(value)).toThrow();
    expect(() =>
      validateWebImportRequest({
        ...request(),
        hosts: [{ ...request().hosts[0], modelChoice: "signed/model" }],
      })
    ).toThrow("Claude Code imports use the external API");
    expect(() =>
      validateWebImportRequest({
        host: "pi",
        source: "pi",
        selection,
        options: { skipMemories: true, skipProfile: true },
      })
    ).toThrow();
  });
});

describe("grouped web jobs", () => {
  it("preflights every source and model before paid work and identifies a stale host", async () => {
    const ran: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      resolveSelection: async (token, pinned, options) => {
        if (options.host === "claude-code") throw new StaleSelectionError();
        return resolveSelection(token, pinned, options);
      },
      runner: async (host) => {
        ran.push(host);
        return report(false);
      },
    });
    await expect(jobs.start(request(false), "/tmp")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Claude Code"),
    });
    expect(ran).toEqual([]);
    expect(jobs.current()).toBeNull();
    const missing = new SettingsImportJobs({
      ...dependencies(),
      readiness: async () => ({ ...ready, external: { ...ready.external, state: "missing-key" } }),
      runner: async () => {
        throw new Error("must not run");
      },
    });
    await expect(missing.start(request(false), "/tmp")).rejects.toThrow("Pi");
  });

  it("previews unavailable readers and model blockers without models, and labels zero sessions no-work", async () => {
    const called: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      readiness: async () => ({
        ...ready,
        piReader: { available: false, reason: "Install Pi" },
        external: { ...ready.external, state: "missing-key" },
      }),
      resolveSelection: async (token, pinned, options) => ({
        ...(await resolveSelection(token, pinned, options)),
        keys: options.host === "opencode" ? [] : ["same-id"],
      }),
      prepareModels: async () => {
        throw new Error("preview must not build models");
      },
      runner: async (host, args, run) => {
        called.push(host);
        expect(args.dryRun).toBe(true);
        expect(run.models).toEqual({});
        return report();
      },
    });
    await jobs.start(request(), "/tmp");
    await settle();
    expect(called).toEqual(["claude-code"]);
    expect(jobs.current()).toMatchObject({
      state: "failed",
      hosts: [
        { host: "pi", state: "failed", error: expect.stringContaining("Install Pi") },
        { host: "opencode", state: "no-work", sessions: 0 },
        { host: "claude-code", state: "done", blocker: expect.stringContaining("key is missing") },
      ],
    });
  });

  it("waits for the whole child including profile, shares the slot, and reconnects without resubmission", async () => {
    const pi = deferred();
    const called: string[] = [];
    const runs: HistoryImportRun[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      runner: async (host, args, run) => {
        called.push(host);
        runs.push(run);
        expect(args.source).toBe(`/history/${host}`);
        expect(args.force).toBe(true);
        expect(run.selection).toMatchObject({ keys: ["same-id"], cutoff: 1000 });
        run.onProgress?.(2, 2, "private conversation");
        run.onProfileProgress?.(0, 2);
        return host === "pi" ? pi.promise : report(false);
      },
    });
    await jobs.start(request(false), "/tmp");
    await settle();
    expect(called).toEqual(["pi"]);
    expect(jobs.current()).toMatchObject({
      activeHost: "pi",
      hosts: [
        { state: "running", phase: "profile", profileTotal: 2 },
        { state: "queued" },
        { state: "queued" },
      ],
    });
    const copy = jobs.current()!;
    copy.hosts![0]!.state = "failed";
    expect(jobs.current()!.hosts![0]!.state).toBe("running");
    await expect(
      jobs.start({ host: "pi", source: "pi", selection, options: { dryRun: true } }, "/tmp")
    ).rejects.toMatchObject({ status: 409 });
    expect(jobs.current()!.id).toBe(copy.id);
    expect(called).toEqual(["pi"]);
    pi.finish(report(false));
    await settle();
    expect(called).toEqual(["pi", "opencode", "claude-code"]);
    expect(jobs.current()).toMatchObject({
      state: "done",
      summary: { unitsImported: 6, profile: { batchesBuilt: 3 } },
    });
    expect(JSON.stringify(jobs.current())).not.toContain("private conversation");
    expect(runs.every((run) => run.track?.surface === "web")).toBe(true);
    expect(new SettingsImportJobs(dependencies()).current()).toBeNull();
  });

  for (const failure of ["memory", "profile", "claim"])
    it(`stops after ${failure} failure, retains reports and never replaces claims`, async () => {
      const called: string[] = [];
      const discarded: string[] = [];
      const jobs = new SettingsImportJobs({
        ...dependencies(),
        discardSelection: async (identity) => {
          discarded.push(identity.host);
        },
        runner: async (host) => {
          called.push(host);
          if (host === "pi") return report(false);
          if (failure === "claim") throw new Error("An OpenCode import is already running");
          const failed = report(false);
          if (failure === "memory") failed.unitsFailed = 1;
          else failed.profile!.error = "model timeout with private reply";
          return failed;
        },
      });
      await jobs.start(request(false), "/tmp");
      await settle();
      expect(called).toEqual(["pi", "opencode"]);
      expect(jobs.current()).toMatchObject({
        state: "failed",
        hosts: [
          { state: "done", summary: { unitsImported: 2 } },
          { state: "failed" },
          { state: "not-run" },
        ],
      });
      expect(JSON.stringify(jobs.current())).not.toContain("private reply");
      expect(discarded.sort()).toEqual(["claude-code", "opencode", "pi"]);
    });

  it("revalidates queued selection before building its model", async () => {
    const pi = deferred();
    let checks = 0;
    const called: string[] = [];
    const models: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      resolveSelection: async (token, pinned, options) => {
        if (options.host === "opencode" && ++checks === 2) throw new StaleSelectionError();
        return resolveSelection(token, pinned, options);
      },
      prepareModels: async (choice, directory, signal, host) => {
        models.push(host);
        return {};
      },
      runner: async (host) => {
        called.push(host);
        return pi.promise;
      },
    });
    await jobs.start(request(false), "/tmp");
    await settle();
    pi.finish(report(false));
    await settle();
    expect(called).toEqual(["pi"]);
    expect(models).toEqual(["pi"]);
    expect(jobs.current()).toMatchObject({
      state: "failed",
      hosts: [
        { state: "done" },
        { state: "failed", error: expect.stringContaining("OpenCode") },
        { state: "not-run" },
      ],
    });
  });

  it("cancels during deferred model preparation using the passed signal and retains finished results", async () => {
    let release!: () => void;
    let preparing!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      preparing = resolve;
    });
    const models: string[] = [];
    const called: string[] = [];
    const signals: AbortSignal[] = [];
    const cleaned: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      discardSelection: async (identity) => {
        cleaned.push(identity.host);
      },
      prepareModels: async (_choice, _directory, signal, host) => {
        models.push(host);
        signals.push(signal);
        if (host === "opencode") {
          preparing();
          await gate;
        }
        return {};
      },
      runner: async (host, _args, run) => {
        called.push(host);
        expect(run.signal).toBe(signals[0]);
        return report(false);
      },
    });
    await jobs.start(request(false), "/tmp");
    await entered;
    try {
      expect(signals[1]).toBe(signals[0]);
      expect(signals[1]!.aborted).toBe(false);
      expect(jobs.current()).toMatchObject({
        activeHost: "opencode",
        hosts: [{ state: "done" }, { state: "running", phase: "preparing" }, { state: "queued" }],
      });
      expect(jobs.cancel().state).toBe("cancelling");
      expect(signals[1]!.aborted).toBe(true);
    } finally {
      release();
      await settle();
    }
    expect(models).toEqual(["pi", "opencode"]);
    expect(called).toEqual(["pi"]);
    expect(cleaned.sort()).toEqual(["claude-code", "opencode", "pi"]);
    expect(jobs.current()).toMatchObject({
      state: "cancelled",
      hosts: [
        { state: "done", summary: { unitsImported: 2, profile: { batchesBuilt: 1 } } },
        { state: "cancelled" },
        { state: "cancelled" },
      ],
      summary: { unitsImported: 2, profile: { batchesBuilt: 1 } },
    });
  });

  it("cancels during profile learning and retains the completed host", async () => {
    const active = deferred();
    const called: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      runner: async (host, _args, run) => {
        called.push(host);
        if (host === "pi") return report(false);
        run.onProfileProgress?.(1, 2);
        return active.promise;
      },
    });
    await jobs.start(request(false), "/tmp");
    await settle();
    expect(jobs.cancel().state).toBe("cancelling");
    active.finish(report(false));
    await settle();
    expect(called).toEqual(["pi", "opencode"]);
    expect(jobs.current()).toMatchObject({
      state: "cancelled",
      hosts: [{ state: "done" }, { state: "cancelled" }, { state: "cancelled" }],
    });
  });

  it("cancels during preflight and releases preparation resources without starting a runner", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let called = 0;
    const cleaned: string[] = [];
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      resolveSelection: async (token, pinned, options) => {
        if (options.host === "opencode") await gate;
        return resolveSelection(token, pinned, options);
      },
      discardSelection: async (identity) => {
        cleaned.push(identity.host);
      },
      runner: async () => {
        called++;
        return report(false);
      },
    });
    const start = jobs.start(request(false), "/tmp");
    await settle();
    jobs.cancel();
    release();
    await start;
    await settle();
    expect(called).toBe(0);
    expect(jobs.current()?.state).toBe("cancelled");
    expect(cleaned).toContain("pi");
    expect(cleaned).toContain("opencode");
  });

  it("marks preview hosts cancelled when a preparing source observes the abort signal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let called = 0;
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      resolveSelection: async (token, pinned, options) => {
        if (options.host === "opencode") await gate;
        options.signal?.throwIfAborted();
        return resolveSelection(token, pinned, options);
      },
      runner: async () => {
        called++;
        return report();
      },
    });
    const start = jobs.start(request(), "/tmp");
    await settle();
    jobs.cancel();
    release();
    await start;
    await settle();
    expect(called).toBe(0);
    expect(jobs.current()).toMatchObject({
      state: "cancelled",
      hosts: [{ state: "cancelled" }, { state: "cancelled" }, { state: "cancelled" }],
    });
  });

  it("counts shared backlog once and deduplicates history identities while separating units and calls", async () => {
    const waiting = new Set(['["same","u"]', '["waiting","u"]']);
    const jobs = new SettingsImportJobs({
      ...dependencies(),
      waitingPrompts: async () => waiting,
      runner: async (_host, _args, run) => {
        run.onProfilePrompt?.('["same","u"]');
        run.onProfilePrompt?.('["new","u"]');
        run.onProfilePrompt?.('["new","u"]');
        return report();
      },
    });
    await jobs.start(request(), "/tmp");
    await settle();
    expect(jobs.current()).toMatchObject({
      state: "done",
      summary: { unitsWouldImport: 6 },
      profileEstimate: { historyPrompts: 1, waitingPrompts: 2, totalPrompts: 3, analysisCalls: 2 },
    });
    expect(jobs.current()!.hosts![0]).toMatchObject({
      profileEstimate: { historyPrompts: 1, waitingPrompts: 2, totalPrompts: 3 },
    });
    expect(JSON.stringify(jobs.current())).not.toContain('["same","u"]');
  });
});
