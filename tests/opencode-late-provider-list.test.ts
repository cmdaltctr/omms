import { describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createFakeV2Context } from "./fake-v2-context.js";

// OpenCode fills its model list after start-up: `ctx.model.list()` is empty at first and full
// about 1 s later. OMMS reads it once at start. With `opencodeModel: "inherit"`, capture and
// profile learning then found the session's own provider "not connected" and fell back to the
// external API with a "Using fallback provider" notice. The test runs the real V2 `setup` with
// a fake V2 context whose first list read is empty. The isolated runner gives an empty home.
setDefaultTimeout(30_000);

process.env.OMMS_DISABLE_WEB_AUTOSTART = "1";
process.env.OMMS_DISABLE_AUTO_BACKFILL = "1";
process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
writeFileSync(
  join(homedir(), ".config", "omms", "omms.jsonc"),
  JSON.stringify({
    webServerEnabled: false,
    chatMessage: { enabled: false },
    autoCaptureLanguage: "en",
    opencodeModel: "inherit",
    memoryProvider: "openai-chat",
    memoryModel: "external-model",
    memoryApiUrl: "https://example.invalid/v1",
    memoryApiKey: "test-key",
  })
);

const external = { capture: 0, profile: 0 };

const autoCapture = await import("../src/services/auto-capture.js");
mock.module("../src/services/auto-capture.js", () => ({
  ...autoCapture,
  performAutoCapture: async () => {},
}));
const cleanup = await import("../src/services/cleanup-service.js");
mock.module("../src/services/cleanup-service.js", () => ({
  ...cleanup,
  cleanupService: { runDailyMaintenance: async () => {} },
}));
mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: () => ({
      executeToolCall: async () => {
        external.capture++;
        return { success: true, data: { summary: "external", type: "feature", tags: [] } };
      },
    }),
  },
}));
mock.module("../src/importer/model-selection.js", () => ({
  selectImportModel: () => ({
    profile: {
      complete: async () => {
        external.profile++;
        return JSON.stringify({ ok: true });
      },
    },
  }),
}));

// The store warm-up is not under test.
(globalThis as Record<symbol, unknown>)[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plugin = (await import("../src/v2/plugin.js")).default;
const { generateOpenCodeAutoCaptureSummary } =
  await import("../src/adapters/opencode/auto-capture-summary.js");
const { createOpencodeLearningModel } = await import("../src/adapters/opencode/profile-model.js");
const { setConnectedProviders } = await import("../src/adapters/opencode/opencode-provider.js");
const { getOpencodeHostModels, registerOpencodeHostModels } =
  await import("../src/importer/backfill-controls.js");
const { SettingsImportJobs } = await import("../src/importer/web-import-jobs.js");

const SESSION_MODEL = { providerID: "zai-coding-plan", id: "glm-4.6", name: "GLM 4.6" };
type Notice = { title: string; message: string };

/** Start the plugin on a fake context whose first model list read is empty. */
async function startPlugin() {
  // Each test starts as a new OpenCode process: no provider list read yet.
  setConnectedProviders([]);
  external.capture = 0;
  external.profile = 0;
  const directory = mkdtempSync(join(tmpdir(), "omms-late-provider-list-"));
  const fake = createFakeV2Context({
    directory,
    generateText: '{"summary":"host","type":"feature","tags":[],"ok":true}',
  });
  let reads = 0;
  fake.ctx.model.list = async () => {
    reads++;
    return { location: { directory }, data: reads === 1 ? [] : [SESSION_MODEL] };
  };
  const stop = (await plugin.setup(fake.ctx)) as unknown as () => Promise<void>;
  const end = Date.now() + 5_000;
  while (reads === 0 && Date.now() < end) await sleep(10);
  // Let the start-up read finish before the first call.
  await sleep(50);
  expect(reads).toBe(1);
  return { fake, stop };
}

function capture(providerId: string, notices: Notice[]) {
  return generateOpenCodeAutoCaptureSummary(
    {
      context: "ctx",
      sessionId: "ses-user",
      projectDirectory: "/p",
      userPrompt: "fix the bug",
      prompt: { id: "msg-1", providerId, modelId: SESSION_MODEL.id } as never,
    },
    (notice) => {
      notices.push(notice);
    }
  );
}

/** One learning call after the context hook recorded `providerID` as the session model. */
async function learn(
  fake: ReturnType<typeof createFakeV2Context>,
  providerID: string,
  notices: Notice[]
) {
  await fake.hooks.get("context")!({
    sessionID: "ses-user",
    messages: [],
    system: [],
    model: { providerID, id: SESSION_MODEL.id },
  });
  const model = createOpencodeLearningModel((notice) => {
    notices.push(notice);
  });
  return model!.completeStructured!("system", "prompts", z.object({ ok: z.boolean() }));
}

const hostCall = [{ providerID: SESSION_MODEL.providerID, id: SESSION_MODEL.id }];

describe("OpenCode provider list that fills after start-up", () => {
  it("capture uses the session's provider when only a re-read lists it", async () => {
    const { fake, stop } = await startPlugin();
    const notices: Notice[] = [];
    try {
      expect((await capture(SESSION_MODEL.providerID, notices))?.summary).toBe("host");
    } finally {
      await stop();
    }
    expect(notices).toEqual([]);
    expect(external.capture).toBe(0);
    expect(fake.calls.generate.map((call) => call.model)).toEqual(hostCall);
  });

  it("profile learning uses the session's provider when only a re-read lists it", async () => {
    const { fake, stop } = await startPlugin();
    const notices: Notice[] = [];
    try {
      expect(await learn(fake, SESSION_MODEL.providerID, notices)).toEqual({ ok: true });
    } finally {
      await stop();
    }
    expect(notices).toEqual([]);
    expect(external.profile).toBe(0);
    expect(fake.calls.generate.map((call) => call.model)).toEqual(hostCall);
  });

  it("a provider that OpenCode never lists still falls back to the external API with the notice", async () => {
    const { fake, stop } = await startPlugin();
    const notices: Notice[] = [];
    try {
      expect((await capture("absent-provider", notices))?.summary).toBe("external");
      expect(await learn(fake, "absent-provider", notices)).toEqual({ ok: true });
    } finally {
      await stop();
    }
    expect(fake.calls.generate).toEqual([]);
    expect(external).toEqual({ capture: 1, profile: 1 });
    expect(notices.map((notice) => notice.title)).toEqual([
      "Using fallback provider",
      "Using fallback provider",
    ]);
    for (const notice of notices) expect(notice.message).toContain("absent-provider");
  });
});

/** Run the in-session import command with `--model <providerID>/glm-4.6`; returns its report. */
async function importCommand(fake: ReturnType<typeof createFakeV2Context>, providerID: string) {
  await fake.commands.get("memory-import-opencode-history").execute({
    sessionID: "ses-user",
    prompt: { text: `--model ${providerID}/${SESSION_MODEL.id} --dry-run` },
  });
  return JSON.stringify(fake.calls.synthetic);
}

/**
 * Start one web import with `<providerID>/glm-4.6`, as a single host or a group, and return
 * the job. Model construction is replaced, so the job stops right after the provider check.
 */
async function webImport(providerID: string, group: boolean) {
  const registered = getOpencodeHostModels()!;
  registerOpencodeHostModels({
    ...registered,
    createImportModels: async () => {
      throw new Error("import models reached");
    },
  });
  const modelChoice = `${providerID}/${SESSION_MODEL.id}`;
  const selection = { mode: "all", excludedKeys: [], revision: "r1", listedAt: 1000 };
  const jobs = new SettingsImportJobs({
    readiness: async () => ({
      external: { state: "ready", provider: "openai-chat", model: "external-model" },
      opencode: {
        available: true,
        models: [{ provider: providerID, model: SESSION_MODEL.id, name: "GLM" }],
      },
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
  } as never);
  const child = { host: "pi", source: "pi", selection, modelChoice };
  await jobs.start(
    group ? { hosts: [child], options: { scope: "current-project" } } : { ...child, options: {} },
    "/tmp/project"
  );
  const end = Date.now() + 5_000;
  while (jobs.current()?.state === "running" && Date.now() < end) await sleep(10);
  return JSON.stringify(jobs.current());
}

describe("OpenCode imports with a provider list that fills after start-up", () => {
  it("the in-session import command accepts the provider when only a re-read lists it", async () => {
    const { fake, stop } = await startPlugin();
    try {
      expect(await importCommand(fake, SESSION_MODEL.providerID)).not.toContain("not connected");
    } finally {
      await stop();
    }
  });

  it("a single web import accepts the provider when only a re-read lists it", async () => {
    const { stop } = await startPlugin();
    try {
      expect(await webImport(SESSION_MODEL.providerID, false)).toContain("import models reached");
    } finally {
      await stop();
    }
  });

  it("a grouped web import accepts the provider when only a re-read lists it", async () => {
    const { stop } = await startPlugin();
    try {
      expect(await webImport(SESSION_MODEL.providerID, true)).toContain("import models reached");
    } finally {
      await stop();
    }
  });

  it("every import path still refuses a provider that OpenCode never lists", async () => {
    const { fake, stop } = await startPlugin();
    try {
      expect(await importCommand(fake, "absent-provider")).toContain(
        'OpenCode provider \\"absent-provider\\" is not connected'
      );
      expect(await webImport("absent-provider", false)).toContain(
        "OpenCode provider is not connected"
      );
      expect(await webImport("absent-provider", true)).toContain(
        "OpenCode provider is not connected"
      );
    } finally {
      await stop();
    }
  });
});
