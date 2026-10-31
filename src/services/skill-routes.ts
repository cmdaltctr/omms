import { existsSync } from "node:fs";
import {
  RECORDING_OFF_TEXT,
  runSkillOperation,
  type SkillOperationArgs,
  type SkillOperationResult,
} from "../core/skill-operations.js";
import type { RouteResult } from "./chat/chat-routes.js";
import { log } from "./logger.js";
import { undoProposal } from "./skill-learning/apply.js";
import { skillOperationsDeps } from "./skill-learning/operations-deps.js";
import {
  getProposal,
  listProposals,
  setSkillMode,
  type ProposalFilter,
  type SkillProposalState,
} from "./skill-learning/proposal-store.js";
import { SKILL_ORDERS, rankSkills, type SkillOrder } from "./skill-learning/ranking.js";
import { skillTurnSettingsFor } from "./skill-learning/settings-for.js";
import { getSkillIndex, type SkillIndex } from "./skill-learning/skill-index.js";
import { SkillStore, SkillStoreError, skillsDbPath } from "./skill-learning/store.js";
import { recentSkillTurns, skillTurnsByIds } from "./skill-learning/turn-summaries.js";

/**
 * What the web server lends the skill routes: its folder, and a way to start
 * Record past turns in its own import job slot. The importer stays behind
 * web-server.ts, the one services file allowed to load it.
 */
export interface SkillRouteContext {
  cwd: string;
  startRecordPast: (cwd: string) => Promise<{ id: string }>;
}

type Body = Record<string, unknown>;

const PROPOSAL_STATES: readonly SkillProposalState[] = [
  "pending",
  "applied",
  "stale",
  "rejected",
  "undone",
];

// Codes from the skill operations, apply, undo and drafting. A code not listed is a 500.
const STATUS_BY_CODE: Record<string, number> = {
  "invalid-args": 400,
  "invalid-name": 400,
  "not-watched": 400,
  "not-skill-file": 400,
  "outside-folder": 400,
  "not-found": 404,
  "recording-off": 409,
  ambiguous: 409,
  "not-pending": 409,
  "not-applied": 409,
  "no-version": 409,
  stale: 409,
  exists: 409,
  changed: 409,
  "read-only": 409,
  "not-configured": 409,
  busy: 409,
  "import-error": 400,
  timeout: 502,
  "no-tool-call": 502,
  "invalid-reply": 502,
};

function statusFor(code: string): number {
  if (code.startsWith("http-")) return 502;
  return STATUS_BY_CODE[code] ?? 500;
}

const ok = (code: string, data: unknown, status = 200): RouteResult => ({
  status,
  body: { success: true, code, data },
});

const fail = (code: string, error: string, extra: Body = {}): RouteResult => ({
  status: statusFor(code),
  body: { success: false, code, error, ...extra },
});

function fromOperation(result: SkillOperationResult): RouteResult {
  if (!result.success) return fail(result.code, result.text);
  return {
    status: 200,
    body: { success: true, code: result.code, message: result.text, data: result.data ?? {} },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function folderCounts(index: SkillIndex, exists: (folder: string) => boolean) {
  return index.folders.map((folder) => ({
    path: folder,
    skills: index.entries.filter((e) => e.folder === folder).length,
    exists: exists(folder),
  }));
}

/**
 * The Skills page routes under `/api/skills`. Returns undefined for any other
 * path. The web server applies the origin, token and JSON checks before this.
 * Reads never create `skills.db`; a write opens it with `init` first.
 */
export async function routeSkills(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<Body>,
  ctx: SkillRouteContext
): Promise<RouteResult | undefined> {
  if (path !== "/api/skills" && !path.startsWith("/api/skills/")) return undefined;
  try {
    return await dispatch(path, method, url, readBody, ctx);
  } catch (error) {
    if (error instanceof SkillStoreError) return fail("read-only", error.message);
    log(
      "skills route: error",
      {
        path: path.replace(/\/[^/]{16,}$/, "/:id"),
        method,
        code: (error as { code?: string } | null)?.code ?? "error",
        name: error instanceof Error ? error.name : typeof error,
      },
      "error"
    );
    return fail("error", "Skills request failed");
  }
}

async function dispatch(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<Body>,
  ctx: SkillRouteContext
): Promise<RouteResult | undefined> {
  const settings = skillTurnSettingsFor(ctx.cwd);
  const store = new SkillStore(skillsDbPath(settings.storagePath));
  const now = Date.now();
  const index = () => getSkillIndex(settings.folders, now);

  if (method === "GET") {
    if (path === "/api/skills") {
      const order = (url.searchParams.get("order") ?? "uses") as SkillOrder;
      if (!SKILL_ORDERS.includes(order)) {
        return fail("invalid-args", `order must be one of: ${SKILL_ORDERS.join(", ")}`);
      }
      const current = index();
      return ok("ok", {
        recording: settings.enabled,
        skills: await rankSkills(store, current, now, order),
        folders: folderCounts(current, existsSync),
      });
    }
    if (path === "/api/skills/folders") {
      return ok("ok", { folders: folderCounts(index(), existsSync) });
    }
    if (path === "/api/skills/stats") {
      return ok("ok", {
        turns: await store.countTurns(),
        fileSize: store.fileSize(),
        recording: settings.enabled,
        redact: settings.redact,
      });
    }
    if (path === "/api/skills/skill") return showSkill(url, store, index(), now);
    if (path === "/api/skills/proposals") return proposals(url, store);
    const one = /^\/api\/skills\/proposals\/([^/]+)$/.exec(path);
    if (one) {
      const proposal = await getProposal(store, decodeURIComponent(one[1]!));
      if (!proposal) return fail("not-found", "No such proposal");
      return ok("ok", {
        proposal,
        evidence: await skillTurnsByIds(store, proposal.evidenceTurnIds),
      });
    }
    return undefined;
  }

  if (method !== "POST") return undefined;
  const operation = (mode: string, args: SkillOperationArgs) =>
    runSkillOperation(mode, args, skillOperationsDeps(ctx.cwd, "person")).then(fromOperation);

  switch (path) {
    case "/api/skills/draft": {
      const body = await readBody();
      const idea = body.idea && typeof body.idea === "object" ? (body.idea as Body) : undefined;
      return operation("draft", {
        skill: text(body.skill),
        ...(idea ? { idea: idea as SkillOperationArgs["idea"], folder: text(body.folder) } : {}),
      });
    }
    case "/api/skills/ideas":
      return operation("ideas", {});
    case "/api/skills/apply":
      return operation("apply", { id: text((await readBody()).id) });
    case "/api/skills/reject":
      return operation("reject", { id: text((await readBody()).id) });
    case "/api/skills/undo":
      return undo(text((await readBody()).id), store, settings.folders);
    case "/api/skills/mode":
      return setMode(await readBody(), store, index());
    case "/api/skills/delete-turns":
      return deleteTurns(await readBody(), store);
    case "/api/skills/record-past":
      return recordPast(settings.enabled, ctx);
  }
  return undefined;
}

async function showSkill(url: URL, store: SkillStore, index: SkillIndex, now: number) {
  const path = text(url.searchParams.get("path"));
  const name = text(url.searchParams.get("name"));
  if (!path && !name) return fail("invalid-args", "Give path or name");
  const skill = (await rankSkills(store, index, now)).find((s) =>
    path ? s.path === path : s.path === null && s.name === name
  );
  if (!skill) return fail("not-found", "No such skill");
  return ok("ok", {
    skill,
    recentTurns: await recentSkillTurns(store, skill, index),
    proposals: skill.path ? await listProposals(store, { skillPath: skill.path }) : [],
  });
}

async function proposals(url: URL, store: SkillStore) {
  const state = text(url.searchParams.get("state"));
  const skill = text(url.searchParams.get("skill"));
  if (state && !PROPOSAL_STATES.includes(state as SkillProposalState)) {
    return fail("invalid-args", `state must be one of: ${PROPOSAL_STATES.join(", ")}`);
  }
  const filter: ProposalFilter = {};
  if (state) filter.state = state as SkillProposalState;
  // A path names one file; a bare name matches every skill with that name.
  if (skill && /[/\\]/.test(skill)) filter.skillPath = skill;
  else if (skill) filter.skillName = skill;
  return ok("ok", { proposals: await listProposals(store, filter) });
}

async function undo(id: string | undefined, store: SkillStore, folders: readonly string[]) {
  if (!id) return fail("invalid-args", "Give the proposal id");
  if (!(await store.existingDb())) return fail("not-found", `No proposal ${id}`);
  await store.init();
  const result = await undoProposal(id, { store, folders });
  if (!result.ok) {
    // Undo refuses a file changed by hand and shows what it would have restored.
    const extra = result.code === "changed" ? { savedContent: result.savedContent ?? null } : {};
    return fail(result.code, result.message, extra);
  }
  return ok("undone", { proposal: result.proposal, path: result.path });
}

async function setMode(body: Body, store: SkillStore, index: SkillIndex) {
  const skillPath = text(body.skillPath);
  if (!skillPath || (body.mode !== "manual" && body.mode !== "automatic")) {
    return fail("invalid-args", "Give skillPath and mode manual or automatic");
  }
  if (!index.entries.some((e) => e.path === skillPath)) {
    return fail("not-found", "No watched skill has this path");
  }
  await store.init();
  await setSkillMode(store, skillPath, body.mode);
  return ok("ok", { skillPath, mode: body.mode });
}

async function deleteTurns(body: Body, store: SkillStore) {
  if (body.confirm !== true) return fail("invalid-args", "Send confirm: true to delete every turn");
  // No file means nothing to delete; init would create one.
  if (!(await store.existingDb())) return ok("ok", { deleted: 0 });
  await store.init();
  return ok("ok", { deleted: await store.deleteAllTurns() });
}

async function recordPast(enabled: boolean, ctx: SkillRouteContext) {
  if (!enabled) return fail("recording-off", RECORDING_OFF_TEXT);
  try {
    const job = await ctx.startRecordPast(ctx.cwd);
    return ok("started", { id: job.id, job }, 202);
  } catch (error) {
    // Import errors carry their own status, like the import start route.
    const status = (error as { status?: unknown }).status;
    const message = error instanceof Error ? error.message : "Record past turns failed";
    return fail(status === 409 ? "busy" : "import-error", message);
  }
}
