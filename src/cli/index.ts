#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpencodeImportOptions } from "../importer/opencode-import.js";

const usage = `Usage: om-memory-system import-opencode-history [options]

Preview first: om-memory-system import-opencode-history --dry-run

Options:
  --dry-run                 Preview without model calls or store writes
  --db <path>               OpenCode V1 SQLite database
  --map <old>=<new>         Map a missing session directory (repeatable)
  --since <date>            Inclusive start date (ISO 8601)
  --until <date>            Inclusive end date (ISO 8601)
  --session <id>            Import one top-level session
  --project <dir>           Select one resolved project
  --max-sessions <n>        Read at most n top-level sessions
  --skip-memories           Record profile prompts only
  --skip-profile            Import memories only
  --profile-batch <n>       Prompts per profile analysis batch (default: 50)
  --provider <type>         Override the external model provider
  --model <id>              Override the external model
  --api-url <url>           Override the external model endpoint
  --api-key-env <name>      Read the import key from an environment variable
  --force                   Reprocess already-handled memory work units
  --help                    Show this help`;

function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${flag} needs a positive integer`);
  return parsed;
}

function date(value: string | undefined, flag: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} needs a valid ISO date`);
  return parsed;
}

export function parseImportArgs(argv: string[]): {
  help: boolean;
  options: OpencodeImportOptions;
  model: { provider?: string; model?: string; apiUrl?: string; apiKeyEnv?: string };
} {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      "dry-run": { type: "boolean" },
      db: { type: "string" },
      map: { type: "string", multiple: true },
      since: { type: "string" },
      until: { type: "string" },
      session: { type: "string" },
      project: { type: "string" },
      "max-sessions": { type: "string" },
      "skip-memories": { type: "boolean" },
      "skip-profile": { type: "boolean" },
      "profile-batch": { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      "api-url": { type: "string" },
      "api-key-env": { type: "string" },
      force: { type: "boolean" },
    },
  });
  if (positionals[0] !== "import-opencode-history" || positionals.length !== 1) {
    throw new Error("Expected import-opencode-history; use --help for usage");
  }
  const pathMaps = (values.map ?? []).map((value) => {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) throw new Error("--map needs old=new");
    return { from: value.slice(0, separator), to: resolve(value.slice(separator + 1)) };
  });
  const options: OpencodeImportOptions = {
    dryRun: Boolean(values["dry-run"]),
    ...(values.db ? { dbPath: resolve(values.db) } : {}),
    ...(values.since ? { since: date(values.since, "--since") } : {}),
    ...(values.until ? { until: date(values.until, "--until") } : {}),
    ...(values.session ? { session: values.session } : {}),
    ...(values.project ? { project: resolve(values.project) } : {}),
    ...(values["max-sessions"]
      ? { maxSessions: positiveInt(values["max-sessions"], "--max-sessions") }
      : {}),
    ...(values["profile-batch"]
      ? { profileBatch: positiveInt(values["profile-batch"], "--profile-batch") }
      : {}),
    pathMaps,
    force: Boolean(values.force),
    skipMemories: Boolean(values["skip-memories"]),
    skipProfile: Boolean(values["skip-profile"]),
  };
  if (options.since !== undefined && options.until !== undefined && options.since > options.until) {
    throw new Error("--since must be before --until");
  }
  return {
    help: Boolean(values.help),
    options,
    model: {
      provider: values.provider,
      model: values.model,
      apiUrl: values["api-url"],
      apiKeyEnv: values["api-key-env"],
    },
  };
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help")) {
    console.log(usage);
    return 0;
  }
  let apiKeyEnv: string | undefined;
  try {
    const parsed = parseImportArgs(argv);
    apiKeyEnv = parsed.model.apiKeyEnv;
    const { initConfig, initConfigWithLegacyMigration } = await import("../config.js");
    if (parsed.options.dryRun) initConfig(process.cwd());
    else initConfigWithLegacyMigration(process.cwd());
    if (!parsed.options.dryRun && (!parsed.options.skipMemories || !parsed.options.skipProfile)) {
      const { selectImportModel } = await import("../importer/model-selection.js");
      const selected = selectImportModel(parsed.model);
      if (!parsed.options.skipMemories) parsed.options.provider = selected.capture;
      if (!parsed.options.skipProfile) parsed.options.profileModel = selected.profile;
      console.log(`Import model: ${selected.provider}/${selected.modelId}`);
    }
    const { importOpencodeHistory } = await import("../importer/opencode-import.js");
    const report = await importOpencodeHistory(parsed.options);
    console.log(
      `Sessions: ${report.sessionsLoaded}/${report.sessionsDiscovered}; folded children: ${report.childSessionsFolded}`
    );
    for (const project of report.projects) {
      console.log(`${project.directory}: ${project.sessions} sessions, ${project.units} units`);
    }
    for (const unresolved of report.unresolvedProjects) {
      console.log(
        `Unresolved ${unresolved.directory}: ${unresolved.sessions} sessions, ${unresolved.units} units`
      );
    }
    console.log(
      `Memory units: ${report.unitsWouldImport} pending, ${report.unitsAlreadyHandled} already done, ${report.unitsImported} imported, ${report.unitsSkipped} skipped, ${report.unitsFailed} failed`
    );
    if (report.profile) {
      console.log(
        `Profile prompts: ${report.profile.promptsWouldRecord} pending, ${report.profile.promptsRecorded} recorded, ${report.profile.promptsAlreadyHandled} already done; ${report.profile.batchesBuilt} batches; ${report.profile.remaining} remaining`
      );
      if (report.profile.error) console.error(`Profile: ${report.profile.error}`);
    }
    return report.unitsFailed || report.profile?.error ? 1 : 0;
  } catch (error) {
    const { CONFIG } = await import("../config.js");
    const secrets = [apiKeyEnv ? process.env[apiKeyEnv] : undefined, CONFIG.memoryApiKey].filter(
      (value): value is string => Boolean(value)
    );
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of secrets) message = message.replaceAll(secret, "[redacted]");
    console.error(`Import failed: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
