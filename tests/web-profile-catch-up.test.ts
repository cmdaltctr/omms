import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SKIP_ON_SLOW_WINDOWS } from "./test-process.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

it.skipIf(SKIP_ON_SLOW_WINDOWS)(
  "previews, runs one catch-up at a time from this machine, pauses, resumes, and finishes",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-catch-up-"));
    dirs.push(home);
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}");
    const script = `
    const { mock } = await import("bun:test");
    let release;
    let gate = new Promise((resolve) => (release = resolve));
    let calls = 0;
    const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
    mock.module(${src("importer/model-selection.ts")}, () => ({
      selectImportModel: () => ({ profile: { provider: "stub", modelId: "stub",
        async complete() { calls++; await gate; return reply; } } }),
    }));
    mock.module(${src("services/tags.ts")}, () => ({
      getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
    }));
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const { userPromptManager } = await import(${src("services/user-prompt/user-prompt-manager.ts")});
    const { profileCatchUpLock } = await import(${src("core/profile-backoff.ts")});
    for (let i = 0; i < 120; i++) await userPromptManager.savePrompt("s", "m" + i, "/p", "Prompt number " + i + " about the project");
    // Short replies are skipped without a model call, so the preview leaves them out.
    for (let i = 0; i < 5; i++) await userPromptManager.savePrompt("s", "t" + i, "/p", "yes go");
    const token = getOrCreateAuthToken();
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: process.env.HOME });
    const send = (path, method = "GET", { address = "127.0.0.1", headers = { "x-omms-token": token } } = {}) =>
      server.handleRequest(new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : "{}" }), address);
    const state = async () => (await (await send("/api/settings/profile/catch-up")).json()).job;
    const waitFor = async (check) => { for (let i = 0; i < 200; i++) { const job = await state(); if (check(job)) return job; await new Promise((r) => setTimeout(r, 10)); } throw new Error("timeout"); };
    const preview = (await (await send("/api/settings/profile/catch-up")).json()).preview;
    const remote = await send("/api/settings/profile/catch-up/start", "POST", { address: "192.168.1.5" });
    const noToken = await send("/api/settings/profile/catch-up/start", "POST", { headers: {} });
    const started = await send("/api/settings/profile/catch-up/start", "POST");
    const second = await send("/api/settings/profile/catch-up/start", "POST");
    const lockedDuringRun = profileCatchUpLock.isActive();
    // Pause while the first batch is in flight. Sent earlier, it can stop the run before any batch.
    for (let i = 0; calls === 0; i++) {
      if (i === 200) throw new Error("no model call");
      await new Promise((r) => setTimeout(r, 10));
    }
    await send("/api/settings/profile/catch-up/pause", "POST");
    release();
    const paused = await waitFor((job) => job.state !== "running");
    const resumed = await send("/api/settings/profile/catch-up/resume", "POST");
    const done = await waitFor((job) => job.state !== "running");
    console.log("RESULT:" + JSON.stringify({ preview, remote: remote.status, noToken: noToken.status,
      started: started.status, second: second.status, lockedDuringRun, paused, resumed: resumed.status,
      done, calls, lockedAfter: profileCatchUpLock.isActive() }));
    process.exit(0);
  `;
    const scriptPath = join(home, "scenario.mjs");
    writeFileSync(scriptPath, script);
    const proc = Bun.spawn(["bun", "run", scriptPath], {
      env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
    });
    const text = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    expect(await proc.exited, error).toBe(0);
    const result = JSON.parse(text.match(/RESULT:(.*)$/m)![1]!);
    expect(result.preview).toEqual({ waiting: 120, calls: 3 });
    expect(result.remote).toBe(403);
    expect(result.noToken).toBe(401);
    expect(result.started).toBe(202);
    expect(result.second).toBe(409);
    expect(result.lockedDuringRun).toBe(true);
    expect(result.paused).toMatchObject({ state: "paused", batchesBuilt: 1, remaining: 70 });
    expect(result.resumed).toBe(202);
    expect(result.done).toMatchObject({ state: "done", batchesBuilt: 2, remaining: 0 });
    expect(result.calls).toBe(3);
    expect(result.lockedAfter).toBe(false);
  },
  30000
);

it.skipIf(SKIP_ON_SLOW_WINDOWS)(
  "stops the page run when a run in another process takes over",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-catch-up-takeover-"));
    dirs.push(home);
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}");
    const script = `
    const { mock } = await import("bun:test");
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let calls = 0;
    const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
    mock.module(${src("importer/model-selection.ts")}, () => ({
      selectImportModel: () => ({ profile: { provider: "stub", modelId: "stub",
        async complete() { calls++; await gate; return reply; } } }),
    }));
    mock.module(${src("services/tags.ts")}, () => ({
      getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
    }));
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const { userPromptManager } = await import(${src("services/user-prompt/user-prompt-manager.ts")});
    const { CatchUpLease } = await import(${src("services/user-prompt/profile-catch-up-lease.ts")});
    for (let i = 0; i < 120; i++) await userPromptManager.savePrompt("s", "m" + i, "/p", "Prompt number " + i + " about the project");
    const token = getOrCreateAuthToken();
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: process.env.HOME });
    const send = (path, method = "GET") => server.handleRequest(new Request("http://127.0.0.1:4747" + path, { method,
      headers: { "content-type": "application/json", "x-omms-token": token }, body: method === "GET" ? undefined : "{}" }), "127.0.0.1");
    await send("/api/settings/profile/catch-up/start", "POST");
    while (calls === 0) await new Promise((r) => setTimeout(r, 5));
    // A terminal run in another process takes the record while the page batch is in flight.
    const terminal = new CatchUpLease();
    await terminal.take("terminal");
    const waitedWhileBusy = await Promise.race([
      terminal.beginBatch("terminal").then(() => false),
      new Promise((r) => setTimeout(() => r(true), 100)),
    ]);
    release();
    let job;
    for (let i = 0; i < 300; i++) {
      job = (await (await send("/api/settings/profile/catch-up")).json()).job;
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const terminalStart = await terminal.beginBatch("terminal");
    console.log("RESULT:" + JSON.stringify({ waitedWhileBusy, job, calls, terminalStart }));
    process.exit(0);
  `;
    const scriptPath = join(home, "scenario.mjs");
    writeFileSync(scriptPath, script);
    const proc = Bun.spawn(["bun", "run", scriptPath], {
      env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
    });
    const text = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    expect(await proc.exited, error).toBe(0);
    const result = JSON.parse(text.match(/RESULT:(.*)$/m)![1]!);
    expect(result.waitedWhileBusy).toBe(true);
    expect(result.job).toMatchObject({ state: "superseded", batchesBuilt: 1, remaining: 70 });
    expect(result.calls).toBe(1);
    expect(result.terminalStart).toBe("ok");
  },
  30000
);

it("frees the in-process lock when the run record cannot be taken", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-catch-up-setup-"));
  dirs.push(home);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(join(home, ".config", "omms", "omms.jsonc"), "{}");
  const script = `
    const { mock } = await import("bun:test");
    mock.module(${src("importer/model-selection.ts")}, () => ({
      selectImportModel: () => ({ profile: { provider: "stub", modelId: "stub", async complete() { return "{}"; } } }),
    }));
    mock.module(${src("services/tags.ts")}, () => ({
      getTags: () => ({ user: { userEmail: "me@example.invalid" } }),
    }));
    let fail = true;
    const real = await import(${src("services/user-prompt/profile-catch-up-lease.ts")});
    mock.module(${src("services/user-prompt/profile-catch-up-lease.ts")}, () => ({
      ...real,
      CatchUpLease: class extends real.CatchUpLease {
        async take(owner) { if (fail) throw new Error("database is locked"); return super.take(owner); }
      },
    }));
    const { startCatchUp } = await import(${src("importer/profile-catch-up.ts")});
    const { profileCatchUpLock } = await import(${src("core/profile-backoff.ts")});
    let first;
    try { await startCatchUp(process.env.HOME); } catch (error) { first = error.status ?? "thrown"; }
    const lockedAfterFailure = profileCatchUpLock.isActive();
    console.log("RESULT:" + JSON.stringify({ first, lockedAfterFailure }));
    process.exit(0);
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home, OMMS_LOG_FILE: join(home, "omms.log") },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const result = JSON.parse(text.match(/RESULT:(.*)$/m)![1]!);
  expect(result.first).toBeDefined();
  expect(result.lockedAfterFailure).toBe(false);
}, 30000);
