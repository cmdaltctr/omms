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
const MODES = [
  "search",
  "add",
  "memorise",
  "memorize",
  "recall",
  "list",
  "profile",
  "forget",
  "space",
  "help",
];
const MEMORISE_MODES = ["memorise", "memorize"];

export const DESCRIPTION = [
  "Search and save OMMS project memory: earlier fixes, decisions and conventions. Use this tool instead of running `om-memory-system memory` through Bash; it runs the same command.",
  'mode "search" (query, limit, scope): search before you debug, when the user refers to earlier work, and before a decision about conventions.',
  'If a project search finds nothing, retry with other keywords, then scope "all-projects".',
  'mode "add" (content, type, tags): save one short memory after a decision, a bug fix or a stated preference. Never store secrets.',
  'mode "memorise" (content, or topic, done, doing, next; tags): save an exact memorisation with a short ms- ID, for example a session snapshot. It never reads session history. "memorize" is the same mode.',
  'mode "recall" (query, tags, limit): fetch memorisations only. Pass an ms- ID for the exact text, or text for ranked matches with a confidence score. Pass tags (the labels) to keep only memorisations that carry all of them; tags with no query lists the newest ones. When the user quotes an ms- ID or asks what was planned or memorised ("what were we going to do with X"), use recall, not search.',
  'mode "list" (limit, scope), "profile" (content saves a personal preference), "forget" (id; only when the user asks), "help".',
  'mode "space" (action, name, to, since, until, project, in): memory spaces keep separate stores. Actions: list, status, create, use (make a space active for every host), archive, unarchive, preview and copy (to a target space, optional since, until dates and project tag), link and unlink (in names the linking space). Moving, deleting, exporting and importing are not offered here; use the web app or the CLI.',
].join(" ");

export const INPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: MODES, description: 'Which operation to run. Default "search".' },
    query: {
      type: "string",
      description: "Keywords to search for (search), or an ms- ID or text (recall).",
    },
    content: {
      type: "string",
      description:
        "Memory text (add), exact memorisation text (memorise) or preference text (profile).",
    },
    type: {
      type: "string",
      description:
        "decision, bug-fix, feature, refactor, configuration, analysis, discussion or other (add).",
    },
    tags: { type: "string", description: "Comma-separated tags (add, memorise, recall)." },
    topic: { type: "string", description: "Snapshot topic (memorise)." },
    done: { type: "string", description: "Snapshot: what is done (memorise)." },
    doing: { type: "string", description: "Snapshot: what is in progress (memorise)." },
    next: { type: "string", description: "Snapshot: what comes next (memorise)." },
    id: { type: "string", description: "Memory id (forget)." },
    action: {
      type: "string",
      description:
        "list, status, create, use, archive, unarchive, preview, copy, link or unlink (space). Default list.",
    },
    name: {
      type: "string",
      description:
        "Space name or id: the space acted on, the transfer source or the link target (space).",
    },
    to: { type: "string", description: "Target space of the transfer (space: preview, copy)." },
    since: {
      type: "string",
      description: "ISO 8601 inclusive lower bound on the creation time (space: preview, copy).",
    },
    until: {
      type: "string",
      description: "ISO 8601 inclusive upper bound on the creation time (space: preview, copy).",
    },
    project: {
      type: "string",
      description:
        "Only memories with this project tag, as a preview's groups show it (space: preview, copy).",
    },
    in: {
      type: "string",
      description: "Space that owns the link; the active space when omitted (space: link, unlink).",
    },
    limit: { type: "number", description: "Most results to return (search, list)." },
    scope: {
      type: "string",
      enum: ["project", "all-projects"],
      description: "Where to search (search, list).",
    },
  },
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * The `memory <mode> ...` arguments for one tool call, or the reason the call is refused.
 * `sessionId` is the Claude Code session ID, passed on as `--session-id` for `memorise`.
 */
export function memoryArgs(input, sessionId) {
  const mode = text(input.mode) || "search";
  if (!MODES.includes(mode)) {
    return { error: `Unknown mode "${mode}". Use one of: ${MODES.join(", ")}.` };
  }
  const args = ["memory", mode];
  const flag = (name, value) => {
    if (value) args.push(`--${name}`, value);
  };

  if (mode === "search" || mode === "recall") {
    const query = text(input.query);
    const labels = mode === "recall" ? text(input.tags) : "";
    if (!query && !labels) {
      return {
        error: mode === "recall" ? "recall needs a query or tags." : "search needs a query.",
      };
    }
    flag("query", query);
    flag("tags", labels);
  }
  if (MEMORISE_MODES.includes(mode)) {
    for (const name of ["content", "topic", "done", "doing", "next", "tags"]) {
      flag(name, text(input[name]));
    }
    flag("session-id", text(sessionId));
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
  if (mode === "space") {
    const to = text(input.to);
    const since = text(input.since);
    const until = text(input.until);
    const project = text(input.project);
    const owner = text(input.in);
    if (to || since || until || project || owner) {
      // The transfer flags exist only on the `space` command, whose parser knows
      // them, so this call runs that command directly instead of `memory space`.
      // The shared operation still refuses move, export and import.
      args.length = 0;
      args.push("space");
      const action = text(input.action);
      if (action) args.push(action);
      const name = text(input.name);
      if (name) args.push(name);
      flag("to", to);
      flag("since", since);
      flag("until", until);
      flag("project", project);
      flag("in", owner);
    } else {
      flag("action", text(input.action));
      flag("name", text(input.name));
    }
  }
  if (mode === "search" || mode === "recall" || mode === "list") {
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

/**
 * The Claude Code session ID, or undefined. An older Claude Code has no `$.session.id`
 * (calling it throws a TypeError) and the call can also reject. Without a session ID,
 * `memorise` still saves. It just cannot replace an earlier snapshot.
 */
async function readSessionId($) {
  try {
    return await $.session.id();
  } catch {
    return undefined;
  }
}

export const registerMemoryTool = (on) => {
  on("tool.call", async ($, e, next) => {
    if (String(e.tool) !== FULL_NAME) return next(e);
    try {
      const sessionId = MEMORISE_MODES.includes(text(e.mode)) ? await readSessionId($) : undefined;
      const parsed = memoryArgs(e, sessionId);
      if ("error" in parsed) return { deny: parsed.error };
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
