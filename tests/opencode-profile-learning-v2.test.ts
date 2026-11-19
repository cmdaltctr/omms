import { describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createFakeV2Context } from "./fake-v2-context.js";

// OpenCode reaches the shared learning pass through the V2 plugin (change
// unify-profile-learning, task 6.3). The test runs the real V2 `setup` with a fake V2 context,
// pushes one idle event and records the pass call. The pass itself is replaced by a recorder;
// tests/profile-learning-pass.test.ts covers its steps. The test waits out the real 10 s idle
// delay. The isolated test runner gives this process an empty home folder.
setDefaultTimeout(60_000);

process.env.OMMS_DISABLE_WEB_AUTOSTART = "1";
process.env.OMMS_DISABLE_AUTO_BACKFILL = "1";
process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
writeFileSync(
  join(homedir(), ".config", "omms", "omms.jsonc"),
  JSON.stringify({
    webServerEnabled: false,
    chatMessage: { enabled: false },
    opencodeProvider: "opencode-go",
    opencodeModel: "test-model",
  })
);

const recorded = {
  passes: [] as Array<Record<string, unknown>>,
  structured: [] as Array<{ providerID: string; modelID: string }>,
};

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
const loader = await import("../src/adapters/opencode/opencode-provider-loader.js");
// Kept before the mock: the module binding then points at the mock itself.
const loadRealProvider = loader.loadOpencodeProvider;
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  ...loader,
  loadOpencodeProvider: async () => ({
    ...(await loadRealProvider()),
    generateStructuredOutput: async (request: { providerID: string; modelID: string }) => {
      recorded.structured.push({ providerID: request.providerID, modelID: request.modelID });
      return { ok: true };
    },
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));
const pass = await import("../src/core/profile-learning/pass.js");
mock.module("../src/core/profile-learning/pass.js", () => ({
  ...pass,
  runProfileLearningPass: async (input: Parameters<typeof pass.runProfileLearningPass>[0]) => {
    const model = await input.model();
    if (model?.completeStructured) {
      await model.completeStructured("system", "prompts", z.object({ ok: z.boolean() }));
    }
    recorded.passes.push({
      host: input.host,
      directory: input.directory,
      provider: model?.provider ?? null,
      modelId: model?.modelId ?? null,
      notify: typeof input.notify,
    });
    return { outcome: "saved" };
  },
}));

// The store warm-up is not under test.
(globalThis as Record<symbol, unknown>)[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plugin = (await import("../src/v2/plugin.js")).default;

describe("OpenCode V2 profile learning trigger", () => {
  it("an idle event runs one shared pass with host opencode and the OpenCode model", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omms-v2-profile-learning-"));
    const fake = createFakeV2Context({ directory });
    const stop = await plugin.setup(fake.ctx);
    try {
      fake.emit({
        type: "session.execution.succeeded",
        location: { directory },
        data: { sessionID: "ses-user" },
      });
      const end = Date.now() + 20_000;
      while (recorded.passes.length === 0 && Date.now() < end) await sleep(50);
      // Time for a wrong second pass to show up.
      await sleep(500);
    } finally {
      await (stop as unknown as () => Promise<void>)();
    }

    expect(recorded.passes).toEqual([
      {
        host: "opencode",
        directory,
        provider: "opencode-go",
        modelId: "test-model",
        notify: "function",
      },
    ]);
    // The model is OpenCode structured output with the configured host model.
    expect(recorded.structured).toEqual([{ providerID: "opencode-go", modelID: "test-model" }]);
  });
});
