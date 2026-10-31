// The `memory` tool for Claude Code, which Claude sees as `mcp__omms__memory`.
// Pi and OpenCode ship a `memory` tool. Without this one, the omms-memory skill
// tells Claude to run `om-memory-system memory <mode> ...` through Bash. This
// tool runs that same command through the plugin's launcher, the one the hooks
// run, so it needs no global install and each call shows as its own tool row.
// The tool is registered from the plugin's one `session.start` hook, in `omms.jsx`.

export const TOOL = "memory";
const FULL_NAME = `mcp__omms__${TOOL}`;
// A first `npx` download can take longer than the 30 second default.
const LAUNCHER_TIMEOUT_MS = 60_000;
const REASON_LIMIT = 500;

// `import`, `export`, `migrate` and `list-shards` are left out on purpose: they
// move or rewrite whole stores and files. The user runs them in a terminal.
const MODES = ["search", "add", "list", "profile", "forget", "help"];

export const DESCRIPTION = [
  "Search and save OMMS project memory: earlier fixes, decisions and conventions. Use this tool instead of running `om-memory-system memory` through Bash; it runs the same command.",
  'mode "search" (query, limit, scope): search before you debug, when the user refers to earlier work, and before a decision about conventions.',
  'If a project search finds nothing, retry with other keywords, then scope "all-projects".',
  'mode "add" (content, type, tags): save one short memory after a decision, a bug fix or a stated preference. Never store secrets.',
  'mode "list" (limit, scope), "profile" (content saves a personal preference), "forget" (id; only when the user asks), "help".',
].join(" ");

export const INPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: MODES, description: 'Which operation to run. Default "search".' },
    query: { type: "string", description: "Keywords to search for (search)." },
    content: { type: "string", description: "Memory text (add) or preference text (profile)." },
    type: {
      type: "string",
      description:
        "decision, bug-fix, feature, refactor, configuration, analysis, discussion or other (add).",
    },
    tags: { type: "string", description: "Comma-separated tags (add)." },
    id: { type: "string", description: "Memory id (forget)." },
    limit: { type: "number", description: "Most results to return (search, list)." },
    scope: {
      type: "string",
      enum: ["project", "all-projects"],
      description: "Where to search (search, list).",
    },
  },
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** The `memory <mode> ...` arguments for one tool call, or the reason the call is refused. */
function memoryArgs(input) {
  const mode = text(input.mode) || "search";
  if (!MODES.includes(mode)) {
    return { error: `Unknown mode "${mode}". Use one of: ${MODES.join(", ")}.` };
  }
  const args = ["memory", mode];
  const flag = (name, value) => {
    if (value) args.push(`--${name}`, value);
  };

  if (mode === "search") {
    const query = text(input.query);
    if (!query) return { error: "search needs a query." };
    flag("query", query);
  }
  if (mode === "add" || mode === "profile") {
    const content = text(input.content);
    if (!content && mode === "add") return { error: "add needs content." };
    flag("content", content);
  }
  if (mode === "add") {
    flag("type", text(input.type));
    flag("tags", text(input.tags));
  }
  if (mode === "forget") {
    const id = text(input.id);
    if (!id) return { error: "forget needs an id." };
    flag("id", id);
  }
  if (mode === "search" || mode === "list") {
    const limit = Number(input.limit);
    if (Number.isInteger(limit) && limit > 0) flag("limit", String(limit));
    const scope = text(input.scope);
    if (scope === "project" || scope === "all-projects") flag("scope", scope);
  }
  return { args };
}

const failed = (reason) => ({ deny: `memory failed: ${reason.slice(0, REASON_LIMIT)}` });

/** What Claude reads: the command's JSON on success, the error otherwise. */
function readOutcome(run) {
  const out = run.stdout.trim();
  let reply = null;
  try {
    reply = JSON.parse(out);
  } catch {
    reply = null;
  }
  if (run.exitCode === 0 && reply?.success !== false && out) return { result: out };
  const reason =
    (typeof reply?.error === "string" && reply.error) ||
    run.stderr.trim() ||
    out ||
    `exit code ${run.exitCode}`;
  return failed(reason);
}

export const registerMemoryTool = (on) => {
  on("tool.call", async ($, e, next) => {
    if (String(e.tool) !== FULL_NAME) return next(e);
    const parsed = memoryArgs(e);
    if ("error" in parsed) return { deny: parsed.error };
    try {
      const cwd = await $.session.cwd();
      // The launcher's npx fallback runs from the temp folder, so name the project folder too.
      const run = await $.process.run(
        [
          "node",
          `${$.plugin.root}/bin/omms-launch.mjs`,
          "--at-least-own-version",
          ...parsed.args,
          "--directory",
          cwd,
        ],
        { cwd, timeoutMs: LAUNCHER_TIMEOUT_MS }
      );
      return readOutcome(run);
    } catch (error) {
      // Node.js is missing, or the run passed the time limit.
      return failed(error instanceof Error ? error.message : String(error));
    }
  });
};
