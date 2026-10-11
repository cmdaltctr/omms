/**
 * Review-gated label assignment for the shared memory core.
 *
 * Experiment evidence (Experiments 05, 06, 09 and 10, 2026-10-10/11): automatic
 * first-assignment label reuse sits near 59% wrong reuse against a 2% bar, and
 * no verifier class closed that gap. The rule here is therefore structural:
 * only assignments a human reviewed are reused automatically, and every first
 * assignment routes to review with the classifier's suggestion attached.
 */

/** Outcome a reviewer can attach to a pending assignment. */
export type LabelOutcome =
  { kind: "label"; labelId: string } | { kind: "none_fit" } | { kind: "uncertain" };

export function isValidLabelOutcome(value: unknown): value is LabelOutcome {
  if (typeof value !== "object" || value === null) return false;
  const outcome = value as { kind?: unknown; labelId?: unknown };
  if (outcome.kind === "none_fit" || outcome.kind === "uncertain") return true;
  return (
    outcome.kind === "label" &&
    typeof outcome.labelId === "string" &&
    outcome.labelId.trim().length > 0 &&
    outcome.labelId.length <= 200
  );
}

/** A producer's proposal: an observation that wants a label. */
export interface LabelAssignmentProposal {
  observationText: string;
  section: string;
  suggestedLabel: string | null;
  source: string;
  /**
   * Optional decision context for the reviewer: the candidate labels with
   * their definitions, as the review-first proposal requires the queue to
   * show neighbouring definitions beside the suggestion.
   */
  labelOptions?: Array<{ labelId: string; definition: string }>;
}

/** A stored assignment with a human outcome behind it. */
export interface ReviewedLabelAssignment {
  id: number;
  observationText: string;
  section: string;
  outcome: LabelOutcome;
  reviewer: string;
  resolvedAt: number;
}

/**
 * What the duplicate and conflict checks found for one proposal. The producer
 * (embedding match, dedup service, importer) supplies these; this module never
 * calls a model.
 */
export interface LabelAssignmentMatch {
  kind: "duplicate" | "conflict";
  assignment: ReviewedLabelAssignment;
}

export type RoutingDecision =
  | { action: "auto-reuse"; reason: "reviewed-duplicate"; outcome: LabelOutcome }
  | {
      action: "review";
      reason: "first-assignment" | "conflict" | "duplicate-pending" | "uncertain-outcome";
    };

/**
 * Routing rule (spec: label-assignment-review). Checks run in order:
 * conflict first (a would-be reuse that conflicts goes back to review), then
 * reviewed duplicates (reuse label and none_fit outcomes automatically), then
 * first assignment.
 */
export function routeLabelAssignment(matches: LabelAssignmentMatch[]): RoutingDecision {
  if (matches.some((match) => match.kind === "conflict")) {
    return { action: "review", reason: "conflict" };
  }
  const duplicates = matches.filter((match) => match.kind === "duplicate");
  for (const match of duplicates) {
    if (match.assignment.outcome.kind === "label" || match.assignment.outcome.kind === "none_fit") {
      return {
        action: "auto-reuse",
        reason: "reviewed-duplicate",
        outcome: match.assignment.outcome,
      };
    }
  }
  if (duplicates.length > 0) {
    return { action: "review", reason: "uncertain-outcome" };
  }
  return { action: "review", reason: "first-assignment" };
}
