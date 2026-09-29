#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  historyImportUsage,
  importNeedsModel,
  parseHistoryImportArgs,
  type HistoryImportArgs,
  type ImportHost,
} from "../importer/import-args.js";

const COMMANDS: Record<string, ImportHost> = {
  "import-opencode-history": "opencode",
  "import-pi-history": "pi",
  "import-claude-history": "claude-code",
};

const usage = `Usage: om-memory-system <command> [options]

Commands:
  import-opencode-history   Import OpenCode history into omms
  import-pi-history         Import Pi history into omms
  import-claude-history     Import Claude Code history into omms
  web                       Start the web app in the foreground
  web install|uninstall|status  Manage the web app login item
  memory <mode> [options]   Search, add, list, or forget memories (run with --help)
  claude-hook <event>       Run a Claude Code hook (used by the Claude Code plugin)

Options:
  --version, -v             Print the installed version

Import commands take the same options; run one with --help to see them.
Inside a session, /memory-import-opencode-history and /memory-import-pi-history
use that session's model instead of an API key. import-claude-history always
uses the external API or --provider, --api-url, and --api-key-env.`;

export function parseImportArgs(argv: string[]): { host: ImportHost; args: HistoryImportArgs } {
  const [command, ...rest] = argv;
  const host = command ? COMMANDS[command] : undefined;
  if (!host) {
    throw new Error(
      "Expected import-opencode-history, import-pi-history, or import-claude-history; use --help"
    );
  }
  const args = parseHistoryImportArgs(rest, { host, surface: "cli" });
  if (!args.help && args.errors.length > 0) throw new Error(args.errors.join("; "));
  return { host, args };
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv[0] === "--version" || argv[0] === "-v") {
    const { packageVersion } = await import("../services/package-version.js");
    console.log(packageVersion());
    return 0;
  }
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage);
    return 0;
  }
  if (argv[0] === "claude-hook") {
    const { runClaudeHookCommand } = await import("../adapters/claude-code/hook-command.js");
    await runClaudeHookCommand(argv.slice(1));
    // An idle fetch connection could keep the hook alive past its Claude Code timeout.
    process.exit(0);
  }
  if (argv[0] === "memory") {
    const { runMemoryCommand } = await import("./memory-command.js");
    return await runMemoryCommand(argv.slice(1));
  }
  if (argv[0] === "web") {
    try {
      const { runWebCommand } = await import("./web-command.js");
      return await runWebCommand(argv.slice(1));
    } catch (error) {
      console.error(
        `OMMS web command failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return 1;
    }
  }
  const apiKeyEnv =
    argv.find((_, index) => argv[index - 1] === "--api-key-env") ??
    argv.find((value) => value.startsWith("--api-key-env="))?.slice("--api-key-env=".length);
  try {
    const { host, args } = parseImportArgs(argv);
    if (args.help) {
      console.log(historyImportUsage(host, "cli"));
      return 0;
    }
    const { initConfig, initConfigWithLegacyMigration } = await import("../config.js");
    if (args.dryRun) initConfig(process.cwd());
    else initConfigWithLegacyMigration(process.cwd());
    let models = {};
    let model: string | undefined;
    if (importNeedsModel(args)) {
      const { selectImportModel } = await import("../importer/model-selection.js");
      const selected = selectImportModel({
        provider: args.provider,
        model: args.model,
        apiUrl: args.apiUrl,
        apiKeyEnv: args.apiKeyEnv,
      });
      models = {
        ...(!args.skipMemories ? { capture: selected.capture } : {}),
        ...(!args.skipProfile ? { profile: selected.profile } : {}),
      };
      model = `${selected.provider}/${selected.modelId}`;
      console.log(`Import model: ${model}`);
    }
    const { formatHistoryImportReport, historyImportFailed, runHistoryImport } =
      await import("../importer/run-import.js");
    const report = await runHistoryImport(host, args, {
      cwd: process.cwd(),
      models,
      track: { surface: "cli" },
    });
    console.log(formatHistoryImportReport(host, report, model));
    return historyImportFailed(report) ? 1 : 0;
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

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    // Resolve symlinks: npm/npx expose the bin through node_modules/.bin links,
    // so comparing the raw argv[1] against the module URL would never match.
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
