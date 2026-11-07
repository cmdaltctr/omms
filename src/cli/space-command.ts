import { resolve } from "node:path";
import { SPACE_ACTIONS, WEB_ONLY_SPACE_ACTIONS } from "../services/spaces/operations.js";
import { runSpaceExport, runSpaceImport } from "./space-transfer-command.js";

/**
 * `om-memory-system space <action> [name] [options]`: list, create, switch, archive,
 * unarchive, preview, copy, link, unlink, export and import memory spaces from a
 * terminal. Deleting, renaming, backing up, restoring and moving exist only in the
 * web app, so those actions reach the shared operation and are refused there.
 * Parsing stays free of engine imports so `--help` is fast.
 */

export interface SpaceCommandIO {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export const spaceCommandUsage = `Usage: om-memory-system space <action> [name] [options]

Actions:
  list                 List spaces and show the active one
  status               Show the space this project uses now
  create <name>        Add an empty space (it does not become active)
  use <name>           Make a space the active one for every host, from the next turn
  archive <name>       Hide a space from the switcher and keep its data
  unarchive <name>     Show an archived space again
  preview [--from <a>] --to <b> [--since <date>] [--until <date>] [--project <tag>]
                       Count the memories a copy would carry; writes nothing
  copy [--from <a>] --to <b> [--since <date>] [--until <date>] [--project <tag>]
                       Copy memories into another space; the source stays unchanged
  link <name> [--in <space>]
                       Make <name> searchable from <space> (the active space by default)
  unlink <name> [--in <space>]
                       Remove that link
  export <name> --out <file> [--since <date>] [--until <date>] [--include-profile]
                       Write one space to a JSON file that is safe to share
  import <file> --name <new> [--retag-to-project <folder>]
                       Create a new space from an export file

<name> is a space name or id. Dates are ISO 8601 and both bounds are inclusive;
--project takes the project tag a preview's groups show. Moving memories between
spaces, and deleting, renaming, backing up or restoring a space, are only possible
in the web app.

Examples:
  om-memory-system space list
  om-memory-system space create "Client work"
  om-memory-system space use "Client work"
  om-memory-system space copy --from Experiments --to "Client work" --since 2026-10-01
  om-memory-system space link "Client work" --in Experiments
  om-memory-system space export "Client work" --out client.json`;

/** Every action the parser admits; the shared operation refuses the web-only ones. */
const KNOWN_ACTIONS = new Set([
  ...SPACE_ACTIONS,
  ...WEB_ONLY_SPACE_ACTIONS,
  "move",
  "export",
  "import",
]);

/** The value flags of the transfer forms. `--directory` is the runner's own flag. */
const VALUE_FLAGS = new Set([
  "--from",
  "--to",
  "--since",
  "--until",
  "--project",
  "--in",
  "--out",
  "--name",
  "--retag-to-project",
  "--directory",
]);

/** How many positional arguments each action takes and which value flags it allows. */
const ACTION_FORMS: Record<string, { positionals: number; flags: Set<string> }> = {
  list: { positionals: 0, flags: new Set() },
  status: { positionals: 0, flags: new Set() },
  create: { positionals: 1, flags: new Set() },
  use: { positionals: 1, flags: new Set() },
  archive: { positionals: 1, flags: new Set() },
  unarchive: { positionals: 1, flags: new Set() },
  delete: { positionals: 1, flags: new Set() },
  rename: { positionals: 1, flags: new Set() },
  backup: { positionals: 1, flags: new Set() },
  restore: { positionals: 1, flags: new Set() },
  move: { positionals: 1, flags: new Set(["--from", "--to"]) },
  preview: {
    positionals: 1,
    flags: new Set(["--from", "--to", "--since", "--until", "--project"]),
  },
  copy: { positionals: 1, flags: new Set(["--from", "--to", "--since", "--until", "--project"]) },
  link: { positionals: 1, flags: new Set(["--in"]) },
  unlink: { positionals: 1, flags: new Set(["--in"]) },
  export: { positionals: 1, flags: new Set(["--out", "--since", "--until"]) },
  import: { positionals: 1, flags: new Set(["--name", "--retag-to-project"]) },
};

interface ParsedSpaceCommand {
  values: Map<string, string>;
  includeProfile: boolean;
  positionals: string[];
  directory?: string;
}

/** One pass over the argument list; every option is `--flag value` or a positional. */
function parseSpaceArgs(argv: string[]): ParsedSpaceCommand | string {
  const parsed: ParsedSpaceCommand = {
    values: new Map(),
    includeProfile: false,
    positionals: [],
    directory: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--include-profile") {
      parsed.includeProfile = true;
      continue;
    }
    if (token.startsWith("--")) {
      if (!VALUE_FLAGS.has(token)) return `Unknown option "${token}".`;
      const value = argv[++i];
      if (value === undefined) return `Option "${token}" needs a value.`;
      parsed.values.set(token.slice(2), value);
      continue;
    }
    parsed.positionals.push(token);
  }
  parsed.directory = parsed.values.get("directory");
  return parsed;
}

/** Run `om-memory-system space ...` and return the process exit code. */
export async function runSpaceCommand(argv: string[], io: SpaceCommandIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => console.log(text));
  const stderr = io.stderr ?? ((text: string) => console.error(text));
  const [action, ...rest] = argv;
  if (action === undefined || action === "--help" || action === "-h") {
    stdout(spaceCommandUsage);
    return 0;
  }
  const fail = (problem: string): number => {
    stderr(`${problem}\n\n${spaceCommandUsage}`);
    return 1;
  };
  if (!KNOWN_ACTIONS.has(action)) return fail(`Unknown space action "${action}"`);
  const parsed = parseSpaceArgs(rest);
  if (typeof parsed === "string") return fail(parsed);
  const form = ACTION_FORMS[action]!;
  const { values, positionals, includeProfile } = parsed;
  if (positionals.length > form.positionals) {
    return fail(`Unexpected argument "${positionals[form.positionals]}"`);
  }
  for (const flag of values.keys()) {
    if (flag === "directory") continue;
    if (!form.flags.has(`--${flag}`)) return fail(`The ${action} action does not take --${flag}.`);
  }
  if (includeProfile && action !== "export") {
    return fail(`The ${action} action does not take --include-profile.`);
  }

  const directory = resolve(parsed.directory ?? io.cwd ?? process.cwd());
  let result: Record<string, unknown>;
  try {
    if (action === "export" || action === "import") {
      // The portability runners own their config bridge; the memory tool has none.
      result =
        action === "export"
          ? await runSpaceExport(
              {
                name: positionals[0] ?? "",
                outPath: values.get("out") ?? "",
                ...(values.has("since") ? { since: values.get("since") } : {}),
                ...(values.has("until") ? { until: values.get("until") } : {}),
                ...(includeProfile ? { includeProfile: true } : {}),
              },
              directory
            )
          : await runSpaceImport(
              {
                filePath: positionals[0] ?? "",
                name: values.get("name") ?? "",
                ...(values.has("retag-to-project")
                  ? { retagToProject: values.get("retag-to-project") }
                  : {}),
              },
              directory
            );
    } else {
      const { initConfig } = await import("../config.js");
      initConfig(directory);
      const { runSpaceMode } = await import("../core/space-tool.js");
      result = await runSpaceMode(
        {
          mode: "space",
          spaceAction: action,
          // The transfer source may be positional or --from; the other actions take a name.
          spaceName:
            positionals[0] ??
            (action === "preview" || action === "copy" || action === "move"
              ? values.get("from")
              : undefined),
          ...(values.has("to") ? { spaceTo: values.get("to") } : {}),
          ...(values.has("since") ? { spaceSince: values.get("since") } : {}),
          ...(values.has("until") ? { spaceUntil: values.get("until") } : {}),
          ...(values.has("project") ? { spaceProject: values.get("project") } : {}),
          ...(values.has("in") ? { spaceIn: values.get("in") } : {}),
        },
        directory
      );
    }
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  stdout(JSON.stringify(result, null, 2));
  return result.success === false ? 1 : 0;
}
