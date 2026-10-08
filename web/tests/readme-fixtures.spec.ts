import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { groupMemories } from "../src/lib/group-memories";
import type { MemoryItem } from "../../src/shared/api";

async function response(method: string, url: string, body?: unknown) {
  const fixture = await import("./visual/readme-fixtures");
  return fixture.readmeFixtureResponse(method, url, body);
}

it("pairs English DemoUser requests with saved outcomes and code", async () => {
  const result = await response("GET", "/api/memories");
  const items = (result.body as { data: { items: MemoryItem[] } }).data.items;
  const groups = groupMemories(items);
  expect(groups).toHaveLength(2);
  for (const group of groups) {
    expect(group.isPair).toBe(true);
    if (!group.isPair) throw new Error("Expected paired demo records");
    expect(group.memory.linkedPromptId).toBe(group.prompt.id);
    expect(group.prompt.linkedMemoryId).toBe(group.memory.id);
    expect(group.prompt.content).toContain("DemoUser");
    expect(group.memory.content).toContain("```ts");
    expect(group.memory.content).toContain("pass");
  }
});

it("keeps all screenshot data English only", async () => {
  for (const route of [
    "memories",
    "tags",
    "keywords",
    "user-profile",
    "settings",
    "settings/profiles",
    "settings/imports/current",
  ]) {
    const result = await response("GET", `/api/${route}`);
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toMatch(/[\u0600-\u06ff\u3400-\u9fff]/u);
  }
});

it("shows fake external readiness without a real token", async () => {
  const result = await response("GET", "/api/settings");
  expect(result.body).toMatchObject({
    fallback: { configured: true },
    secrets: { memoryApiKey: { set: true, reference: "env://DEMO_MEMORY_API_KEY" } },
    effective: { "claude-code": { ready: true } },
  });
  expect((await response("GET", "/api/settings/imports/readiness")).body).toMatchObject({
    external: { state: "ready" },
  });
});

it("shows a completed cost-free manual preview", async () => {
  expect((await response("GET", "/api/settings/imports/current")).body).toMatchObject({
    job: { dryRun: true, state: "done", summary: { unitsWouldImport: 3 } },
  });
});

it("fails undeclared reads and mutations closed", async () => {
  expect((await response("GET", "/api/undeclared")).status).toBe(404);
  for (const path of [
    "/api/settings",
    "/api/settings/imports",
    "/api/settings/import-maps",
    "/api/settings/profile/catch-up/start",
  ]) {
    expect((await response("POST", path, {})).status).toBe(405);
  }
  expect((await response("PATCH", "/api/settings", {})).status).toBe(405);
});

it("uses its own port, fixture header and closed proxies in both modes", () => {
  const config = readFileSync(new URL("./visual/readme-vite.config.ts", import.meta.url), "utf8");
  expect(config).toContain("port: 5181");
  expect(config.match(/proxy: \{\}/g)).toHaveLength(2);
  expect(config).toContain('"X-OMMS-Visual-Fixture": "synthetic-only"');
  expect(config).toContain("configureServer");
  expect(config).toContain("configurePreviewServer");
  expect(config).not.toContain("4747");
});
