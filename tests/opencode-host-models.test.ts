import { afterEach, describe, expect, it } from "bun:test";
import {
  getOpencodeHostModels,
  registerOpencodeHostModels,
  type OpencodeHostModels,
} from "../src/importer/backfill-controls.js";
import { listOpencodeSettingsModels } from "../src/importer/settings-models.js";
import { SettingsImportJobs } from "../src/importer/web-import-jobs.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const models = [{ provider: "zai", model: "glm/4.6", name: "GLM" }];

function fakeHost(overrides: Partial<OpencodeHostModels> = {}) {
  const created: Array<{ ref: unknown; directory: string }> = [];
  const host: OpencodeHostModels = {
    isProviderConnected: (providerID) => providerID === "zai",
    createImportModels: async (ref, directory) => {
      created.push({ ref, directory });
      throw new Error("registered factory reached");
    },
    listSettingsModels: async () => models,
    ...overrides,
  };
  return { host, created };
}

function jobs() {
  return new SettingsImportJobs({
    readiness: async () => ({
      external: { state: "missing-key", provider: "openai-chat", model: null },
      opencode: { available: true, models },
      piReader: { available: true },
    }),
    resolveSelection: async () => ({
      identity: { host: "pi", kind: "pi-folder", realPath: "/tmp/s", dev: 1, ino: 2 },
      keys: ["a.jsonl"],
      cutoff: 1000,
    }),
    runner: async () => {
      throw new Error("runner must not start");
    },
  });
}

const request = {
  host: "pi",
  source: "token",
  selection: { mode: "all", excludedKeys: [], revision: "r1", listedAt: 1000 },
  options: {},
  modelChoice: "zai/glm/4.6",
};

afterEach(() => registerOpencodeHostModels(null));

describe("OpenCode host models registry", () => {
  it("is empty until the OpenCode adapter registers", () => {
    expect(getOpencodeHostModels()).toBeNull();
    const { host } = fakeHost();
    registerOpencodeHostModels(host);
    expect(getOpencodeHostModels()).toBe(host);
  });

  it("reports the OpenCode model list as unavailable with nothing registered", async () => {
    expect(await listOpencodeSettingsModels()).toEqual({
      available: false,
      reason: "OpenCode model list unavailable",
    });
  });

  it("lists the registered OpenCode models, and reports unavailable when they cannot load", async () => {
    registerOpencodeHostModels(fakeHost().host);
    expect(await listOpencodeSettingsModels()).toEqual({ available: true, models });
    registerOpencodeHostModels(fakeHost({ listSettingsModels: async () => null }).host);
    expect((await listOpencodeSettingsModels()).available).toBe(false);
    registerOpencodeHostModels(
      fakeHost({
        listSettingsModels: async () => {
          throw new Error("down");
        },
      }).host
    );
    expect((await listOpencodeSettingsModels()).available).toBe(false);
  });

  it("fails a web import with 'not connected' when nothing is registered", async () => {
    const job = jobs();
    await job.start(request, "/tmp/project");
    await settle();
    expect(job.current()).toMatchObject({ state: "failed" });
    expect(JSON.stringify(job.current())).toContain("OpenCode provider is not connected");
  });

  it("builds web import models through the registered factory", async () => {
    const { host, created } = fakeHost();
    registerOpencodeHostModels(host);
    const job = jobs();
    await job.start(request, "/tmp/project");
    await settle();
    expect(created).toEqual([
      { ref: { providerID: "zai", modelID: "glm/4.6" }, directory: "/tmp/project" },
    ]);
    expect(JSON.stringify(job.current())).toContain("registered factory reached");
  });
});
