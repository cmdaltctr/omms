import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidLabelOutcome,
  routeLabelAssignment,
  type LabelAssignmentMatch,
  type ReviewedLabelAssignment,
} from "../src/core/label-assignment.js";
import { parseResolveLabelAssignmentPath } from "../src/services/api-handlers.js";

function reviewed(overrides: Partial<ReviewedLabelAssignment> = {}): ReviewedLabelAssignment {
  return {
    id: 1,
    observationText: "Likes automated release flows.",
    section: "preferences",
    outcome: { kind: "label", labelId: "preference_release_workflow" },
    reviewer: "operator",
    resolvedAt: 1000,
    ...overrides,
  };
}

describe("routeLabelAssignment", () => {
  test("first assignment routes to review", () => {
    expect(routeLabelAssignment([])).toEqual({ action: "review", reason: "first-assignment" });
  });

  test("a reviewed duplicate reuses its outcome automatically", () => {
    const matches: LabelAssignmentMatch[] = [{ kind: "duplicate", assignment: reviewed() }];
    expect(routeLabelAssignment(matches)).toEqual({
      action: "auto-reuse",
      reason: "reviewed-duplicate",
      outcome: { kind: "label", labelId: "preference_release_workflow" },
    });
  });

  test("a reviewed none_fit duplicate is reused as none_fit", () => {
    const matches: LabelAssignmentMatch[] = [
      { kind: "duplicate", assignment: reviewed({ outcome: { kind: "none_fit" } }) },
    ];
    expect(routeLabelAssignment(matches)).toEqual({
      action: "auto-reuse",
      reason: "reviewed-duplicate",
      outcome: { kind: "none_fit" },
    });
  });

  test("a conflict on a would-be reuse routes back to review", () => {
    const matches: LabelAssignmentMatch[] = [
      { kind: "duplicate", assignment: reviewed() },
      {
        kind: "conflict",
        assignment: reviewed({
          id: 2,
          outcome: { kind: "label", labelId: "preference_data_preservation" },
        }),
      },
    ];
    expect(routeLabelAssignment(matches)).toEqual({ action: "review", reason: "conflict" });
  });

  test("an uncertain duplicate is never reused", () => {
    const matches: LabelAssignmentMatch[] = [
      { kind: "duplicate", assignment: reviewed({ outcome: { kind: "uncertain" } }) },
    ];
    expect(routeLabelAssignment(matches)).toEqual({
      action: "review",
      reason: "uncertain-outcome",
    });
  });
});

describe("isValidLabelOutcome", () => {
  test("accepts label, none_fit and uncertain; rejects everything else", () => {
    expect(isValidLabelOutcome({ kind: "label", labelId: "x" })).toBe(true);
    expect(isValidLabelOutcome({ kind: "none_fit" })).toBe(true);
    expect(isValidLabelOutcome({ kind: "uncertain" })).toBe(true);
    expect(isValidLabelOutcome({ kind: "label", labelId: "  " })).toBe(false);
    expect(isValidLabelOutcome({ kind: "label" })).toBe(false);
    expect(isValidLabelOutcome({ kind: "other" })).toBe(false);
    expect(isValidLabelOutcome(null)).toBe(false);
    expect(isValidLabelOutcome("label")).toBe(false);
  });
});

const storageDirs: string[] = [];

afterAll(() => {
  for (const dir of storageDirs) rmSync(dir, { recursive: true, force: true });
});

async function freshStore() {
  const storageDir = mkdtempSync(join(tmpdir(), "omms-label-assignments-"));
  storageDirs.push(storageDir);
  process.env.OMMS_STORAGE_PATH = storageDir;
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = storageDir;
  return import("../src/services/label-assignment-store.js");
}

describe("label-assignment store", () => {
  test("enqueue, resolve and list round-trip; uncertain stays pending", async () => {
    const store = await freshStore();
    const item = await store.enqueueLabelReview(
      {
        observationText: "Likes automated release flows with approval notices.",
        section: "preferences",
        suggestedLabel: "preference_release_workflow",
        source: "test",
      },
      2000
    );
    expect(item.id).toBeGreaterThan(0);
    expect(item.suggestedLabel).toBe("preference_release_workflow");

    const pending = await store.listPendingLabelAssignments();
    expect(pending).toHaveLength(1);
    expect(pending[0].observationText).toContain("automated release");

    const uncertain = await store.resolveLabelAssignment(
      item.id,
      { kind: "uncertain" },
      "operator",
      undefined,
      3000
    );
    expect(uncertain).toEqual({ resolved: false, pending: true, reviewedAt: 3000 });
    expect(await store.listPendingLabelAssignments()).toHaveLength(1);

    const resolved = await store.resolveLabelAssignment(
      item.id,
      { kind: "label", labelId: "preference_release_workflow" },
      "operator",
      "definition matched",
      4000
    );
    expect(resolved).toEqual({ resolved: true, pending: false, reviewedAt: 4000 });
    expect(await store.listPendingLabelAssignments()).toHaveLength(0);

    const reuse = await store.listReviewedForReuse("preferences");
    expect(reuse).toHaveLength(1);
    expect(reuse[0].outcome).toEqual({ kind: "label", labelId: "preference_release_workflow" });
    expect(reuse[0].reviewer).toBe("operator");
    expect(reuse[0].note).toBe("definition matched");

    const resolvedList = await store.listResolvedLabelAssignments("preferences");
    expect(resolvedList).toHaveLength(1);
    expect(await store.listResolvedLabelAssignments("patterns")).toHaveLength(0);

    await expect(
      store.resolveLabelAssignment(item.id, { kind: "none_fit" }, "operator")
    ).rejects.toThrow("already resolved");
  });

  test("none_fit outcomes are reusable; blank observations are refused", async () => {
    const store = await freshStore();
    const item = await store.enqueueLabelReview(
      {
        observationText: "Wants a stable plugin channel.",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      },
      5000
    );
    await store.resolveLabelAssignment(item.id, { kind: "none_fit" }, "operator", undefined, 6000);
    const reuse = await store.listReviewedForReuse("preferences");
    expect(reuse.some((entry) => entry.outcome.kind === "none_fit")).toBe(true);

    await expect(
      store.enqueueLabelReview({
        observationText: "   ",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      })
    ).rejects.toThrow(/observationText|Private content blocked/);
  });

  test("concurrent resolutions cannot overwrite each other", async () => {
    const store = await freshStore();
    const item = await store.enqueueLabelReview(
      {
        observationText: "Likes quick keyboard-driven review.",
        section: "preferences",
        suggestedLabel: "preference_consistent_ui",
        source: "test",
      },
      7000
    );
    const results = await Promise.allSettled([
      store.resolveLabelAssignment(
        item.id,
        { kind: "label", labelId: "a" },
        "one",
        undefined,
        7100
      ),
      store.resolveLabelAssignment(item.id, { kind: "none_fit" }, "two", undefined, 7200),
    ]);
    const succeeded = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      "assignment already resolved"
    );
    const [resolved] = await store.listResolvedLabelAssignments("preferences");
    const winner = succeeded[0] as PromiseFulfilledResult<{ resolved: boolean }>;
    expect(resolved.reviewer).toBe(winner.value.resolved ? "one" : "two");
  });

  test("private content is stripped or rejected before storage", async () => {
    const store = await freshStore();
    const partial = await store.enqueueLabelReview(
      {
        observationText:
          "Likes releases automated with <private>sk-abcdefghij01234567</private> tokens pinned.",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      },
      8000
    );
    expect(partial.observationText).not.toContain("sk-abcdefghij01234567");
    expect(partial.observationText).toContain("[REDACTED]");
    const [stored] = await store.listPendingLabelAssignments();
    expect(stored.observationText).not.toContain("<private>");

    await expect(
      store.enqueueLabelReview({
        observationText: "<private>everything hidden</private>",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      })
    ).rejects.toThrow("Private content blocked");

    const noted = await store.enqueueLabelReview(
      {
        observationText: "Wants release notes kept current.",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      },
      8100
    );
    await store.resolveLabelAssignment(
      noted.id,
      { kind: "label", labelId: "preference_result_reporting" },
      "operator",
      "note with <private>secret</private> inside",
      8200
    );
    const [resolvedRow] = await store.listResolvedLabelAssignments("preferences");
    expect(resolvedRow.note).not.toContain("secret");
  });

  test("uncertain records its review time and rotates behind untouched items", async () => {
    const store = await freshStore();
    const first = await store.enqueueLabelReview(
      {
        observationText: "First observation in the queue.",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      },
      9000
    );
    const fillerIds: number[] = [];
    for (let i = 0; i < 100; i++) {
      const filler = await store.enqueueLabelReview(
        {
          observationText: `Filler observation number ${i}.`,
          section: "preferences",
          suggestedLabel: null,
          source: "test",
        },
        9100 + i
      );
      fillerIds.push(filler.id);
    }
    const last = await store.enqueueLabelReview(
      {
        observationText: "Observation that must stay reachable.",
        section: "preferences",
        suggestedLabel: null,
        source: "test",
      },
      9300
    );

    const pending = await store.listPendingLabelAssignments();
    expect(pending).toHaveLength(100);
    const uncertainResult = await store.resolveLabelAssignment(
      first.id,
      { kind: "uncertain" },
      "operator",
      undefined,
      9400
    );
    expect(uncertainResult.pending).toBe(true);
    expect(uncertainResult.reviewedAt).toBe(9400);

    for (const item of pending.slice(1)) {
      await store.resolveLabelAssignment(
        item.id,
        { kind: "uncertain" },
        "operator",
        undefined,
        9500
      );
    }
    const after = await store.listPendingLabelAssignments();
    expect(after.slice(0, 2).map((item) => item.id)).toEqual([fillerIds[99], last.id]);
    expect(after.slice(2).every((item) => item.id !== last.id)).toBe(true);
  });

  test("label options round-trip and malformed options are dropped", async () => {
    const store = await freshStore();
    const item = await store.enqueueLabelReview(
      {
        observationText: "Wants neighbouring definitions visible while reviewing.",
        section: "preferences",
        suggestedLabel: "preference_consistent_ui",
        source: "test",
        labelOptions: [
          { labelId: "preference_consistent_ui", definition: "Follow existing UI patterns." },
          { labelId: "preference_explanatory_tooltips", definition: "Explain ambiguous controls." },
        ],
      },
      10000
    );
    expect(item.labelOptions).toHaveLength(2);
    expect(item.labelOptions[0].definition).toBe("Follow existing UI patterns.");
    const [stored] = await store.listPendingLabelAssignments();
    expect(stored.labelOptions.map((option: { labelId: string }) => option.labelId)).toEqual([
      "preference_consistent_ui",
      "preference_explanatory_tooltips",
    ]);
  });
});

describe("parseResolveLabelAssignmentPath", () => {
  test("accepts only the exact route with a positive integer id", () => {
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/12/resolve")).toBe(12);
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/1/resolve")).toBe(1);
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/1junk/resolve")).toBeNull();
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/0/resolve")).toBeNull();
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/-3/resolve")).toBeNull();
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/12/resolve/extra")).toBeNull();
    expect(parseResolveLabelAssignmentPath("/api/label-assignments/12")).toBeNull();
    expect(parseResolveLabelAssignmentPath("/api/memories/12/resolve")).toBeNull();
    expect(
      parseResolveLabelAssignmentPath(`/api/label-assignments/${"9".repeat(20)}/resolve`)
    ).toBeNull();
  });
});
