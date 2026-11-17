import { expect, it } from "bun:test";
import { realHealthRows } from "./real-health-rows.js";

/** Run the Health checks with the heavy checks stubbed; `embedFails` breaks the embedding row. */
const runHealth = (config: Record<string, unknown>, snapshot: unknown, embedFails = false) =>
  realHealthRows(config, snapshot, { embedFails });

const row = (rows: any[], name: string) => rows.find((check) => check.check === name);
const READY_API = {
  memoryModel: "glm-5.3",
  memoryApiUrl: "https://api.invalid/v1",
  memoryApiKey: "health-host-secret",
  memoryProvider: "openai-chat",
};
const claudeSnapshot = (ready: boolean) => ({
  effective: {
    "claude-code": ready
      ? { ready: true }
      : { ready: false, issues: ["memoryModel is not configured"] },
  },
  claudeFolder: { root: "/home/me/.claude/projects", source: "default", exists: true },
});

it("tags each host row with its host and leaves machine rows without one", () => {
  const rows = runHealth(READY_API, claudeSnapshot(true));
  expect(row(rows, "OpenCode model").host).toBe("opencode");
  expect(row(rows, "Pi model").host).toBe("pi");
  expect(row(rows, "Claude Code model").host).toBe("claude-code");
  expect(row(rows, "Claude Code folder").host).toBe("claude-code");
  expect(row(rows, "Embedding").host).toBeUndefined();
  expect(row(rows, "Web binding").host).toBeUndefined();
});

it("gives each failing row a plain fix and no fix to a passing row", () => {
  const rows = runHealth({ autoCaptureEnabled: true }, claudeSnapshot(false), true);
  const claude = row(rows, "Claude Code model");
  expect(claude.status).toBe("fail");
  expect(claude.fix).toContain("External API card on the Settings page");
  expect(row(rows, "Embedding").status).toBe("fail");
  expect(row(rows, "Embedding").fix).toBeTruthy();
  for (const failing of rows.filter((entry: any) => entry.status !== "pass")) {
    expect(typeof failing.fix).toBe("string");
    expect(failing.fix.length).toBeGreaterThan(0);
  }
  for (const passing of rows.filter((entry: any) => entry.status === "pass")) {
    expect(passing.fix).toBeUndefined();
  }
});

it("keeps the existing row names and statuses", () => {
  const rows = runHealth(READY_API, claudeSnapshot(true));
  expect(rows.map((entry: any) => [entry.check, entry.status])).toEqual([
    ["Config files", "pass"],
    ["Memory store", "pass"],
    ["Embedding", "pass"],
    ["Web binding", "pass"],
    ["OpenCode model", "pass"],
    ["Pi model", "pass"],
    ["Claude Code model", "pass"],
    ["Claude Code folder", "pass"],
    ["Capture failures (24 hours)", "pass"],
  ]);
  expect(JSON.stringify(rows)).not.toContain("health-host-secret");
});
