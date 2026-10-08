import { expect, it } from "bun:test";
import { SettingsImportJobs } from "../src/importer/web-import-jobs.js";
import {
  summarizeHistoryImportReport,
  type HistoryImportReport,
} from "../src/importer/run-import.js";

for (const dryRun of [true, false])
  it(`counts unresolved sessions in group ${dryRun ? "previews" : "final reports"} while preserving legacy entries`, async () => {
    const report: HistoryImportReport = {
      dryRun,
      root: "/synthetic/history",
      sessionsDiscovered: 5,
      sessionsLoaded: 0,
      sessionsFilteredOut: 0,
      sessionsUnrecognized: 0,
      unitsTotal: 0,
      unitsImported: 0,
      unitsWouldImport: 0,
      unitsSkipped: 0,
      unitsFailed: 0,
      unitsAlreadyHandled: 0,
      skipReasons: {},
      projects: [],
      units: [],
      unresolvedProjects: [{ directory: "/synthetic/missing", sessions: 5, units: 10 }],
      unresolvableSessions: [],
      loadErrors: [],
    };
    expect(summarizeHistoryImportReport(report).unresolved).toBe(1);
    const jobs = new SettingsImportJobs({
      readiness: async () => ({
        external: { state: "ready", provider: "openai-chat", model: "synthetic" },
        opencode: { available: false, models: [] },
        piReader: { available: true },
      }),
      resolveSelection: async (_token, _selection, options) => ({
        identity: {
          host: options.host,
          kind: options.host === "opencode" ? "opencode-db" : "pi-folder",
          realPath: `/synthetic/${options.host}`,
          dev: 1,
          ino: 2,
        },
        keys: ["synthetic"],
        cutoff: 1000,
      }),
      prepareModels: async () => ({}),
      discardSelection: async () => {},
      runner: async (host) =>
        host === "opencode"
          ? report
          : {
              ...report,
              unresolvedProjects: [],
              unresolvableSessions: [{ file: "/synthetic/pi.jsonl", cwd: "/synthetic/missing" }],
            },
    });
    await jobs.start(
      {
        hosts: ["pi", "opencode"].map((host) => ({
          host,
          source: host,
          modelChoice: "external",
          selection: { mode: "all", excludedKeys: [], revision: "synthetic", listedAt: 1000 },
        })),
        options: { dryRun, scope: "all-projects", skipProfile: true },
      },
      "/synthetic/project"
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs.current()).toMatchObject({
      state: "done",
      hosts: [
        { host: "pi", summary: { unresolved: 1 } },
        { host: "opencode", summary: { unresolved: 5 } },
      ],
      summary: { unresolved: 6 },
    });
    expect(summarizeHistoryImportReport(report).unresolved).toBe(1);
  });
