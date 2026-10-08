import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { hostLabel } from "../types/host-label.js";
import {
  parseHistoryImportArgs,
  webImportTokens,
  type HistoryImportArgs,
  type ImportHost,
} from "./import-args.js";
import { importBlockedReason, type ImportReadiness } from "./import-readiness.js";
import { resolveImportSelection, type ResolvedImportSelection } from "./import-sessions.js";
import {
  importSourceKey,
  readImportSourceToken,
  type ImportSourceIdentity,
} from "./import-sources.js";
import {
  historyImportFailed,
  ImportAlreadyRunningError,
  runHistoryImport,
  summarizeHistoryImportReport,
  type HistoryImportRun,
} from "./run-import.js";
import { safeHealthError } from "./settings-health.js";
import { ImportJobError, type GroupImportRequest } from "./web-import-jobs.js";
import {
  profileEstimate,
  readWaitingProfilePrompts,
  type ProfileEstimate,
} from "./web-import-profile-estimate.js";
import { profileFailureCode } from "../core/profile-failure.js";

export type GroupHostState =
  "queued" | "running" | "done" | "failed" | "cancelled" | "no-work" | "not-run";
type LegacySummary = ReturnType<typeof summarizeHistoryImportReport>;
export type GroupImportSummary = Omit<LegacySummary, "profile"> & {
  profile?: NonNullable<LegacySummary["profile"]> & { promptsAlreadyHandled: number };
};
type Summary = GroupImportSummary;
export interface GroupHostJob {
  host: ImportHost;
  state: GroupHostState;
  sessions: number;
  phase: "preparing" | "memory" | "profile";
  processed: number;
  total: number;
  profileProcessed: number;
  profileTotal: number;
  summary?: Summary;
  profileEstimate?: ProfileEstimate;
  /** Model readiness for a real run, also visible in a read-only preview. */
  blocker?: string;
  error?: string;
}
export interface GroupImportJob {
  id: string;
  dryRun: boolean;
  state: "running" | "cancelling" | "cancelled" | "done" | "failed";
  activeHost?: ImportHost;
  hosts: GroupHostJob[];
  sessions: number;
  processed: number;
  total: number;
  summary?: Summary;
  profileEstimate?: ProfileEstimate;
  error?: string;
}
export interface GroupImportDeps {
  /** Model construction and store warmup, never invoked by a preview. */
  prepareModels?: (
    choice: string,
    directory: string,
    signal: AbortSignal,
    host: ImportHost
  ) => Promise<HistoryImportRun["models"]>;
  discardSelection?: (identity: ImportSourceIdentity) => Promise<void>;
  waitingPrompts?: () => Promise<Set<string>>;
}
type Deps = GroupImportDeps & {
  runner: typeof runHistoryImport;
  resolveSelection: typeof resolveImportSelection;
  readiness: () => Promise<ImportReadiness>;
};
type Child = {
  input: GroupImportRequest["hosts"][number];
  args: HistoryImportArgs;
  row: GroupHostJob;
  selection?: ResolvedImportSelection;
};

async function prepareModels(
  choice: string,
  directory: string,
  signal: AbortSignal
): Promise<HistoryImportRun["models"]> {
  if (signal.aborted) return {};
  let models: HistoryImportRun["models"];
  if (choice === "external") {
    const { selectImportModel } = await import("./model-selection.js");
    models = selectImportModel({});
  } else {
    const [providerID = "", ...id] = choice.split("/");
    const { getOpencodeHostModels } = await import("./backfill-controls.js");
    const opencode = getOpencodeHostModels();
    if (!opencode?.isProviderConnected(providerID))
      throw new Error("OpenCode provider is not connected");
    models = await opencode.createImportModels({ providerID, modelID: id.join("/") }, directory);
  }
  if (!signal.aborted) {
    const { memoryClient } = await import("../services/client.js");
    await memoryClient.warmup();
  }
  return models;
}
async function discardSelection(identity: ImportSourceIdentity): Promise<void> {
  if (identity.kind !== "opencode-db") return;
  const { opencodeSnapshots } = await import("./opencode-snapshot.js");
  opencodeSnapshots.discard(importSourceKey(identity));
}
function matchOptions(child: Child, directory: string, signal: AbortSignal) {
  return {
    host: child.input.host,
    scope: child.args.scope,
    ...(child.args.project ? { project: child.args.project } : {}),
    pathMaps: child.args.pathMaps,
    cwd: directory,
    allowEmpty: true,
    signal,
  };
}
function hostError(host: ImportHost, error: unknown): ImportJobError {
  return new ImportJobError(
    `${hostLabel(host)}: ${safeHealthError(error, [CONFIG.memoryApiKey, CONFIG.embeddingApiKey])}`,
    (error as { status?: number }).status ?? 400
  );
}
function emptySummary(dryRun: boolean): Summary {
  return {
    dryRun,
    sessionsDiscovered: 0,
    sessionsLoaded: 0,
    sessionsFilteredOut: 0,
    unitsTotal: 0,
    unitsImported: 0,
    unitsWouldImport: 0,
    unitsSkipped: 0,
    unitsFailed: 0,
    unitsAlreadyHandled: 0,
    unitsHeldBack: 0,
    unitsUntimed: 0,
    projects: 0,
    unresolved: 0,
    loadErrors: 0,
  };
}
function updateTotals(job: GroupImportJob): void {
  job.sessions = job.hosts.reduce((n, child) => n + child.sessions, 0);
  job.processed = job.hosts.reduce((n, child) => n + child.processed, 0);
  job.total = job.hosts.reduce((n, child) => n + child.total, 0);
  const reports = job.hosts.flatMap((child) => (child.summary ? [child.summary] : []));
  const sum: Summary = {
    ...(reports[0] ?? emptySummary(job.dryRun)),
    profile: undefined,
  };
  for (const key of Object.keys(sum) as (keyof Summary)[]) {
    if (typeof sum[key] !== "number") continue;
    (sum as unknown as Record<string, unknown>)[key] = reports.reduce(
      (n, report) => n + (report[key] as number),
      0
    );
  }
  const profiles = reports.flatMap((report) => (report.profile ? [report.profile] : []));
  if (profiles.length)
    sum.profile = {
      promptsRecorded: profiles.reduce((n, p) => n + p.promptsRecorded, 0),
      promptsWouldRecord: profiles.reduce((n, p) => n + p.promptsWouldRecord, 0),
      promptsAlreadyHandled: profiles.reduce((n, p) => n + p.promptsAlreadyHandled, 0),
      batchesBuilt: profiles.reduce((n, p) => n + p.batchesBuilt, 0),
      // Every child drains the same queue. Its last reading is the remaining backlog.
      remaining: profiles.at(-1)!.remaining,
      failed: profiles.some((p) => p.failed),
    };
  job.summary = sum;
}

/** Preflight every child before launching a bounded sequential group in the existing slot. */
export async function startImportGroup(
  input: GroupImportRequest,
  directory: string,
  deps: Deps,
  publish: (job: GroupImportJob, controller: AbortController) => void
): Promise<GroupImportJob> {
  const controller = new AbortController();
  const job: GroupImportJob = {
    id: randomUUID(),
    dryRun: Boolean(input.options.dryRun),
    state: "running",
    hosts: input.hosts.map(({ host }) => ({
      host,
      state: "queued",
      sessions: 0,
      phase: "preparing",
      processed: 0,
      total: 0,
      profileProcessed: 0,
      profileTotal: 0,
    })),
    sessions: 0,
    processed: 0,
    total: 0,
  };
  const children: Child[] = input.hosts.map((child, index) => {
    const options = {
      ...input.options,
      ...(child.modelChoice && child.modelChoice !== "external"
        ? { model: child.modelChoice }
        : {}),
    };
    const args = parseHistoryImportArgs(webImportTokens(options, child.host), {
      host: child.host,
      surface: "web",
    });
    if (args.errors.length) throw hostError(child.host, new Error(args.errors.join("; ")));
    return { input: child, args, row: job.hosts[index]! };
  });
  publish(job, controller);
  const cleanup = async () => {
    for (const child of children) {
      // A failed resolver may already have opened a snapshot for its signed token.
      let identity = child.selection?.identity;
      if (!identity) {
        try {
          identity = readImportSourceToken(child.input.source, child.input.host);
        } catch {
          continue;
        }
      }
      await (deps.discardSelection ?? discardSelection)(identity).catch(() => {});
    }
  };
  try {
    const readiness = await deps.readiness();
    for (const child of children) {
      if (controller.signal.aborted) break;
      const host = child.input.host;
      try {
        const readerBlocked = importBlockedReason(readiness, { host, needsModel: false });
        if (readerBlocked) throw new Error(readerBlocked);
        child.row.blocker =
          importBlockedReason(readiness, {
            host,
            needsModel: true,
            modelChoice: child.input.modelChoice,
          }) ?? undefined;
        if (!job.dryRun && child.row.blocker) throw new Error(child.row.blocker);
        child.selection = await deps.resolveSelection(
          child.input.source,
          child.input.selection,
          matchOptions(child, directory, controller.signal)
        );
        child.row.sessions = child.selection.keys.length;
        if (child.selection.unresolvedCount !== undefined)
          child.row.summary = {
            ...emptySummary(job.dryRun),
            unresolved: child.selection.unresolvedCount,
          };
        child.args.source = child.selection.identity.realPath;
        if (!child.row.sessions) child.row.state = "no-work";
      } catch (error) {
        if (controller.signal.aborted) break;
        const refused = hostError(host, error);
        if (!job.dryRun) throw refused;
        child.row.state = "failed";
        child.row.error = refused.message;
      }
    }
    updateTotals(job);
    if (controller.signal.aborted) {
      for (const child of job.hosts) if (child.state === "queued") child.state = "cancelled";
      await cleanup();
      job.state = "cancelled";
      return structuredClone(job);
    }
    const waiting =
      job.dryRun && !input.options.skipProfile
        ? await (deps.waitingPrompts ?? readWaitingProfilePrompts)()
        : new Set<string>();
    void (async () => {
      let outcome: GroupImportJob["state"] = "failed";
      try {
        outcome = await executeGroup(children, job, controller.signal, directory, deps, waiting);
      } catch {
        outcome = controller.signal.aborted ? "cancelled" : "failed";
        job.error = "Import preparation failed. Refresh the preview and retry.";
      } finally {
        delete job.activeHost;
        if (!job.dryRun || outcome !== "done") await cleanup();
        job.state = controller.signal.aborted ? "cancelled" : outcome;
      }
    })();
    return structuredClone(job);
  } catch (error) {
    await cleanup();
    if (controller.signal.aborted) {
      for (const child of job.hosts) if (child.state === "queued") child.state = "cancelled";
      job.state = "cancelled";
      return structuredClone(job);
    }
    throw error;
  }
}

async function executeGroup(
  children: Child[],
  job: GroupImportJob,
  signal: AbortSignal,
  directory: string,
  deps: Deps,
  waiting: Set<string>
): Promise<GroupImportJob["state"]> {
  const history = new Set<string>();
  if (job.dryRun && !children[0]!.args.skipProfile)
    job.profileEstimate = profileEstimate(history, waiting, children[0]!.args.profileBatch ?? 50);
  let failed = job.hosts.some((row) => row.state === "failed");
  for (const child of children) {
    if (child.row.state !== "queued") continue;
    if (signal.aborted || (failed && !job.dryRun)) {
      child.row.state = signal.aborted ? "cancelled" : "not-run";
      continue;
    }
    const host = child.input.host;
    job.activeHost = host;
    child.row.state = "running";
    try {
      // Reuse the signed source and original selection. Never refresh a queued child.
      const current = await deps.resolveSelection(
        child.input.source,
        child.input.selection,
        matchOptions(child, directory, signal)
      );
      const pinned = child.selection!;
      if (
        importSourceKey(current.identity) !== importSourceKey(pinned.identity) ||
        current.cutoff !== pinned.cutoff ||
        JSON.stringify([...current.keys].sort()) !== JSON.stringify([...pinned.keys].sort())
      )
        throw new Error("The session list is out of date. Refresh the list and try again.");
      if (signal.aborted) {
        child.row.state = "cancelled";
        continue;
      }
      // Reader/model readiness may change while earlier children finish their profile work.
      const blocked = importBlockedReason(await deps.readiness(), {
        host,
        needsModel: !job.dryRun,
        modelChoice: child.input.modelChoice,
      });
      if (blocked) throw new Error(blocked);
      const models = job.dryRun
        ? {}
        : await (deps.prepareModels ?? prepareModels)(
            child.input.modelChoice!,
            directory,
            signal,
            host
          );
      if (signal.aborted) {
        child.row.state = "cancelled";
        continue;
      }
      const eligible = new Set<string>();
      child.row.phase = child.args.skipMemories ? "profile" : "memory";
      const report = await deps.runner(host, child.args, {
        cwd: directory,
        models,
        signal,
        track: { surface: "web" },
        selection: {
          keys: pinned.keys,
          cutoff: pinned.cutoff,
          ...(pinned.identity.kind === "opencode-db"
            ? { snapshotKey: importSourceKey(pinned.identity) }
            : {}),
        },
        onProgress: (processed, total) => {
          child.row.processed = processed;
          child.row.total = total;
          updateTotals(job);
        },
        onProfileProgress: (done, total) => {
          child.row.phase = "profile";
          child.row.profileProcessed = done;
          child.row.profileTotal = total;
        },
        ...(job.dryRun && !child.args.skipProfile
          ? {
              onProfilePrompt: (identity: string) => {
                eligible.add(identity);
                history.add(identity);
              },
            }
          : {}),
      });
      const summary = summarizeHistoryImportReport(report);
      child.row.summary = {
        ...summary,
        // Source resolution sees missing folders omitted from the pinned runner keys.
        unresolved:
          pinned.unresolvedCount ??
          (report.unresolvedProjects ?? []).reduce((n, project) => n + project.sessions, 0) +
            report.unresolvableSessions.length,
        profile: summary.profile
          ? { ...summary.profile, promptsAlreadyHandled: report.profile!.promptsAlreadyHandled }
          : undefined,
      };
      if (job.dryRun && !child.args.skipProfile) {
        child.row.profileEstimate = profileEstimate(
          eligible,
          waiting,
          child.args.profileBatch ?? 50
        );
        job.profileEstimate = profileEstimate(history, waiting, child.args.profileBatch ?? 50);
      }
      if (signal.aborted) child.row.state = "cancelled";
      else if (historyImportFailed(report)) {
        child.row.state = "failed";
        failed = true;
        child.row.error = `${hostLabel(host)}: ${report.unitsFailed ? "Memory work failed" : "Profile learning failed"}. Refresh the preview and retry.`;
        job.error = child.row.error;
      } else {
        const pending =
          report.unitsImported +
          report.unitsWouldImport +
          (report.profile?.promptsRecorded ?? 0) +
          (report.profile?.promptsWouldRecord ?? 0) +
          (report.profile?.batchesBuilt ?? 0) +
          (child.row.profileEstimate?.totalPrompts ?? 0);
        child.row.state = pending ? "done" : "no-work";
      }
      updateTotals(job);
    } catch (error) {
      child.row.state = signal.aborted ? "cancelled" : "failed";
      // Model exceptions can contain raw replies. Return a reason code, never their text.
      const reason =
        error instanceof ImportAlreadyRunningError || child.row.phase === "preparing"
          ? safeHealthError(error, [CONFIG.memoryApiKey, CONFIG.embeddingApiKey])
          : `${profileFailureCode(error)}. Refresh the preview and retry.`;
      child.row.error = `${hostLabel(host)}: ${reason}`;
      job.error = child.row.error;
      failed = true;
    }
  }
  return signal.aborted ? "cancelled" : failed ? "failed" : "done";
}
