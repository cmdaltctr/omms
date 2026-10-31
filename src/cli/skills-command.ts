import { readFileSync } from "node:fs";
import type { SkillOperationArgs, SkillOperationResult } from "../core/skill-operations.js";

/**
 * `om-memory-system skills <mode>`. Each mode lives in its own handler; this
 * file only dispatches. Logs and progress go to stderr, results to stdout.
 * The shared modes (list to help) run `runSkillOperation`, the same code as the
 * hosts' `skills` tool, and record `person` on apply. The Claude Code tool
 * passes the hidden `--applied-by agent`, so its applies record `agent`.
 */

const usage = `Usage: om-memory-system skills <mode> [options]

Modes:
  list                      Skills ranked by use in the last 30 days
  ideas                     Up to three new skill ideas from recorded turns
  draft                     Draft an improvement (--skill) or a new skill
                            (--idea-name, --idea-description, --folder) as a pending proposal
  evidence                  A skill's SKILL.md, numbers and recorded turns (--skill, --limit)
  propose                   Save a fixed SKILL.md as a pending proposal, with no model call
                            (--skill or the idea options, --content-file, --summary, --evidence)
  proposals                 List proposals, newest first (--state)
  show                      One proposal with its summary, evidence and diff (--id)
  apply                     Write a pending proposal to its SKILL.md (--id)
  reject                    Reject a pending proposal (--id)
  undo                      Restore the file an applied proposal changed (--id)
  help                      List the modes
  record-past [--yes]       Record past turns from every set-up host's history; no model call
  delete-turns [--yes]      Delete every recorded turn; proposals and saved skill versions stay

Options for the modes from list to help:
  --skill <name|path>       Skill name, or the full path of its SKILL.md (draft, evidence, propose)
  --idea-name <name>        Name of a new skill idea (draft, propose)
  --idea-description <text> Description of a new skill idea (draft, propose)
  --folder <path>           Watched folder for a new skill (draft, propose)
  --limit <n>               Recorded turns to show, 1 to 20; default 10 (evidence)
  --content-file <path>     File with the full new SKILL.md; - reads standard input (propose)
  --summary <text>          What changed and why (propose)
  --evidence <ids>          Turn ids that show the need, such as 12,14 (propose)
  --state <state>           pending, applied, stale, rejected or undone (proposals)
  --order <order>           uses (default) or attention (list)
  --id <id>                 Proposal id (show, apply, reject, undo)
  --json                    Print the result as one JSON document

Without --yes, record-past and delete-turns print counts and change nothing.
Run record-past or delete-turns with --help to see its options.`;

type Print = (line: string) => void;

const OPERATION_MODES = new Set([
  "list",
  "ideas",
  "draft",
  "evidence",
  "propose",
  "proposals",
  "show",
  "apply",
  "reject",
  "undo",
  "help",
]);

const VALUE_FLAGS = new Set([
  "--skill",
  "--id",
  "--state",
  "--order",
  "--folder",
  "--idea-name",
  "--idea-description",
  "--limit",
  "--content-file",
  "--summary",
  "--evidence",
  // Hidden: the Claude Code tool passes `--applied-by agent`.
  "--applied-by",
]);

type AppliedBy = "person" | "agent";

/** Parse the shared modes' options. Throws on bad input or an unreadable content file. */
function parseOperationArgs(argv: string[]): {
  args: SkillOperationArgs;
  json: boolean;
  appliedBy: AppliedBy;
} {
  const values: Record<string, string> = {};
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    const equals = token.indexOf("=");
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument "${token}"`);
    if (!VALUE_FLAGS.has(flag)) throw new Error(`Unknown option ${flag}`);
    // A following flag is not a value; literal text that starts with "--" needs `--flag=value`.
    const next = argv[index + 1];
    const value =
      equals !== -1
        ? token.slice(equals + 1)
        : next !== undefined && !next.startsWith("--")
          ? argv[++index]
          : undefined;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    values[flag] = value;
  }
  const args: SkillOperationArgs = {
    skill: values["--skill"],
    id: values["--id"],
    state: values["--state"],
    order: values["--order"],
    folder: values["--folder"],
    limit: values["--limit"],
    summary: values["--summary"],
    evidence: values["--evidence"],
  };
  const contentFile = values["--content-file"];
  if (contentFile !== undefined) {
    try {
      args.content = readFileSync(contentFile === "-" ? 0 : contentFile, "utf8");
    } catch {
      throw new Error(`Cannot read --content-file ${contentFile}`);
    }
  }
  const appliedBy = values["--applied-by"];
  if (appliedBy !== undefined && appliedBy !== "agent") {
    throw new Error("--applied-by accepts only agent");
  }
  if (values["--idea-name"] !== undefined || values["--idea-description"] !== undefined) {
    args.idea = { name: values["--idea-name"], description: values["--idea-description"] };
  }
  return { args, json, appliedBy: appliedBy === "agent" ? "agent" : "person" };
}

/** Run one shared `skills` mode for the working directory (spec: Agents and terminal reach operations). */
async function runOperation(
  mode: string,
  argv: string[],
  print: Print,
  printError: Print
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    print(usage);
    return 0;
  }
  let parsed: ReturnType<typeof parseOperationArgs>;
  try {
    parsed = parseOperationArgs(argv);
  } catch (error) {
    printError(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    return 1;
  }
  const directory = process.cwd();
  const secrets: string[] = [];
  let result: SkillOperationResult;
  try {
    const { CONFIG, initConfig } = await import("../config.js");
    initConfig(directory);
    for (const secret of [CONFIG.memoryApiKey, CONFIG.embeddingApiKey]) {
      if (secret) secrets.push(secret);
    }
    const { runSkillOperation } = await import("../core/skill-operations.js");
    const { skillOperationsDeps } = await import("../services/skill-learning/operations-deps.js");
    result = await runSkillOperation(
      mode,
      parsed.args,
      skillOperationsDeps(directory, parsed.appliedBy)
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    result = { success: false, mode, code: "error", text };
  }
  let output = parsed.json ? JSON.stringify(result, null, 2) : result.text;
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  print(output);
  return result.success ? 0 : 1;
}

/** Delete every recorded turn with its tool calls and skill uses (spec: The user can delete recorded turns). */
async function runDeleteTurns(argv: string[], print: Print): Promise<number> {
  let yes = false;
  for (const flag of argv) {
    if (flag === "--yes") yes = true;
    else if (flag === "--help" || flag === "-h") {
      print(
        "Usage: om-memory-system skills delete-turns [--yes]\n\nDelete every recorded turn. Proposals and saved skill versions stay."
      );
      return 0;
    } else {
      print(`Unknown option ${flag}; use --help`);
      return 1;
    }
  }
  try {
    const { existsSync } = await import("node:fs");
    const { CONFIG, initConfig } = await import("../config.js");
    initConfig(process.cwd());
    const { SkillStore, skillsDbPath } = await import("../services/skill-learning/store.js");
    const { skillStoragePath } = await import("../services/skill-learning/skill-folders.js");
    const path = skillsDbPath(skillStoragePath(CONFIG));
    const store = new SkillStore(path);
    if (!yes) {
      print(`Recorded turns: ${await store.countTurns()}`);
      print("Run again with --yes to delete them. Proposals and saved skill versions stay.");
      return 0;
    }
    // init checks the schema version, so a file from a newer OMMS is never changed.
    if (existsSync(path)) await store.init();
    const deleted = await store.deleteAllTurns();
    print(`Deleted ${deleted} recorded turns. Proposals and saved skill versions stay.`);
    return 0;
  } catch (error) {
    print(`Delete turns failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function runSkillsCommand(
  argv: string[],
  print: Print = console.log,
  printError: Print = console.error
): Promise<number> {
  const [mode, ...rest] = argv;
  if (!mode || mode === "--help" || mode === "-h") {
    print(usage);
    return 0;
  }
  if (OPERATION_MODES.has(mode)) return runOperation(mode, rest, print, printError);
  if (mode === "record-past") {
    const { runSkillsRecordPast } = await import("./skills-record-past.js");
    return runSkillsRecordPast(rest, print);
  }
  if (mode === "delete-turns") return runDeleteTurns(rest, print);
  print(`Unknown skills mode: ${mode}\n\n${usage}`);
  return 1;
}
