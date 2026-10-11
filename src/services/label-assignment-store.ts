import { join } from "node:path";
import { CONFIG } from "../config.js";
import {
  isValidLabelOutcome,
  type LabelAssignmentProposal,
  type LabelOutcome,
} from "../core/label-assignment.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";

/**
 * Storage for review-gated label assignments (spec: label-assignment-review).
 * Pending items carry the producer's suggestion; a human resolution stores the
 * outcome, reviewer and timestamp. `uncertain` keeps the item pending but
 * records the review time so it rotates to the back of the queue.
 */

export interface LabelOption {
  labelId: string;
  definition: string;
}

export interface PendingLabelAssignment {
  id: number;
  createdAt: number;
  section: string;
  observationText: string;
  suggestedLabel: string | null;
  source: string;
  labelOptions: LabelOption[];
}

export interface ResolvedLabelAssignment extends PendingLabelAssignment {
  outcome: LabelOutcome;
  reviewer: string;
  resolvedAt: number;
  note: string | null;
}

const prepared = new Set<string>();
const preparing = new Map<string, Promise<void>>();

async function database() {
  const path = join(CONFIG.storagePath, "user-prompts.db");
  const db = await tursoConnectionManager.getConnection(path);
  if (!prepared.has(path)) {
    let pending = preparing.get(path);
    if (!pending) {
      pending = db
        .batch([
          {
            sql: `CREATE TABLE IF NOT EXISTS label_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          section TEXT NOT NULL,
          observation_text TEXT NOT NULL,
          suggested_label TEXT,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          outcome_kind TEXT,
          outcome_label TEXT,
          reviewer TEXT,
          resolved_at INTEGER,
          note TEXT,
          label_options TEXT
        )`,
          },
          {
            sql: "CREATE INDEX IF NOT EXISTS idx_label_assignments_status ON label_assignments(status, created_at)",
          },
          {
            sql: "CREATE INDEX IF NOT EXISTS idx_label_assignments_section ON label_assignments(section, status)",
          },
        ])
        .then(async () => {
          // CREATE IF NOT EXISTS cannot add a column to an older table.
          await db
            .execute("ALTER TABLE label_assignments ADD COLUMN label_options TEXT")
            .catch((error) => {
              if (!String(error).includes("duplicate column")) throw error;
            });
        })
        .finally(() => {
          preparing.delete(path);
        });
      preparing.set(path, pending);
    }
    await pending;
  }
  return db;
}

function sanitiseText(value: string): string {
  return stripPrivateContent(value).trim();
}

function parseLabelOptions(raw: unknown): LabelOption[] {
  if (raw === null || raw === undefined) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { labelId: string; definition: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { labelId?: unknown }).labelId === "string" &&
          typeof (item as { definition?: unknown }).definition === "string"
      )
      .slice(0, 64)
      .map((item) => ({
        labelId: item.labelId.slice(0, 200),
        definition: item.definition.slice(0, 1000),
      }));
  } catch {
    return [];
  }
}

function pendingFromRow(row: Record<string, unknown>): PendingLabelAssignment {
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    section: String(row.section),
    observationText: String(row.observation_text),
    suggestedLabel: row.suggested_label === null ? null : String(row.suggested_label),
    source: String(row.source),
    labelOptions: parseLabelOptions(row.label_options),
  };
}

function outcomeFromRow(row: Record<string, unknown>): LabelOutcome {
  if (row.outcome_kind === "none_fit") return { kind: "none_fit" };
  return { kind: "label", labelId: String(row.outcome_label) };
}

/** Queue a first assignment for review. The suggestion is never the outcome. */
export async function enqueueLabelReview(
  proposal: LabelAssignmentProposal,
  now = Date.now()
): Promise<PendingLabelAssignment> {
  if (isFullyPrivate(proposal.observationText)) {
    throw new Error("Private content blocked");
  }
  const observationText = sanitiseText(proposal.observationText);
  if (!observationText) throw new Error("observationText must not be blank");
  if (!proposal.section.trim()) throw new Error("section must not be blank");
  if (proposal.suggestedLabel !== null && proposal.suggestedLabel.length > 200) {
    throw new Error("suggestedLabel too long");
  }
  const labelOptions = (proposal.labelOptions ?? [])
    .slice(0, 64)
    .map((option) => ({
      labelId: sanitiseText(option.labelId).slice(0, 200),
      definition: sanitiseText(option.definition).slice(0, 1000),
    }))
    .filter((option) => option.labelId);
  const db = await database();
  const result = await db.execute(
    `INSERT INTO label_assignments
    (created_at, section, observation_text, suggested_label, source, status, label_options)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      now,
      proposal.section,
      observationText,
      proposal.suggestedLabel,
      proposal.source,
      JSON.stringify(labelOptions),
    ]
  );
  return {
    id: Number(result.lastInsertRowid),
    createdAt: now,
    section: proposal.section,
    observationText,
    suggestedLabel: proposal.suggestedLabel,
    source: proposal.source,
    labelOptions,
  };
}

/**
 * Resolve a pending item. `label` and `none_fit` outcomes close the item;
 * `uncertain` records reviewer and review time but keeps it pending. The
 * update is conditional on the row still being pending, so a concurrent
 * resolution cannot overwrite an earlier decision.
 */
export async function resolveLabelAssignment(
  id: number,
  outcome: LabelOutcome,
  reviewer: string,
  note?: string,
  now = Date.now()
): Promise<{ resolved: boolean; pending: boolean; reviewedAt: number }> {
  if (!isValidLabelOutcome(outcome)) throw new Error("invalid outcome");
  if (!reviewer.trim()) throw new Error("reviewer must not be blank");
  const db = await database();
  const keepsPending = outcome.kind === "uncertain";
  const cleanedNote = note === undefined ? null : sanitiseText(note).slice(0, 500) || null;
  const changed = await db.run(
    `UPDATE label_assignments
     SET status = ?, outcome_kind = ?, outcome_label = ?, reviewer = ?, resolved_at = ?, note = ?
     WHERE id = ? AND status = 'pending'`,
    [
      keepsPending ? "pending" : "resolved",
      outcome.kind,
      outcome.kind === "label" ? outcome.labelId : null,
      reviewer,
      now,
      cleanedNote,
      id,
    ]
  );
  if (changed === 0) {
    const current = await db.get("SELECT 1 FROM label_assignments WHERE id = ?", [id]);
    if (!current) throw new Error("assignment not found");
    throw new Error("assignment already resolved");
  }
  return keepsPending
    ? { resolved: false, pending: true, reviewedAt: now }
    : { resolved: true, pending: false, reviewedAt: now };
}

/**
 * Pending queue, least recently reviewed first: untouched items keep their
 * creation order at the front, an `uncertain` pass pushes an item behind them.
 * Without this, a block of uncertain items at the head starves later reviews.
 */
export async function listPendingLabelAssignments(limit = 100): Promise<PendingLabelAssignment[]> {
  const db = await database();
  const rows = await db.all(
    `SELECT * FROM label_assignments WHERE status = 'pending'
     ORDER BY COALESCE(resolved_at, created_at) ASC, id ASC LIMIT ?`,
    [limit]
  );
  return rows.map(pendingFromRow);
}

export async function listResolvedLabelAssignments(
  section?: string,
  limit = 100
): Promise<ResolvedLabelAssignment[]> {
  const db = await database();
  const rows = section
    ? await db.all(
        "SELECT * FROM label_assignments WHERE status = 'resolved' AND section = ? ORDER BY resolved_at DESC LIMIT ?",
        [section, limit]
      )
    : await db.all(
        "SELECT * FROM label_assignments WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT ?",
        [limit]
      );
  return rows.map((row) => ({
    ...pendingFromRow(row),
    outcome: outcomeFromRow(row),
    reviewer: String(row.reviewer ?? ""),
    resolvedAt: Number(row.resolved_at ?? 0),
    note: row.note === null ? null : String(row.note),
  }));
}

/** Reviewed assignments a producer may reuse: label and none_fit outcomes. */
export async function listReviewedForReuse(section: string): Promise<ResolvedLabelAssignment[]> {
  const db = await database();
  const rows = await db.all(
    `SELECT * FROM label_assignments
     WHERE status = 'resolved' AND section = ? AND outcome_kind IN ('label', 'none_fit')
     ORDER BY resolved_at DESC`,
    [section]
  );
  return rows.map((row) => ({
    ...pendingFromRow(row),
    outcome: outcomeFromRow(row),
    reviewer: String(row.reviewer ?? ""),
    resolvedAt: Number(row.resolved_at ?? 0),
    note: row.note === null ? null : String(row.note),
  }));
}
