import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config.js";
import type { CaptureWorkUnit } from "../src/core/capture.js";
import { importSkillTurnOutput } from "../src/importer/import-turn-outputs.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

/**
 * Record past turns runs inside the web app. `skills.db` writes finish without
 * giving the event loop a turn, so a long run used to block every request:
 * the page showed no progress and `web status` said the app was off.
 */

const globalConfigFile = join(homedir(), ".config", "omms", "omms.jsonc");
let store: string;
let server: Server | undefined;

function unit(project: string, index: number): CaptureWorkUnit {
  return {
    host: "pi",
    hostSessionId: "s1",
    sourceType: "history-import",
    projectDirectory: project,
    userPrompt: `prompt ${index}`,
    promptId: `u${index}`,
    textResponses: ["done"],
    toolCalls: [],
  } as CaptureWorkUnit;
}

afterEach(async () => {
  server?.close();
  server = undefined;
  rmSync(globalConfigFile, { force: true });
  initConfig("/nonexistent-project");
  await cleanupTursoTestDirectory(store);
});

describe("recording imported skill turns", () => {
  it("lets a status request answer while the run is still recording", async () => {
    store = mkdtempSync(join(tmpdir(), "skill-yield-"));
    const project = join(store, "project");
    mkdirSync(project);
    mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
    writeFileSync(
      globalConfigFile,
      JSON.stringify({ skillLearning: true, storagePath: store, skillFolders: [] })
    );
    initConfig(project);
    server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const report = {};
    const record = importSkillTurnOutput({}, report)!;
    const total = 120;
    let recorded = 0;
    let recordedWhenAnswered = -1;
    let status: Promise<void> | undefined;
    for (let index = 0; index < total; index++) {
      await record(unit(project, index));
      recorded++;
      // Ask once the store is open, as the page does while the job runs.
      if (index === 5) {
        status = fetch(`http://127.0.0.1:${port}/api/settings/imports/current`)
          .then((response) => response.text())
          .then(() => {
            recordedWhenAnswered = recorded;
          });
      }
    }
    await status;

    expect(report).toMatchObject({ skillTurnsRecorded: total });
    expect(recordedWhenAnswered).toBeGreaterThan(0);
    expect(recordedWhenAnswered).toBeLessThan(total);
  }, 30_000);
});
