// The `skills` tool for Claude Code, which Claude sees as `mcp__omms__skills`.
// Pi and OpenCode ship a `skills` tool beside `memory`. This tool runs
// `om-memory-system skills <mode> --json` through the plugin's launcher, the
// same way `omms-memory-tool.jsx` runs `memory`. Apply passes the hidden
// `--applied-by agent`, so the command records `agent` as the Pi and OpenCode
// tools do. Propose sends the new SKILL.md on standard input (`--content-file -`).
// The tool is registered from the plugin's one `session.start` hook, in `omms.jsx`.

export const TOOL = "skills";
const FULL_NAME = `mcp__omms__${TOOL}`;
// A first `npx` download can take longer than the 30 second default.
const LAUNCHER_TIMEOUT_MS = 60_000;
// `ideas` and `draft` also wait up to two minutes for the model (SKILL_MODEL_TIMEOUT_MS).
const MODEL_MODES = ["ideas", "draft"];
const MODEL_TIMEOUT_MS = LAUNCHER_TIMEOUT_MS + 120_000;
const REASON_LIMIT = 500;

// `record-past` and `delete-turns` are left out on purpose: they read every
// host's history or delete every recorded turn. The user runs them in a terminal.
const MODES = [
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
];

export const DESCRIPTION = [
  "Lists this project's skills ranked by use, drafts improvements as reviewable proposals, and applies a proposal only when the user asks. Use this tool instead of running `om-memory-system skills` through Bash; it runs the same command.",
  'mode "list": skills ranked by use in the last 30 days. "ideas": up to three new skill ideas from recorded turns.',
  '"draft" (skill, or an idea from "ideas" {name, description, reason, evidenceTurnIds} with folder): the external API drafts a pending proposal; it changes no file.',
  'To fix a skill yourself: call "evidence" (skill, limit) for its SKILL.md and recorded turns, write the fixed SKILL.md, then call "propose" (skill, or idea with folder; content, summary, evidence turn ids). Show the user the diff.',
  "This path makes no external API call, but the recorded turn text enters this session.",
  '"proposals" (state), "show" (id): review proposals and their diffs.',
  '"apply" (id): write a pending proposal to its SKILL.md, only when the user asks. "reject" (id), "undo" (id), "help".',
].join(" ");

export const INPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: MODES, description: 'Which operation to run. Default "help".' },
    skill: {
      type: "string",
      description: "Skill name, or the full path of its SKILL.md (draft).",
    },
    idea: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        reason: { type: "string" },
        evidenceTurnIds: { type: "array", items: { type: "number" } },
      },
      description: 'A new skill idea from "ideas", passed as returned (draft). Needs folder.',
    },
    folder: { type: "string", description: "Watched folder for a new skill (draft)." },
    state: {
      type: "string",
      enum: ["pending", "applied", "stale", "rejected", "undone"],
      description: "Only proposals in this state (proposals).",
    },
    order: {
      type: "string",
      enum: ["uses", "attention"],
      description: "Sort order: most used (default) or needs attention (list).",
    },
    id: { type: "string", description: "Proposal id (show, apply, reject, undo)." },
    limit: {
      type: "number",
      description: "Recorded turns to return, 1 to 20; default 10 (evidence).",
    },
    content: {
      type: "string",
      description: "The full new SKILL.md, front matter included (propose).",
    },
    summary: { type: "string", description: "What changed and why (propose)." },
    evidence: {
      type: "array",
      items: { type: "number" },
      description: "Ids of the recorded turns that show the need (propose).",
    },
  },
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** The `skills <mode> ...` arguments for one tool call, or the reason the call is refused. */
function skillsArgs(input) {
  const mode = text(input.mode) || "help";
  if (!MODES.includes(mode)) {
    return { error: `Unknown mode "${mode}". Use one of: ${MODES.join(", ")}.` };
  }
  const args = ["skills", mode];
  const flag = (name, value) => {
    if (value) args.push(`--${name}`, value);
  };

  let stdin;
  if (mode === "propose") {
    if (typeof input.content !== "string" || !input.content) {
      return { error: "propose needs content." };
    }
    stdin = input.content;
  }
  if (mode === "draft" || mode === "propose") {
    const idea = input.idea && typeof input.idea === "object" ? input.idea : null;
    const skill = text(input.skill);
    if (!skill && !idea) return { error: `${mode} needs a skill or an idea.` };
    flag("skill", skill);
    if (idea) {
      flag("idea-name", text(idea.name));
      flag("idea-description", text(idea.description));
      flag("idea-reason", text(idea.reason));
      if (Array.isArray(idea.evidenceTurnIds))
        flag("idea-evidence", idea.evidenceTurnIds.join(","));
      flag("folder", text(input.folder));
    }
  }
  if (mode === "evidence") {
    const skill = text(input.skill);
    if (!skill) return { error: "evidence needs a skill." };
    flag("skill", skill);
    if (input.limit !== undefined) flag("limit", String(input.limit));
  }
  if (mode === "propose") {
    flag("summary", text(input.summary));
    const ids = Array.isArray(input.evidence)
      ? input.evidence.map((id) => String(id).replace(/^\s*T/i, "").trim()).filter(Boolean)
      : [];
    if (ids.length > 0) flag("evidence", ids.join(","));
    args.push("--content-file", "-");
  }
  if (mode === "list") flag("order", text(input.order));
  if (mode === "proposals") flag("state", text(input.state));
  if (["show", "apply", "reject", "undo"].includes(mode)) {
    const id = text(input.id);
    if (!id) return { error: `${mode} needs an id.` };
    flag("id", id);
  }
  // The agent applied it, so the command records agent, as on Pi and OpenCode.
  if (mode === "apply") args.push("--applied-by", "agent");
  args.push("--json");
  const timeoutMs = MODEL_MODES.includes(mode) ? MODEL_TIMEOUT_MS : LAUNCHER_TIMEOUT_MS;
  return { args, timeoutMs, stdin };
}

const failed = (reason) => ({ deny: `skills failed: ${reason.slice(0, REASON_LIMIT)}` });

/** What Claude reads: the command's JSON on success, the reply text otherwise. */
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
    (typeof reply?.text === "string" && reply.text) ||
    run.stderr.trim() ||
    out ||
    `exit code ${run.exitCode}`;
  return failed(reason);
}

export const registerSkillsTool = (on) => {
  // A matcher: Claude Code allows one unmatched `tool.call` hook per plugin, and the memory tool has it.
  on("tool.call", { tool: FULL_NAME }, async ($, e) => {
    const parsed = skillsArgs(e);
    if ("error" in parsed) return { deny: parsed.error };
    try {
      const cwd = await $.session.cwd();
      // The launcher's npx fallback runs from the temp folder, so name the project.
      const run = await $.process.run(
        [
          "node",
          `${$.plugin.root}/bin/omms-launch.mjs`,
          "--at-least-own-version",
          ...parsed.args,
          "--directory",
          cwd,
        ],
        {
          cwd,
          timeoutMs: parsed.timeoutMs,
          ...(parsed.stdin === undefined ? {} : { stdin: parsed.stdin }),
        }
      );
      return readOutcome(run);
    } catch (error) {
      // Node.js is missing, or the run passed the time limit.
      return failed(error instanceof Error ? error.message : String(error));
    }
  });
};
