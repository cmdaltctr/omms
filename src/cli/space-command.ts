import { resolve } from "node:path";
import { SPACE_ACTIONS, WEB_ONLY_SPACE_ACTIONS } from "../services/spaces/operations.js";

/**
 * `om-memory-system space <action> [name]`: list, create, switch, archive and unarchive memory
 * spaces from a terminal. Deleting, renaming, backing up and restoring a space exist only in the
 * web app, so those actions are refused here. Parsing stays free of engine imports so `--help`
 * is fast.
 */

export interface SpaceCommandIO {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export const spaceCommandUsage = `Usage: om-memory-system space <action> [name]

Actions:
  list                 List spaces and show the active one
  status               Show the space this project uses now
  create <name>        Add an empty space (it does not become active)
  use <name>           Make a space the active one for every host, from the next turn
  archive <name>       Hide a space from the switcher and keep its data
  unarchive <name>     Show an archived space again

<name> is a space name or id. Deleting, renaming, backing up and restoring a space
are only possible in the web app.

Examples:
  om-memory-system space list
  om-memory-system space create "Client work"
  om-memory-system space use "Client work"`;

/** Run `om-memory-system space ...` and return the process exit code. */
export async function runSpaceCommand(argv: string[], io: SpaceCommandIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => console.log(text));
  const stderr = io.stderr ?? ((text: string) => console.error(text));
  const [action, name, ...extra] = argv;
  if (action === undefined || action === "--help" || action === "-h") {
    stdout(spaceCommandUsage);
    return 0;
  }
  const known = [...SPACE_ACTIONS, ...WEB_ONLY_SPACE_ACTIONS];
  if (!known.includes(action) || extra.length > 0 || (name?.startsWith("--") ?? false)) {
    const problem =
      extra.length > 0 ? `Unexpected argument "${extra[0]}"` : `Unknown space action "${action}"`;
    stderr(`${problem}\n\n${spaceCommandUsage}`);
    return 1;
  }

  const directory = resolve(io.cwd ?? process.cwd());
  let result: Record<string, unknown>;
  try {
    const { initConfig } = await import("../config.js");
    initConfig(directory);
    const { runSpaceMode } = await import("../core/space-tool.js");
    result = await runSpaceMode({ mode: "space", spaceAction: action, spaceName: name }, directory);
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  stdout(JSON.stringify(result, null, 2));
  return result.success === false ? 1 : 0;
}
