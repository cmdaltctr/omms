import { describe, expect, it } from "bun:test";
import { SettingsImportJobs, validateWebImportRequest } from "../src/importer/web-import-jobs.js";
import type { HistoryImportReport } from "../src/importer/run-import.js";
import type { ImportReadiness } from "../src/importer/import-readiness.js";
import { StaleSelectionError } from "../src/importer/import-sessions.js";

const report = {
  dryRun: true,
  sessionsLoaded: 0,
  sessionsDiscovered: 0,
  sessionsFilteredOut: 0,
  unitsTotal: 0,
  unitsWouldImport: 0,
  unitsAlreadyHandled: 0,
  unitsImported: 0,
  unitsSkipped: 0,
  unitsFailed: 0,
  unitsHeldBack: 2,
  projects: [],
  unresolvableSessions: [],
  loadErrors: [],
} as unknown as HistoryImportReport;

const readiness = (overrides: Partial<ImportReadiness> = {}): ImportReadiness => ({
  external: { state: "missing-key", provider: "openai-chat", model: null },
  opencode: { available: true, models: [{ provider: "zai", model: "glm", name: "GLM" }] },
  piReader: { available: true },
  ...overrides,
});

const identity = {
  host: "pi" as const,
  kind: "pi-folder" as const,
  realPath: "/tmp/sessions",
  dev: 1,
  ino: 2,
};
const resolved = async () => ({ identity, keys: ["a.jsonl"], cutoff: 1000 });
const selection = { mode: "all", excludedKeys: [], revision: "r1", listedAt: 1000 };
const preview = { host: "pi", source: "token", selection, options: { dryRun: true } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("web import jobs", () => {
  it("refuses a second job, including a preview while one runs, and cancels at a unit boundary", async () => {
    let finish!: (result: HistoryImportReport) => void;
    const pending = new Promise<HistoryImportReport>((resolve) => {
      finish = resolve;
    });
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness(),
      resolveSelection: resolved,
      runner: async (_host, args, run) => {
        expect(args.dryRun).toBe(true);
        expect(run.models).toEqual({});
        expect(run.selection).toEqual({ keys: ["a.jsonl"], cutoff: 1000 });
        run.onProgress?.(1, 2, "private prompt");
        return pending;
      },
    });
    await jobs.start(preview, "/tmp/project");
    await expect(jobs.start(preview, "/tmp/project")).rejects.toMatchObject({
      message: "An import is already running",
      status: 409,
    });
    await settle();
    expect(jobs.current()).toMatchObject({ processed: 1, total: 2, sessions: 1, state: "running" });
    expect(jobs.cancel().state).toBe("cancelling");
    finish(report);
    await settle();
    expect(jobs.current()).toMatchObject({ state: "cancelled" });
    expect(JSON.stringify(jobs.current())).not.toContain("private prompt");
  });

  it("runs a dry preview without a ready model and reports held-back turns", async () => {
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness(),
      resolveSelection: resolved,
      runner: async (_host, _args, run) => {
        expect(run.models).toEqual({});
        return report;
      },
    });
    await jobs.start(preview, "/tmp/project");
    await settle();
    expect(jobs.current()).toMatchObject({ state: "done", summary: { dryRun: true } });
    expect(jobs.current()?.report).toContain("Pi history import (dry-run)");
    expect(jobs.current()?.report).toContain("newer turns held back: 2");
  });

  it("rejects a real import when no model is ready, before any job starts", async () => {
    let ran = false;
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness(),
      resolveSelection: resolved,
      runner: async () => {
        ran = true;
        return report;
      },
    });
    const real = { ...preview, options: {}, modelChoice: "external" };
    await expect(jobs.start(real, "/tmp/project")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("key is missing"),
    });
    await expect(jobs.start({ ...preview, options: {} }, "/tmp/project")).rejects.toThrow(
      "Choose an import model"
    );
    await expect(jobs.start({ ...real, modelChoice: "zai/other" }, "/tmp/project")).rejects.toThrow(
      "not connected"
    );
    expect(jobs.current()).toBeNull();
    expect(ran).toBe(false);
  });

  it("disables Pi jobs, even previews, when the Pi reader is unavailable", async () => {
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness({ piReader: { available: false, reason: "no Pi SDK" } }),
      resolveSelection: resolved,
      runner: async () => report,
    });
    await expect(jobs.start(preview, "/tmp/project")).rejects.toThrow("no Pi SDK");
  });

  it("runs a Claude Code preview and always uses the external API for a real import", async () => {
    const claudeIdentity = {
      host: "claude-code" as const,
      kind: "claude-projects" as const,
      realPath: "/tmp/claude/projects",
      dev: 1,
      ino: 3,
    };
    const hosts: string[] = [];
    let ran = 0;
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness(),
      resolveSelection: async (_token, _selection, options) => {
        hosts.push(options.host);
        return { identity: claudeIdentity, keys: ["-tmp-app/s1.jsonl"], cutoff: 1000 };
      },
      runner: async (host, args, run) => {
        ran++;
        expect(host).toBe("claude-code");
        expect(args.source).toBe("/tmp/claude/projects");
        expect(run.models).toEqual({});
        // A folder source has no shared OpenCode snapshot.
        expect(run.selection).toEqual({ keys: ["-tmp-app/s1.jsonl"], cutoff: 1000 });
        return report;
      },
    });
    const claudePreview = { ...preview, host: "claude-code" };
    await jobs.start(claudePreview, "/tmp/project");
    await settle();
    expect(hosts).toEqual(["claude-code"]);
    expect(jobs.current()).toMatchObject({ host: "claude-code", state: "done" });
    expect(jobs.current()?.report).toContain("Claude Code history import (dry-run)");
    expect(jobs.current()?.report).toContain("model: external");

    // No model choice still means the external API, so its missing key is the reason.
    const real = { ...claudePreview, options: {} };
    await expect(jobs.start(real, "/tmp/project")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("key is missing"),
    });
    await expect(jobs.start({ ...real, modelChoice: "zai/glm" }, "/tmp/project")).rejects.toThrow(
      "Claude Code imports use the external API"
    );
    expect(ran).toBe(1);
  });

  it("accepts Claude Code requests with the external API only", () => {
    const base = { host: "claude-code", source: "t", selection, options: {} };
    expect(validateWebImportRequest(base).modelChoice).toBe("external");
    expect(validateWebImportRequest({ ...base, modelChoice: "external" }).host).toBe("claude-code");
    expect(() => validateWebImportRequest({ ...base, modelChoice: "zai/glm" })).toThrow(
      "Claude Code imports use the external API"
    );
    expect(() => validateWebImportRequest({ ...base, host: "codex" })).toThrow(
      "Choose Pi, OpenCode, or Claude Code"
    );
    // Pi keeps an unset model choice unset.
    expect(validateWebImportRequest({ ...base, host: "pi" }).modelChoice).toBeUndefined();
  });

  it("returns 409 for a stale selection", async () => {
    const jobs = new SettingsImportJobs({
      readiness: async () => readiness(),
      resolveSelection: async () => {
        throw new StaleSelectionError();
      },
      runner: async () => report,
    });
    await expect(jobs.start(preview, "/tmp/project")).rejects.toMatchObject({ status: 409 });
    expect(jobs.current()).toBeNull();
  });

  it("rejects unknown options, the single-session fields, relative projects, and bad maps", () => {
    const base = { host: "pi", source: "t", selection };
    expect(() => validateWebImportRequest({ ...base, options: { apiKey: "secret" } })).toThrow();
    expect(() => validateWebImportRequest({ ...base, options: { session: "s1" } })).toThrow(
      "Unknown import option: session"
    );
    expect(() => validateWebImportRequest({ ...base, options: { maxSessions: 2 } })).toThrow(
      "Unknown import option: maxSessions"
    );
    expect(() => validateWebImportRequest({ ...base, options: { source: "/x" } })).toThrow(
      "Unknown import option: source"
    );
    expect(() => validateWebImportRequest({ ...base, options: { project: "rel" } })).toThrow(
      "absolute"
    );
    expect(() =>
      validateWebImportRequest({ ...base, options: { pathMaps: [{ from: "/x" }] } })
    ).toThrow();
    expect(() =>
      validateWebImportRequest({
        ...base,
        options: {},
        selection: { mode: "ids", sessions: [], listedAt: 1 },
      })
    ).toThrow("Choose sessions");
    const tooMany = Array.from({ length: 1001 }, (_, index) => ({
      key: `${index}`,
      directory: "/",
    }));
    expect(() =>
      validateWebImportRequest({
        ...base,
        options: {},
        selection: { mode: "ids", sessions: tooMany, listedAt: 1 },
      })
    ).toThrow("at most 1000");
  });
});
