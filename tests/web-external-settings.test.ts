import { describe, expect, it } from "bun:test";
import {
  externalMissing,
  hostModelEdit,
  keySourceBody,
  mapsToSave,
  versionNotice,
} from "../web/src/lib/external-api-settings.js";
import {
  backfillActions,
  backfillModelEdit,
  progressView,
} from "../web/src/lib/auto-import-settings.js";

describe("External API card", () => {
  it("builds each key source request and validates it before sending", () => {
    expect(keySourceBody("env", { name: "ZAI_API_KEY" })).toEqual({
      source: "env",
      name: "ZAI_API_KEY",
    });
    expect(keySourceBody("file", { path: " ~/k.key " })).toEqual({
      source: "file",
      path: "~/k.key",
    });
    expect(keySourceBody("paste", { name: "zai", value: "sk-x", replace: true })).toEqual({
      source: "paste",
      name: "zai",
      value: "sk-x",
      replace: true,
    });
    expect(() => keySourceBody("env", { name: "1BAD" })).toThrow("variable name");
    expect(() => keySourceBody("paste", { name: "zai", value: " " })).toThrow("Paste the key");
    expect(() => keySourceBody("paste", { name: "../x", value: "k" })).toThrow("key file");
  });

  it("names the missing settings that keep External API disabled", () => {
    expect(externalMissing({ keySet: false })).toEqual([
      "memoryModel",
      "memoryApiUrl",
      "memoryApiKey",
    ]);
    expect(externalMissing({ memoryProvider: "orcarouter", keySet: true })).toEqual([]);
    expect(externalMissing({ memoryModel: "m", memoryApiUrl: "https://x", keySet: true })).toEqual(
      []
    );
  });

  it("saves external for a host's capture and backfill model", () => {
    expect(hostModelEdit("pi", "external")).toEqual({ piModel: "external" });
    expect(hostModelEdit("opencode", "zai/glm")).toEqual({
      opencodeProvider: "zai",
      opencodeModel: "glm",
    });
    expect(backfillModelEdit("opencode", "external")).toEqual({
      opencodeBackfillModel: "external",
    });
  });
});

describe("Web app version notice", () => {
  it("covers equal, different, and missing global versions", () => {
    expect(versionNotice({ running: "3.4.0", global: "3.4.0" })).toEqual({
      kind: "same",
      command: null,
    });
    expect(versionNotice({ running: "3.4.0", global: "3.3.1" })).toEqual({
      kind: "different",
      command: "npm i -g om-memory-system@latest",
    });
    expect(versionNotice({ running: "3.4.0", global: null })).toEqual({
      kind: "missing",
      command: "npm i -g om-memory-system",
    });
  });
});

describe("Directory maps", () => {
  it("saves kept maps and accepted rows, and leaves out removed or rejected ones", () => {
    const saved = [
      { from: "/a", to: "/x" },
      { from: "/b", to: "/y" },
    ];
    expect(
      mapsToSave(saved, new Set(["/b"]), [
        { directory: "/code/app-feat-x", target: "/code/app", accepted: true },
        { directory: "/tmp/gone", target: "/tmp", accepted: false },
        { directory: "/empty", target: " ", accepted: true },
      ])
    ).toEqual([
      { from: "/a", to: "/x" },
      { from: "/code/app-feat-x", to: "/code/app" },
    ]);
  });
});

describe("Automatic import progress", () => {
  const run = {
    surface: "cli" as const,
    state: "running",
    total: 1000,
    done: 400,
    percent: 40,
    minutesLeft: 120,
    paused: false,
  };

  it("shows percentage, done of total, and minutes left or unknown", () => {
    expect(progressView(run)).toEqual({
      percent: 40,
      done: "400 / 1,000",
      minutesLeft: "about 120",
    });
    expect(progressView({ ...run, minutesLeft: null })?.minutesLeft).toBe("unknown");
    expect(progressView(null)).toBeNull();
  });

  it("offers Pause while running, Resume while paused, and Run now otherwise", () => {
    expect(backfillActions(run, null)).toEqual({ runNow: false, pause: true, resume: false });
    expect(backfillActions({ ...run, state: "stopped", paused: true }, null)).toEqual({
      runNow: false,
      pause: false,
      resume: true,
    });
    expect(backfillActions({ ...run, state: "done" }, null).runNow).toBe(true);
    expect(backfillActions(null, "Open Pi")).toEqual({
      runNow: false,
      pause: false,
      resume: false,
    });
  });
});
