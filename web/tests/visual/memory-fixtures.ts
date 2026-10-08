import type {
  GroupImportJob,
  GroupHostJob,
  GroupImportSummary,
} from "../../../src/importer/web-import-group.js";
import type { ImportHost } from "../../../src/importer/import-args.js";

const hosts: ImportHost[] = ["pi", "opencode", "claude-code"];
let job: GroupImportJob | null = null;
let starts = 0;
let catchUp = { state: "idle", batchesBuilt: 0, remaining: 12 };
const summary = (dryRun: boolean): GroupImportSummary => ({
  dryRun,
  sessionsDiscovered: 2,
  sessionsLoaded: 2,
  sessionsFilteredOut: 0,
  unitsTotal: 4,
  unitsWouldImport: dryRun ? 3 : 0,
  unitsImported: dryRun ? 0 : 3,
  unitsAlreadyHandled: 1,
  unitsSkipped: 0,
  unitsFailed: 0,
  unitsHeldBack: 1,
  unitsUntimed: 0,
  projects: 1,
  unresolved: 1,
  loadErrors: 0,
  profile: {
    promptsRecorded: dryRun ? 0 : 6,
    promptsWouldRecord: dryRun ? 6 : 0,
    promptsAlreadyHandled: 2,
    batchesBuilt: dryRun ? 0 : 1,
    remaining: 9,
    failed: false,
  },
});
type Outputs = { skipMemories?: boolean; skipProfile?: boolean };
function group(selected: ImportHost[], dryRun: boolean, options: Outputs = {}): GroupImportJob {
  const report = summary(dryRun);
  if (options.skipMemories) {
    report.unitsTotal =
      report.unitsWouldImport =
      report.unitsImported =
      report.unitsAlreadyHandled =
      report.unitsHeldBack =
        0;
  }
  if (options.skipProfile) delete report.profile;
  return {
    id: "synthetic-memory-group",
    dryRun,
    state: dryRun ? "done" : "running",
    sessions: selected.length * 2,
    processed: 0,
    total: 0,
    ...(dryRun ? {} : { activeHost: selected[0] }),
    hosts: selected.map((host, index): GroupHostJob => ({
      host,
      state: dryRun ? "done" : index === 0 ? "running" : "queued",
      sessions: 2,
      phase: index === 0 || dryRun ? (options.skipMemories ? "profile" : "memory") : "preparing",
      processed: 0,
      total: report.unitsTotal,
      profileProcessed: 0,
      profileTotal: 0,
      ...(dryRun
        ? {
            summary: report,
            ...(!options.skipProfile
              ? {
                  profileEstimate: {
                    historyPrompts: 6,
                    waitingPrompts: 9,
                    totalPrompts: 15,
                    analysisCalls: 1,
                  },
                }
              : {}),
          }
        : {}),
    })),
    ...(dryRun
      ? {
          summary: {
            ...report,
            sessionsDiscovered: selected.length * 2,
            sessionsLoaded: selected.length * 2,
            unitsTotal: selected.length * report.unitsTotal,
            unitsWouldImport: selected.length * report.unitsWouldImport,
            unitsAlreadyHandled: selected.length * report.unitsAlreadyHandled,
            unitsHeldBack: selected.length * report.unitsHeldBack,
            projects: selected.length,
            unresolved: selected.length,
            ...(report.profile
              ? {
                  profile: {
                    ...report.profile,
                    promptsWouldRecord: selected.length * 6,
                    promptsAlreadyHandled: selected.length * 2,
                  },
                }
              : {}),
          },
          ...(!options.skipProfile
            ? {
                profileEstimate: {
                  historyPrompts: selected.length * 6,
                  waitingPrompts: 9,
                  totalPrompts: selected.length * 6 + 9,
                  analysisCalls: 1,
                },
              }
            : {}),
        }
      : {}),
  };
}

/** Synthetic routes only. These requests never read history, stores, credentials or models. */
export function memoryResponse(
  method: string,
  path: string,
  body?: unknown
): { status: number; body: unknown } | undefined {
  const input = body as
    | {
        stage?: string;
        host?: ImportHost;
        offset?: number;
        hosts?: { host: ImportHost }[];
        options?: Outputs & { dryRun?: boolean };
      }
    | undefined;
  const ok = (value: unknown, status = 200) => ({ status, body: value });
  if (method === "POST" && path === "/api/visual/memory-state") {
    if (input?.stage === "reset") {
      job = null;
      starts = 0;
      catchUp = { state: "idle", batchesBuilt: 0, remaining: 12 };
    } else if (input?.stage === "profile" || input?.stage === "failed") {
      job = group(hosts, false);
      job.hosts[0] = {
        ...job.hosts[0]!,
        state: "done",
        phase: "profile",
        processed: 4,
        profileProcessed: 1,
        profileTotal: 1,
        summary: summary(false),
      };
      job.summary = summary(false);
      job.processed = job.total = 8;
      job.hosts[1] = {
        ...job.hosts[1]!,
        state: "running",
        phase: "profile",
        profileProcessed: 2,
        profileTotal: 4,
      };
      job.activeHost = "opencode";
      if (input.stage === "failed") {
        job.state = "failed";
        delete job.activeHost;
        job.hosts[1]!.state = "failed";
        job.hosts[1]!.error = "OpenCode: synthetic-failure";
        job.hosts[2]!.state = "not-run";
        job.error = "OpenCode: synthetic-failure";
      }
    } else return ok({ error: "Unknown synthetic stage" }, 400);
    return ok({ starts, job });
  }
  if (method === "GET" && path === "/api/settings/imports/readiness")
    return ok({
      external: { state: "ready", provider: "synthetic", model: "fixture-model" },
      opencode: { available: false, models: [] },
      piReader: { available: true },
      claudeCode: {
        available: true,
        defaultRoot: "/synthetic/claude/projects",
        defaultRootFound: true,
        modelChoices: ["external"],
      },
    });
  if (method === "GET" && path === "/api/settings/imports/current") return ok({ job });
  if (method === "POST" && path === "/api/settings/imports/sessions") {
    if (!input?.host || !hosts.includes(input.host))
      return ok({ error: "Choose a synthetic host" }, 400);
    const host = input.host;
    return ok({
      source: { sourceToken: `synthetic-${host}`, displayPath: `/synthetic/history/${host}` },
      total: 2,
      offset: input.offset ?? 0,
      unresolvedCount: 1,
      revision: `synthetic-revision-${host}`,
      listedAt: 100,
      rows: [0, 1].map((index) => ({
        key: `${host}-${index}`,
        sessionId: `synthetic-${index}`,
        createdAt: 100,
        recordedDirectory:
          "/synthetic/a-long-project-folder-for-memory-workspace-verification/src/shared/components",
        directory: "/synthetic/preview-project",
        via: "recorded",
        selectable: true,
      })),
    });
  }
  if (method === "POST" && path === "/api/settings/imports") {
    const selected = hosts.filter((host) => input?.hosts?.some((child) => child.host === host));
    if (!selected.length) return ok({ error: "Choose a synthetic host" }, 400);
    const dryRun = Boolean(input?.options?.dryRun);
    if (!dryRun) starts++;
    job = group(selected, dryRun, input?.options);
    return ok(job, 202);
  }
  if (method === "POST" && path === "/api/settings/imports/current/cancel") {
    if (!job) return ok({ error: "No synthetic job" }, 400);
    job.state = "cancelled";
    delete job.activeHost;
    for (const child of job.hosts)
      if (child.state === "queued" || child.state === "running") child.state = "cancelled";
    return ok({ job });
  }
  if (method === "GET" && path === "/api/settings/profile/catch-up")
    return ok({ preview: { waiting: 12, calls: 1 }, job: catchUp });
  if (
    method === "POST" &&
    ["start", "resume", "pause"].some(
      (action) => path === `/api/settings/profile/catch-up/${action}`
    )
  ) {
    catchUp = { ...catchUp, state: path.endsWith("/pause") ? "paused" : "running" };
    return ok(catchUp);
  }
}
