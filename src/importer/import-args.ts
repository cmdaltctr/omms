import type { ImportPathMap } from "./importer.js";

/**
 * One option grammar for every history-import surface: the Pi and OpenCode
 * slash commands and the `om-memory-system` CLI. Hosts differ only in where
 * their history lives (`--root` for Pi, `--db` for OpenCode) and in how a
 * model is chosen (a session uses its host's sign-in; the CLI uses an
 * external API and key).
 */

export type ImportHost = "pi" | "opencode";
export type ImportSurface = "session" | "cli";

export interface HistoryImportArgs {
  help: boolean;
  dryRun: boolean;
  force: boolean;
  skipMemories: boolean;
  skipProfile: boolean;
  profileBatch?: number;
  /** Session: `provider/id` from the host's signed-in models. CLI: a model id for `--provider`. */
  model?: string;
  scope: "current-project" | "all-projects";
  /** Project directory for `current-project` scope; defaults to the working directory. */
  project?: string;
  session?: string;
  since?: number;
  until?: number;
  maxSessions?: number;
  pathMaps: ImportPathMap[];
  /** History location: Pi session root (`--root`) or OpenCode database (`--db`). */
  source?: string;
  provider?: string;
  apiUrl?: string;
  apiKeyEnv?: string;
  errors: string[];
}

export const SOURCE_FLAG: Record<ImportHost, string> = { pi: "--root", opencode: "--db" };

const CLI_ONLY_FLAGS = new Set(["--provider", "--api-url", "--api-key-env"]);
const BOOLEAN_FLAGS = new Set([
  "--help",
  "-h",
  "--dry-run",
  "--force",
  "--skip-memories",
  "--skip-profile",
]);
const VALUE_FLAGS = new Set([
  "--profile-batch",
  "--model",
  "--scope",
  "--project",
  "--session",
  "--since",
  "--until",
  "--max-sessions",
  "--map",
  "--root",
  "--db",
  ...CLI_ONLY_FLAGS,
]);

/** Split a slash-command argument string, honouring single and double quotes. */
export function tokenizeImportArgs(raw: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of raw.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function parseTimestamp(raw: string, endOfDay: boolean): number | undefined {
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return undefined;
  // A bare YYYY-MM-DD parses to UTC midnight; an inclusive end date covers that whole day.
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parsed + 86_399_999 : parsed;
}

function positiveInt(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseHistoryImportArgs(
  tokens: string[],
  options: { host: ImportHost; surface: ImportSurface }
): HistoryImportArgs {
  const result: HistoryImportArgs = {
    help: false,
    dryRun: false,
    force: false,
    skipMemories: false,
    skipProfile: false,
    scope: "current-project",
    pathMaps: [],
    errors: [],
  };
  const sourceFlag = SOURCE_FLAG[options.host];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const equals = token.startsWith("--") ? token.indexOf("=") : -1;
    const flag = equals === -1 ? token : token.slice(0, equals);

    if (BOOLEAN_FLAGS.has(flag)) {
      if (equals !== -1) {
        result.errors.push(`${flag} takes no value`);
        continue;
      }
      if (flag === "--help" || flag === "-h") result.help = true;
      else if (flag === "--dry-run") result.dryRun = true;
      else if (flag === "--force") result.force = true;
      else if (flag === "--skip-memories") result.skipMemories = true;
      else result.skipProfile = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag) || ((flag === "--root" || flag === "--db") && flag !== sourceFlag)) {
      result.errors.push(`Unknown option: "${token}"`);
      continue;
    }
    if (CLI_ONLY_FLAGS.has(flag) && options.surface !== "cli") {
      result.errors.push(`${flag} is only for the om-memory-system CLI; use --model provider/id`);
      continue;
    }

    let value: string;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else {
      const next = tokens[i + 1];
      value = next !== undefined && !next.startsWith("--") ? next : "";
      if (value) i++;
    }
    if (!value) {
      result.errors.push(`${flag} requires a value`);
      continue;
    }

    switch (flag) {
      case "--profile-batch":
        result.profileBatch = positiveInt(value);
        if (result.profileBatch === undefined)
          result.errors.push("--profile-batch needs a positive integer");
        break;
      case "--max-sessions":
        result.maxSessions = positiveInt(value);
        if (result.maxSessions === undefined)
          result.errors.push("--max-sessions needs a positive integer");
        break;
      case "--model":
        result.model = value;
        break;
      case "--scope":
        if (value === "current-project" || value === "all-projects") result.scope = value;
        else result.errors.push(`--scope must be current-project or all-projects, got "${value}"`);
        break;
      case "--project":
        result.project = value;
        break;
      case "--session":
        result.session = value;
        break;
      case "--since":
      case "--until":
        {
          const parsed = parseTimestamp(value, flag === "--until");
          if (parsed === undefined) result.errors.push(`${flag} is not a valid date: "${value}"`);
          else if (flag === "--since") result.since = parsed;
          else result.until = parsed;
        }
        break;
      case "--map": {
        const separator = value.indexOf("=");
        if (separator > 0 && separator < value.length - 1) {
          result.pathMaps.push({ from: value.slice(0, separator), to: value.slice(separator + 1) });
        } else {
          result.errors.push(`--map must be <oldPath>=<newPath>, got "${value}"`);
        }
        break;
      }
      case "--root":
      case "--db":
        result.source = value;
        break;
      case "--provider":
        result.provider = value;
        break;
      case "--api-url":
        result.apiUrl = value;
        break;
      case "--api-key-env":
        result.apiKeyEnv = value;
        break;
    }
  }

  if (result.since !== undefined && result.until !== undefined && result.since > result.until) {
    result.errors.push("--since must be before --until");
  }
  if (result.project !== undefined && result.scope === "all-projects") {
    result.errors.push("--project cannot be combined with --scope=all-projects");
  }
  if (options.surface === "session" && result.model !== undefined) {
    const separator = result.model.indexOf("/");
    if (separator < 1 || separator === result.model.length - 1) {
      result.errors.push(`--model must be provider/id, got "${result.model}"`);
    }
  }
  return result;
}

/** True when the run calls a model: a real import of memories or the profile. */
export function importNeedsModel(args: HistoryImportArgs): boolean {
  return !args.dryRun && (!args.skipMemories || !args.skipProfile);
}

export function historyImportUsage(host: ImportHost, surface: ImportSurface): string {
  const name = host === "pi" ? "pi" : "opencode";
  const invoke =
    surface === "session"
      ? `/memory-import-${name}-history`
      : `om-memory-system import-${name}-history`;
  const source =
    host === "pi"
      ? "  --root <dir>              Pi session root (default ~/.pi/agent/sessions)"
      : "  --db <path>               OpenCode database (default ~/.local/share/opencode/opencode.db)";
  const model =
    surface === "session"
      ? `  --model <provider/id>     Use another signed-in model (default: this session's model)`
      : `  --model <id>              Model id (default: saved memoryModel)
  --provider <type>         Provider type (default: saved memoryProvider)
  --api-url <url>           Endpoint; required when --provider differs from the saved one
  --api-key-env <name>      Read the API key from this environment variable`;
  return `Usage: ${invoke} [options]

Preview first: ${invoke} --dry-run

Options:
  --dry-run                 Preview counts; no model calls or writes
${model}
  --scope <scope>           current-project (default) or all-projects
  --project <dir>           Project for current-project scope (default: working directory)
  --session <id>            Import one session
  --since <date>            Inclusive start (ISO 8601 or epoch ms)
  --until <date>            Inclusive end; a bare date covers the whole day
  --max-sessions <n>        Read at most n sessions, oldest first
  --map <old>=<new>         Map a recorded directory that no longer exists (repeatable)
${source}
  --skip-memories           Record profile prompts only
  --skip-profile            Import memories only
  --profile-batch <n>       Prompts per profile analysis batch (default: 50)
  --force                   Reprocess already-handled memory work units
  --help                    Show this help

Values may follow the flag or use --flag=value.`;
}
