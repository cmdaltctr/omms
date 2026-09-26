import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PI_IMPORT_COMMAND,
  PI_IMPORT_USAGE,
  parseImportArgs,
  registerPiHistoryImportCommand,
} from "../src/adapters/pi/import-command.js";
import { createPiCaptureProvider, resolveModelFromContext } from "../src/adapters/pi/provider.js";
import { adaptPiProfileModel } from "../src/adapters/pi/profile.js";

// One test runs a Bun child process, which can exceed 5 s on Windows and Intel macOS runners.
setDefaultTimeout(30_000);

describe("import command argument parsing", () => {
  it("defaults to current-project scope with no writes", () => {
    const parsed = parseImportArgs("");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.force).toBe(false);
    expect(parsed.scope).toBe("current-project");
    expect(parsed.pathMaps).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("parses flags, dates, and numeric limits", () => {
    const parsed = parseImportArgs(
      "--dry-run --force --scope=all-projects --session=sess-1 --since=2026-01-01 --until=2026-03-01T00:00:00Z --max-sessions=5"
    );
    expect(parsed.dryRun).toBe(true);
    expect(parsed.force).toBe(true);
    expect(parsed.scope).toBe("all-projects");
    expect(parsed.session).toBe("sess-1");
    expect(parsed.since).toBe(Date.parse("2026-01-01"));
    expect(parseImportArgs("--until=2026-01-01").until).toBe(
      Date.parse("2026-01-01T23:59:59.999Z")
    );
    expect(parsed.until).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(parsed.maxSessions).toBe(5);
    expect(parsed.errors).toEqual([]);
  });

  it("accepts epoch milliseconds and repeated maps", () => {
    const parsed = parseImportArgs(
      "--since=1767225600000 --map=/old/one=/new/one --map=/old/two=/new/two --root=/tmp/sessions"
    );
    expect(parsed.since).toBe(1767225600000);
    expect(parsed.pathMaps).toEqual([
      { from: "/old/one", to: "/new/one" },
      { from: "/old/two", to: "/new/two" },
    ]);
    expect(parsed.source).toBe("/tmp/sessions");
  });

  it("reports invalid values instead of guessing", () => {
    const parsed = parseImportArgs(
      "--scope=nonsense --since=not-a-date --max-sessions=-3 --map=noseparator --unknown"
    );
    expect(parsed.errors.length).toBe(5);
    expect(parsed.errors.join(" ")).toContain("--scope");
    expect(parsed.errors.join(" ")).toContain("--since");
    expect(parsed.errors.join(" ")).toContain("--max-sessions");
    expect(parsed.errors.join(" ")).toContain("--map");
    expect(parsed.errors.join(" ")).toContain("--unknown");
  });

  it("accepts a separate Pi model and lets the profile step be skipped", () => {
    const parsed = parseImportArgs("--model zai/glm-5.3-air --skip-profile");
    expect(parsed.model).toBe("zai/glm-5.3-air");
    expect(parsed.skipProfile).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("exposes a usage document naming the command", () => {
    expect(PI_IMPORT_COMMAND).toBe("memory-import-pi-history");
    expect(PI_IMPORT_USAGE).toContain(`/${PI_IMPORT_COMMAND}`);
    expect(PI_IMPORT_USAGE).toContain("--dry-run");
    expect(PI_IMPORT_USAGE).toContain("--map <old>=<new>");
    expect(PI_IMPORT_USAGE).toContain("--model <provider/id>");
    expect(PI_IMPORT_USAGE).not.toContain("--api-key-env");
  });
});

it("uses the selected Pi model for capture and profile without changing the active model", async () => {
  const active = { provider: "zai", id: "active" };
  const selected = { provider: "zai", id: "cheap" };
  const calls: string[] = [];
  const ctx = {
    model: active,
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === "zai" && id === "cheap" ? selected : undefined,
      complete: async (model: typeof active) => {
        calls.push(model.id);
        return {
          content: [
            {
              type: "text",
              text:
                calls.length === 1
                  ? '{"type":"skip"}'
                  : '{"preferences":[],"patterns":[],"workflows":[]}',
            },
          ],
        };
      },
    },
  };
  const handle = resolveModelFromContext(ctx, "zai/cheap")!;
  const capture = createPiCaptureProvider(() => handle);
  expect(
    (
      await capture.summarize({
        context: "context",
        userPrompt: "hello",
        projectDirectory: process.cwd(),
        sessionId: "s",
      })
    )?.type
  ).toBe("skip");
  const profile = adaptPiProfileModel(handle);
  expect(JSON.parse(await profile.complete("system", "prompt"))).toMatchObject({ preferences: [] });
  expect(calls).toEqual(["cheap", "cheap"]);
  expect(ctx.model).toBe(active);
  expect(resolveModelFromContext(ctx, "zai/missing")).toBeNull();
});

it("stops a missing model before the command starts importing", async () => {
  const notifications: string[] = [];
  let handler: ((args: string, context: object) => Promise<void>) | undefined;
  registerPiHistoryImportCommand(
    {
      registerCommand: (
        _name: string,
        command: {
          handler: (args: string, context: object) => Promise<void>;
        }
      ) => {
        handler = command.handler;
      },
    } as never,
    () =>
      ({
        cwd: process.cwd(),
        hasUI: true,
        ui: { notify: (message: string) => notifications.push(message) },
        modelRegistry: { find: () => undefined },
        model: { provider: "zai", id: "active" },
      }) as never
  );
  await handler!("--model zai/missing --dry-run", { waitForIdle: async () => {} });
  expect(notifications.join(" ")).toContain("model not found: zai/missing");
  expect(notifications.join(" ")).not.toContain("work units:");
});

it("records Pi history prompts, creates a profile, and keeps dry-run read-only", () => {
  const base = mkdtempSync(join(tmpdir(), "omms-pi-profile-command-"));
  try {
    const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;
    const script = `
import { mock } from "bun:test";
import { mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const base = ${JSON.stringify(base)};
const embedding = { embedWithTimeout: async () => new Float32Array([1, 0, 0, 0]),
  warmup: async () => {}, isWarmedUp: true };
mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: embedding,
  EmbeddingService: class { static getInstance() { return embedding; } },
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(url("../src/services/turso/ready.js"))}, () => ({
  ensureTursoReady: async () => {}, resetTursoReady: () => {},
}));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
const { CONFIG } = await import(${JSON.stringify(url("../src/config.js"))});
CONFIG.storagePath = base + "/store";
CONFIG.embeddingDimensions = 4;
CONFIG.autoCaptureMaxContextBytes = 131072;
const { importPiHistory } = await import(${JSON.stringify(url("../src/importer/importer.js"))});
const { loadPiSessionForImport } = await import(${JSON.stringify(url("../src/importer/session-loader.js"))});
const { makeProjectDir, writeV3Session } = await import(${JSON.stringify(url("./pi-import-fixtures.js"))});
`;
    const rest = `
const project = makeProjectDir(base, "project");
for (const args of [["init", "-q"], ["config", "user.email", "test@example.invalid"],
  ["config", "user.name", "Test User"]]) {
  const result = spawnSync("git", args, { cwd: project });
  if (result.status !== 0) throw new Error(result.stderr.toString());
}
const root = base + "/sessions";
mkdirSync(root);
writeV3Session({ file: root + "/s.jsonl", sessionId: "s", cwd: project,
  windows: [{ userText: "Improve importer", assistantText: "Done" }] });
const filters = { scope: "all-projects", currentDirectory: project, root };
const provider = { summarize: async () => ({ type: "skip", summary: "", tags: [] }) };
const model = { provider: "test", modelId: "cheap", complete: async () =>
  JSON.stringify({ preferences: [], patterns: [], workflows: [] }) };
const deps = { loadSession: loadPiSessionForImport, provider, profile: { model } };
const preview = await importPiHistory({ ...deps, profile: {} }, { ...filters, dryRun: true });
const storeAfterPreview = existsSync(CONFIG.storagePath);
const imported = await importPiHistory(deps, filters);
const { userPromptManager } = await import(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))});
const { userProfileManager } = await import(${JSON.stringify(url("../src/services/user-profile/user-profile-manager.js"))});
const { getTags } = await import(${JSON.stringify(url("../src/services/tags.js"))});
const profile = await userProfileManager.getActiveProfile(getTags(project).user.userEmail);
const rerun = await importPiHistory(deps, filters);
console.log("RESULT:" + JSON.stringify({ preview: preview.profile,
  storeAfterPreview, imported: imported.profile, hasProfile: Boolean(profile),
  rerun: rerun.profile, uncaptured: await userPromptManager.countUncapturedPrompts() }));
`;
    const scriptPath = join(base, "scenario.mjs");
    writeFileSync(scriptPath, script + rest);
    const process = Bun.spawnSync(["bun", "run", scriptPath], { cwd: base });
    const output = process.stdout.toString();
    const result = output.match(/RESULT:(.*)$/m);
    if (!result) throw new Error(`${output}\n${process.stderr.toString()}`);
    const report = JSON.parse(result[1]!);
    expect(report.preview.promptsWouldRecord).toBe(1);
    expect(report.storeAfterPreview).toBe(false);
    expect(report.imported.promptsRecorded).toBe(1);
    expect(report.imported.batchesBuilt).toBe(1);
    expect(report.hasProfile).toBe(true);
    expect(report.rerun.promptsAlreadyHandled).toBe(1);
    expect(report.uncaptured).toBe(0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
