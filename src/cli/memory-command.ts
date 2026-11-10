import { resolve } from "node:path";
import type { MemoryOperationArgs, MemoryOperationMode } from "../core/memory-operations.js";

/**
 * `om-memory-system memory <mode>`: the shared `memory` tool operations from a
 * terminal, for hosts without an in-process tool (Claude Code). Parsing and
 * usage stay free of engine imports so `--help` is fast; config, storage and
 * embeddings load with dynamic `import()` only when an operation runs.
 */

export interface MemoryCommandIO {
  /** Working directory used when `--directory` is not given. */
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const MODES: Record<MemoryOperationMode, string> = {
  add: "Store a memory (--content, optional --type and --tags)",
  memorise: "Save an exact memorisation (text, or --topic --done --doing --next; optional --tags)",
  memorize: "Same as memorise",
  recall: "Fetch memorisations by ms- ID, text or label (argument or --query, optional --tags)",
  search: "Search project memories (query as an argument or --query)",
  profile: "Show the user profile, or save a preference with --content",
  list: "List recent memories (--limit, default 20)",
  forget: "Remove a memory (--id)",
  help: "Print the memory tool guide as JSON",
  "list-shards": "List project memory shards and orphaned path associations",
  migrate: "Reassociate orphaned shards after a directory move (--from-path or --from-hash)",
  export: "Export project memories to a portable JSON file (--output)",
  import: "Import memories from a portable JSON file (--input)",
  space: "Manage memory spaces: list, status, create, archive, unarchive, use (--action, --name)",
};

const VALUE_FLAGS: Record<string, keyof MemoryOperationArgs | "directory" | "hostSessionId"> = {
  "--content": "content",
  "--query": "query",
  "--type": "type",
  "--tags": "tags",
  "--topic": "topic",
  "--done": "done",
  "--doing": "doing",
  "--next": "next",
  "--session-id": "hostSessionId",
  "--id": "memoryId",
  "--limit": "limit",
  "--scope": "scope",
  "--from-path": "fromPath",
  "--from-hash": "fromHash",
  "--output": "outputPath",
  "--input": "inputPath",
  "--action": "spaceAction",
  "--name": "spaceName",
  "--directory": "directory",
};

const BOOLEAN_FLAGS: Record<string, "dryRun" | "allowLinkedSource"> = {
  "--dry-run": "dryRun",
  "--allow-linked-source": "allowLinkedSource",
};

export const memoryCommandUsage = `Usage: om-memory-system memory <mode> [options]

Runs one memory operation for the current project and prints one JSON
document. Memories added here are stored with host claude-code.

Modes:
${Object.entries(MODES)
  .map(([mode, description]) => `  ${mode.padEnd(13)} ${description}`)
  .join("\n")}

Options:
  --content <text>        Memory text (add), exact text (memorise) or preference text (profile)
  --query <text>          Search text (search), or an ms- ID or text (recall)
  --type <type>           Memory type, for example decision or bug-fix (add)
  --tags <a,b>            Comma-separated tags (add, memorise, recall)
  --topic <text>          Snapshot topic (memorise)
  --done <text>           Snapshot: what is done (memorise)
  --doing <text>          Snapshot: what is in progress (memorise)
  --next <text>           Snapshot: what comes next (memorise)
  --session-id <id>       Host session ID, so a repeat snapshot can replace its earlier one (memorise)
  --id <id>               Memory id (forget)
  --limit <n>             Maximum results (search, list)
  --scope <scope>         project or all-projects (search, list)
  --from-path <path>      Old project path (migrate)
  --from-hash <hash>      Old project hash (migrate)
  --output <file>         Export file (export)
  --input <file>          Import file (import)
  --action <action>       Space action: list, status, create, archive, unarchive, use (space)
  --name <name>           Space name or id (space)
  --dry-run               Report without writing (migrate, import)
  --allow-linked-source   Allow a linked source directory (migrate)
  --directory <path>      Project directory (default: the working directory)
  --help, -h              Print this help

Text inside <private>...</private> is removed before storage.

Examples:
  om-memory-system memory search "database choice"
  om-memory-system memory add --content "Use libSQL for the store" --type decision
  om-memory-system memory memorise --topic "Auth" --doing "Token refresh" --next "Tests"
  om-memory-system memory recall ms-4k7q2p
  om-memory-system memory recall --tags release,wip "token refresh"`;

interface ParsedMemoryCommand {
  help: boolean;
  args: MemoryOperationArgs;
  directory?: string;
  /** From `--session-id`; becomes the operation context's `hostSessionId`. */
  hostSessionId?: string;
}

function isMode(value: string): value is MemoryOperationMode {
  return Object.hasOwn(MODES, value);
}

/** Parse `<mode> [options]` into memory tool arguments. Throws on bad input. */
export function parseMemoryCommandArgs(argv: string[]): ParsedMemoryCommand {
  const isHelpFlag = (value: string | undefined) => value === "--help" || value === "-h";
  if (argv.length === 0 || isHelpFlag(argv[0])) return { help: true, args: {} };
  const [mode, ...rest] = argv;
  if (!mode || !isMode(mode)) {
    throw new Error(`Unknown memory mode "${mode}". Modes: ${Object.keys(MODES).join(", ")}`);
  }

  const args: MemoryOperationArgs = { mode };
  const values: Record<string, string> = {};
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]!;
    if (isHelpFlag(token)) return { help: true, args: {} };
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    const booleanKey = BOOLEAN_FLAGS[flag];
    if (booleanKey) {
      if (equals !== -1) throw new Error(`${flag} takes no value`);
      args[booleanKey] = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) throw new Error(`Unknown option ${flag}`);
    // A following flag is not a value; literal text that starts with "--" needs `--flag=value`.
    const next = rest[index + 1];
    const value =
      equals !== -1
        ? token.slice(equals + 1)
        : next !== undefined && !next.startsWith("--")
          ? rest[++index]
          : undefined;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    values[key] = value;
  }

  if (mode === "space") {
    // `space <action> [name]`
    const [action, name, ...extra] = positionals;
    if (extra.length > 0) throw new Error(`Unexpected argument "${extra[0]}"`);
    if (action !== undefined) {
      if (values.spaceAction !== undefined) throw new Error(`Unexpected argument "${action}"`);
      values.spaceAction = action;
    }
    if (name !== undefined) {
      if (values.spaceName !== undefined) throw new Error(`Unexpected argument "${name}"`);
      values.spaceName = name;
    }
  } else if (positionals.length > 0) {
    // One positional: search and recall read it as the query, memorise as the text.
    const target =
      mode === "search" || mode === "recall"
        ? "query"
        : mode === "memorise" || mode === "memorize"
          ? "content"
          : undefined;
    if (!target || positionals.length > 1 || values[target] !== undefined) {
      throw new Error(`Unexpected argument "${positionals[0]}"`);
    }
    values[target] = positionals[0]!;
  }

  for (const [key, value] of Object.entries(values)) {
    if (key === "limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error("--limit needs a positive whole number");
      }
      args.limit = limit;
    } else if (key === "scope") {
      if (value !== "project" && value !== "all-projects") {
        throw new Error("--scope must be project or all-projects");
      }
      args.scope = value;
    } else if (key !== "directory" && key !== "hostSessionId") {
      (args as Record<string, unknown>)[key] = value;
    }
  }
  return { help: false, args, directory: values.directory, hostSessionId: values.hostSessionId };
}

/** Run `om-memory-system memory ...` and return the process exit code. */
export async function runMemoryCommand(argv: string[], io: MemoryCommandIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => console.log(text));
  const stderr = io.stderr ?? ((text: string) => console.error(text));

  let parsed: ParsedMemoryCommand;
  try {
    parsed = parseMemoryCommandArgs(argv);
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n\n${memoryCommandUsage}`);
    return 1;
  }
  if (parsed.help) {
    stdout(memoryCommandUsage);
    return 0;
  }

  const directory = resolve(io.cwd ?? process.cwd(), parsed.directory ?? ".");
  let result: Record<string, unknown>;
  const secrets: string[] = [];
  try {
    const { CONFIG, initConfigWithLegacyMigration } = await import("../config.js");
    initConfigWithLegacyMigration(directory);
    for (const secret of [CONFIG.memoryApiKey, CONFIG.embeddingApiKey]) {
      if (secret) secrets.push(secret);
    }
    const { executeMemoryOperation } = await import("../core/memory-operations.js");
    const { memoryClient } = await import("../services/client.js");
    try {
      result = await executeMemoryOperation(parsed.args, {
        directory,
        host: "claude-code",
        hostSessionId: parsed.hostSessionId,
      });
    } finally {
      // Release the store so the process can exit once the reply is printed.
      await memoryClient.close().catch(() => {});
    }
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  let output = JSON.stringify(result, null, 2);
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  stdout(output);
  return result.success === false ? 1 : 0;
}
