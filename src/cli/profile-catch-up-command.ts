const usage = `Usage: om-memory-system profile-catch-up [options]

Analyse every prompt that waits for profile learning, in batches of 50.
Without --yes the command prints the counts and exits without model calls.

Options:
  --yes                     Start the run
  --dry-run                 Print the counts only
  --provider <type>         Provider type (default: saved memoryProvider)
  --model <id>              Model id (default: saved memoryModel)
  --api-url <url>           API URL (default: saved memoryApiUrl)
  --api-key-env <NAME>      Read the API key from this environment variable
  --help                    Show this help`;

const VALUE_FLAGS = {
  "--provider": "provider",
  "--model": "model",
  "--api-url": "apiUrl",
  "--api-key-env": "apiKeyEnv",
} as const;

type Flags = { yes: boolean; dryRun: boolean; help: boolean; model: Record<string, string> };

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, dryRun: false, help: false, model: {} };
  for (let index = 0; index < argv.length; index++) {
    const [name, inline] = argv[index]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === "--yes") flags.yes = true;
    else if (name === "--dry-run") flags.dryRun = true;
    else if (name === "--help" || name === "-h") flags.help = true;
    else if (name in VALUE_FLAGS) {
      const value = inline ?? argv[++index];
      if (!value) throw new Error(`${name} needs a value`);
      flags.model[VALUE_FLAGS[name as keyof typeof VALUE_FLAGS]] = value;
    } else throw new Error(`Unknown option ${name}; use --help`);
  }
  return flags;
}

/** `om-memory-system profile-catch-up`: the same run as the Settings page button. */
export async function runProfileCatchUpCommand(
  argv: string[],
  print: (line: string) => void = console.log
): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (flags.help) {
    print(usage);
    return 0;
  }
  const { CONFIG, initConfig, initConfigWithLegacyMigration } = await import("../config.js");
  try {
    if (flags.dryRun || !flags.yes) initConfig(process.cwd());
    else initConfigWithLegacyMigration(process.cwd());
    const { previewCatchUp, CATCH_UP_BATCH_SIZE } = await import("../importer/profile-catch-up.js");
    const preview = await previewCatchUp();
    print(`Waiting prompts: ${preview.waiting}`);
    print(`Model calls: ${preview.calls} (batches of ${CATCH_UP_BATCH_SIZE})`);
    if (flags.dryRun) return 0;
    if (!flags.yes) {
      print("Run again with --yes to start.");
      return 0;
    }
    const { getTags } = await import("../services/tags.js");
    const user = getTags(process.cwd()).user;
    if (!user.userEmail) throw new Error("Profile learning needs a user email");
    const { selectImportModel } = await import("../importer/model-selection.js");
    const selected = selectImportModel(flags.model);
    print(`Profile model: ${selected.provider}/${selected.modelId}`);
    const { drainProfileBacklog } = await import("../importer/profile-backlog.js");
    const { catchUpLeaseHooks } = await import("../importer/profile-catch-up.js");
    const hooks = await catchUpLeaseHooks();
    const report = await drainProfileBacklog({
      beforeBatch: hooks.beforeBatch,
      afterBatch: hooks.afterBatch,
      user: { ...user, userEmail: user.userEmail },
      model: selected.profile,
      batchSize: CATCH_UP_BATCH_SIZE,
      onProgress: ({ batchesBuilt, remaining }) =>
        print(`Batches done: ${batchesBuilt}; prompts waiting: ${remaining}`),
    }).finally(() => hooks.release().catch(() => {}));
    print(`Batches done: ${report.batchesBuilt}; prompts waiting: ${report.remaining}`);
    if (report.superseded) {
      print("Stopped: a newer catch-up run took over.");
      return 0;
    }
    if (report.reason) {
      print(`Stopped: ${report.reason}. Run the command again to continue.`);
      return 1;
    }
    return 0;
  } catch (error) {
    const key = flags.model.apiKeyEnv ? process.env[flags.model.apiKeyEnv] : undefined;
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [key, CONFIG.memoryApiKey]) {
      if (secret) message = message.replaceAll(secret, "[redacted]");
    }
    print(`Profile catch-up failed: ${message}`);
    return 1;
  }
}
