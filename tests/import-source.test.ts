import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { importHistorySource, type ImportReport } from "../src/importer/importer.js";

it("stops between units when an import is cancelled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omms-import-cancel-"));
  const previousStorage = CONFIG.storagePath;
  CONFIG.storagePath = directory;
  const controller = new AbortController();
  const source = [
    {
      sessionId: "s",
      directory,
      sourceFile: "opencode.db",
      units: ["a", "b"].map((id) => ({
        userEntryId: id,
        userPrompt: id,
        sourceEntryIds: [id],
        textResponses: ["done"],
        toolCalls: [],
      })),
    },
  ];
  const report = () =>
    ({
      unitsTotal: 0,
      unitsWouldImport: 0,
      unitsAlreadyHandled: 0,
      units: [],
    }) as unknown as ImportReport;
  try {
    const first = report();
    await importHistorySource(
      source,
      "opencode",
      {
        provider: {
          summarize: async () => {
            throw new Error("dry-run called model");
          },
        },
        onProgress: (processed) => {
          if (processed === 1) controller.abort();
        },
        signal: controller.signal,
      },
      { dryRun: true },
      first
    );
    expect(first.units).toHaveLength(1);
    const second = report();
    await importHistorySource(
      source,
      "opencode",
      {
        provider: {
          summarize: async () => {
            throw new Error("dry-run called model");
          },
        },
      },
      { dryRun: true },
      second
    );
    expect(second.units).toHaveLength(2);
  } finally {
    CONFIG.storagePath = previousStorage;
    rmSync(directory, { recursive: true, force: true });
  }
});

it("uses the host label for work-unit keys without writing on dry-run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omms-import-source-"));
  const previousStorage = CONFIG.storagePath;
  CONFIG.storagePath = directory;
  try {
    const report = {
      unitsTotal: 0,
      unitsWouldImport: 0,
      unitsAlreadyHandled: 0,
      units: [],
    } as unknown as ImportReport;
    await importHistorySource(
      [
        {
          sessionId: "s",
          directory,
          sourceFile: "opencode.db",
          units: [
            {
              userEntryId: "u",
              userPrompt: "Fix bug",
              sourceEntryIds: ["a"],
              textResponses: ["Fixed bug"],
              toolCalls: [],
            },
          ],
        },
      ],
      "opencode",
      {
        provider: {
          summarize: async () => {
            throw new Error("dry-run called model");
          },
        },
      },
      { dryRun: true },
      report
    );
    expect(report.units[0]?.key).toBe("opencode:s:u:a");
    expect(report.unitsWouldImport).toBe(1);
  } finally {
    CONFIG.storagePath = previousStorage;
    rmSync(directory, { recursive: true, force: true });
  }
});
