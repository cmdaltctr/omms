import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { CONFIG } from "../config.js";
import {
  importNeedsModel,
  parseHistoryImportArgs,
  webImportTokens,
  type ImportHost,
  type WebImportOptions,
} from "./import-args.js";
import { importBlockedReason, importReadiness, type ImportReadiness } from "./import-readiness.js";
import {
  resolveImportSelection,
  validateImportSelection,
  type ImportSelection,
} from "./import-sessions.js";
import { importSourceKey } from "./import-sources.js";
import {
  formatHistoryImportReport,
  runHistoryImport,
  summarizeHistoryImportReport,
  type HistoryImportRun,
} from "./run-import.js";
import { safeHealthError } from "./settings-health.js";

type JobState = "running" | "cancelling" | "cancelled" | "done" | "failed";
type Job = {
  id: string;
  host: ImportHost;
  dryRun: boolean;
  state: JobState;
  /** Sessions in the resolved selection. */
  sessions: number;
  processed: number;
  total: number;
  report?: string;
  summary?: ReturnType<typeof summarizeHistoryImportReport>;
  error?: string;
};
type Request = {
  host: ImportHost;
  source: unknown;
  selection: ImportSelection;
  options: WebImportOptions;
  modelChoice?: string;
};
type Runner = typeof runHistoryImport;

/** A refused job; `status` is the HTTP status the page receives. */
export class ImportJobError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ImportJobError";
  }
}

// Selection replaces --session and --max-sessions; the source comes as a token.
const fields = new Set([
  "dryRun",
  "force",
  "skipMemories",
  "skipProfile",
  "scope",
  "project",
  "since",
  "until",
  "profileBatch",
  "pathMaps",
]);

export function validateWebImportRequest(value: unknown): Request {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid import request");
  const input = value as Record<string, unknown>;
  if (input.host !== "pi" && input.host !== "opencode") throw new Error("Choose Pi or OpenCode");
  if (!input.options || typeof input.options !== "object" || Array.isArray(input.options))
    throw new Error("Invalid import options");
  const options = input.options as Record<string, unknown>;
  for (const [key, option] of Object.entries(options)) {
    if (!fields.has(key)) throw new Error(`Unknown import option: ${key}`);
    if (["dryRun", "force", "skipMemories", "skipProfile"].includes(key)) {
      if (typeof option !== "boolean") throw new Error(`Invalid ${key}`);
    } else if (key === "pathMaps") {
      if (
        !Array.isArray(option) ||
        !option.every(
          (map: unknown) =>
            map &&
            typeof map === "object" &&
            typeof (map as { from?: unknown }).from === "string" &&
            typeof (map as { to?: unknown }).to === "string"
        )
      )
        throw new Error("Invalid directory maps");
    } else if (key === "profileBatch") {
      if (!Number.isSafeInteger(option) || (option as number) < 1)
        throw new Error(`Invalid ${key}`);
    } else if (key === "since" || key === "until") {
      if (typeof option !== "string" && typeof option !== "number")
        throw new Error(`Invalid ${key}`);
    } else if (typeof option !== "string") {
      throw new Error(`Invalid ${key}`);
    } else if (key === "project" && !isAbsolute(option)) {
      throw new Error("The project must be an absolute path");
    }
  }
  if (
    input.modelChoice !== undefined &&
    (typeof input.modelChoice !== "string" ||
      (input.modelChoice !== "external" && !/^[^/]+\/.+$/.test(input.modelChoice)))
  )
    throw new Error("Choose a signed-in provider/model or the external API");
  return {
    host: input.host,
    source: input.source,
    selection: validateImportSelection(input.selection),
    options: options as WebImportOptions,
    modelChoice: input.modelChoice as string | undefined,
  };
}

export interface ImportJobDeps {
  runner?: Runner;
  resolveSelection?: typeof resolveImportSelection;
  readiness?: () => Promise<ImportReadiness>;
}

/** One in-memory slot per web server, shared by previews and imports. */
export class SettingsImportJobs {
  private job?: Job;
  private controller?: AbortController;
  private starting = false;
  private readonly runner: Runner;
  private readonly resolveSelection: typeof resolveImportSelection;
  private readonly readiness: () => Promise<ImportReadiness>;

  constructor(deps: ImportJobDeps = {}) {
    this.runner = deps.runner ?? runHistoryImport;
    this.resolveSelection = deps.resolveSelection ?? resolveImportSelection;
    this.readiness = deps.readiness ?? (() => importReadiness());
  }

  current(): Job | null {
    return this.job ? { ...this.job } : null;
  }

  private busy(): boolean {
    return this.starting || this.job?.state === "running" || this.job?.state === "cancelling";
  }

  async start(request: unknown, directory: string): Promise<Job> {
    if (this.busy()) throw new ImportJobError("An import is already running", 409);
    this.starting = true;
    try {
      return await this.begin(request, directory);
    } finally {
      this.starting = false;
    }
  }

  private async begin(request: unknown, directory: string): Promise<Job> {
    let input: Request;
    try {
      input = validateWebImportRequest(request);
    } catch (error) {
      throw new ImportJobError((error as Error).message);
    }
    const options = { ...input.options };
    if (input.modelChoice && input.modelChoice !== "external") options.model = input.modelChoice;
    const args = parseHistoryImportArgs(webImportTokens(options, input.host), {
      host: input.host,
      surface: "web",
    });
    if (args.errors.length) throw new ImportJobError(args.errors.join("; "));
    const needsModel = importNeedsModel(args);
    const blocked = importBlockedReason(await this.readiness(), {
      host: input.host,
      needsModel,
      ...(input.modelChoice ? { modelChoice: input.modelChoice } : {}),
    });
    if (blocked) throw new ImportJobError(blocked);

    let selection;
    try {
      selection = await this.resolveSelection(input.source, input.selection, {
        host: input.host,
        scope: args.scope,
        ...(args.project ? { project: args.project } : {}),
        pathMaps: args.pathMaps,
        cwd: directory,
      });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      throw new ImportJobError((error as Error).message, status);
    }
    args.source = selection.identity.realPath;

    const job: Job = {
      id: randomUUID(),
      host: input.host,
      dryRun: args.dryRun,
      state: "running",
      sessions: selection.keys.length,
      processed: 0,
      total: 0,
    };
    const controller = new AbortController();
    this.job = job;
    this.controller = controller;
    void Promise.resolve().then(async () => {
      try {
        let models: HistoryImportRun["models"] = {};
        if (needsModel) {
          if (input.modelChoice === "external") {
            const { selectImportModel } = await import("./model-selection.js");
            const selected = selectImportModel({});
            models = { capture: selected.capture, profile: selected.profile };
          } else {
            const [providerID = "", ...id] = input.modelChoice!.split("/");
            const { loadOpencodeProvider } =
              await import("../services/ai/opencode-provider-loader.js");
            const { isProviderConnected } = await loadOpencodeProvider();
            if (!isProviderConnected(providerID))
              throw new Error("OpenCode provider is not connected");
            const { createOpencodeImportModels } =
              await import("../services/ai/opencode-import-models.js");
            models = await createOpencodeImportModels(
              { providerID, modelID: id.join("/") },
              directory
            );
          }
          const { memoryClient } = await import("../services/client.js");
          await memoryClient.warmup();
        }
        const report = await this.runner(input.host, args, {
          cwd: directory,
          models,
          signal: controller.signal,
          track: { surface: "web" },
          selection: {
            keys: selection.keys,
            cutoff: selection.cutoff,
            ...(selection.identity.kind === "opencode-db"
              ? { snapshotKey: importSourceKey(selection.identity) }
              : {}),
          },
          onProgress: (processed, total) => {
            job.processed = processed;
            job.total = total;
          },
        });
        job.summary = summarizeHistoryImportReport(report);
        job.report = safeHealthError(
          formatHistoryImportReport(input.host, report, input.modelChoice),
          [CONFIG.memoryApiKey]
        );
        job.state = controller.signal.aborted ? "cancelled" : "done";
      } catch (error) {
        job.error = safeHealthError(error, [CONFIG.memoryApiKey, CONFIG.embeddingApiKey]);
        job.state = controller.signal.aborted ? "cancelled" : "failed";
      } finally {
        // A preview keeps the OpenCode copy for the import that follows; an import is the end.
        if (!args.dryRun && selection.identity.kind === "opencode-db") {
          const { opencodeSnapshots } = await import("./opencode-snapshot.js");
          opencodeSnapshots.discard(importSourceKey(selection.identity));
        }
      }
    });
    return { ...job };
  }

  cancel(): Job {
    if (!this.job || !this.controller || this.job.state !== "running")
      throw new Error("No running import");
    this.controller.abort();
    this.job.state = "cancelling";
    return { ...this.job };
  }
}
