import { randomUUID } from "node:crypto";
import { skillDraftBackoff } from "../../core/profile-backoff.js";
import { log } from "../logger.js";
import { TableLease } from "../turso/table-lease.js";
import { applyProposal } from "./apply.js";
import { countSkillUses, skillRef } from "./draft-turns.js";
import { draftImprovement, type DraftDeps } from "./drafting.js";
import { setSkillReview } from "./proposal-store.js";
import type { SkillStore } from "./store.js";

/** A skill in automatic mode is reviewed after this many new uses... */
export const AUTO_REVIEW_MIN_USES = 10;
/** ...and at least this long after its last review. */
export const AUTO_REVIEW_MIN_GAP_MS = 24 * 3_600_000;
/** The web app checks for due skills this often. */
export const AUTO_REVIEW_INTERVAL_MS = 10 * 60_000;
export const SKILL_REVIEW_LEASE_TABLE = "skill_review_lease";

/** The review run record in `skills.db`, shared by every process. */
export function skillReviewLease(store: SkillStore, now?: () => number): TableLease {
  return new TableLease({ table: SKILL_REVIEW_LEASE_TABLE, connection: () => store.db(), now });
}

export interface AutoReviewDeps extends Omit<DraftDeps, "now"> {
  /** The watched skill folders, for the apply checks. */
  folders: readonly string[];
  lease: TableLease;
}

export interface AutoReviewReport {
  /** Why the run stopped before or between reviews. */
  skipped?: "not-configured" | "backoff" | "busy" | "superseded";
  /** One entry for each skill reviewed: `applied`, `no-change`, `stale` or a failure code. */
  reviews: Array<{ skillPath: string; code: string }>;
}

interface DueSkill {
  path: string;
  uses: number;
}

/** Automatic skills with 10 new uses and 24 hours since their last review. Reads only. */
async function dueSkills(deps: AutoReviewDeps, now: number): Promise<DueSkill[]> {
  const db = await deps.store.existingDb();
  if (!db) return [];
  const rows = await db.all(
    `SELECT skill_path, last_review_at, uses_at_last_review FROM skill_settings
     WHERE mode = 'automatic' ORDER BY skill_path`
  );
  const due: DueSkill[] = [];
  for (const row of rows) {
    // A skill no watched folder holds now gets no draft.
    const ref = skillRef(deps.index, String(row.skill_path));
    if (!ref) continue;
    const last = row.last_review_at == null ? null : Number(row.last_review_at);
    if (last !== null && now - last < AUTO_REVIEW_MIN_GAP_MS) continue;
    const uses = await countSkillUses(db, ref);
    if (uses - Number(row.uses_at_last_review ?? 0) < AUTO_REVIEW_MIN_USES) continue;
    due.push({ path: ref.path, uses });
  }
  return due;
}

async function reviewSkill(deps: AutoReviewDeps, skill: DueSkill, now: () => number) {
  const draft = await draftImprovement(skill.path, { ...deps, now });
  // A failed draft is not a review, so the skill is tried again after the wait.
  if (!draft.ok) return draft.code;
  let code: string = draft.code;
  if (draft.code === "proposed") {
    // A file changed since the draft makes the proposal stale and stays as it is.
    const applied = await applyProposal(draft.proposal.id, "automatic", {
      store: deps.store,
      folders: deps.folders,
      now,
    });
    code = applied.code;
  }
  await setSkillReview(deps.store, skill.path, now(), skill.uses);
  return code;
}

/**
 * One automatic review pass (design §6). Drafts and applies an improvement
 * for each due skill in automatic mode. Starts no draft during the skill
 * draft wait, and runs only while it holds the `skill_review_lease`, so one
 * review runs at a time across processes.
 */
export async function runAutoReview(deps: AutoReviewDeps, now: number): Promise<AutoReviewReport> {
  const reviews: AutoReviewReport["reviews"] = [];
  const backoff = deps.backoff ?? skillDraftBackoff;
  if (!deps.model.ready) return { skipped: "not-configured", reviews };
  if (!backoff.canRun(now)) return { skipped: "backoff", reviews };
  const due = await dueSkills(deps, now);
  if (due.length === 0) return { reviews };
  if (await deps.lease.isActive()) return { skipped: "busy", reviews };
  const owner = randomUUID();
  await deps.lease.take(owner);
  try {
    for (const skill of due) {
      if (!backoff.canRun(now)) return { skipped: "backoff", reviews };
      if ((await deps.lease.beginBatch(owner)) !== "ok") return { skipped: "superseded", reviews };
      try {
        reviews.push({ skillPath: skill.path, code: await reviewSkill(deps, skill, () => now) });
      } finally {
        await deps.lease.endBatch(owner);
      }
    }
    return { reviews };
  } finally {
    await deps.lease.release(owner);
  }
}

/**
 * Runs `runAutoReview` every 10 minutes. `makeDeps` returns null while skill
 * learning is off, and the tick then does nothing. A tick never overlaps the
 * one before it. The timer does not keep the process alive. Returns a stop
 * function.
 */
export function startAutoReviewLoop(
  makeDeps: () => Promise<AutoReviewDeps | null>,
  intervalMs = AUTO_REVIEW_INTERVAL_MS
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const deps = await makeDeps();
      if (!deps) return;
      const report = await runAutoReview(deps, Date.now());
      if (report.reviews.length > 0) {
        log("Skill automatic review finished", { codes: report.reviews.map((r) => r.code) });
      }
    } catch (error) {
      // The name only: a message can hold a path or provider text.
      log("Skill automatic review failed", { error: (error as Error)?.name ?? "error" }, "error");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
