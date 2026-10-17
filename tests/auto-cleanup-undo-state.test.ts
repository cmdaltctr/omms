import { describe, expect, it } from "bun:test";
import {
  confirmationParams,
  nextUndoPhase,
  shouldCallUndo,
  showUndoButton,
  undoMessage,
  type AutoCleanupRecord,
} from "../web/src/lib/components/explorer/auto-cleanup-undo-state.js";

const record: AutoCleanupRecord = { id: 7, createdAt: 1_700_000_000_000, merged: 4, removed: 3 };

describe("showUndoButton", () => {
  it("shows the button only while a record exists", () => {
    expect(showUndoButton(record)).toBe(true);
    expect(showUndoButton(null)).toBe(false);
  });
});

describe("confirmationParams", () => {
  it("gives the time of the run and how many items it merged and removed", () => {
    expect(confirmationParams(record)).toEqual({
      createdAt: 1_700_000_000_000,
      merged: 4,
      removed: 3,
    });
  });
});

describe("nextUndoPhase", () => {
  it("opens a confirmation, and cancel goes back without undoing", () => {
    expect(nextUndoPhase("idle", "open")).toBe("confirming");
    expect(nextUndoPhase("confirming", "cancel")).toBe("idle");
  });

  it("works only after the user confirms", () => {
    expect(nextUndoPhase("confirming", "confirm")).toBe("working");
    expect(nextUndoPhase("idle", "confirm")).toBe("idle");
  });

  it("goes back to idle when the undo is done", () => {
    expect(nextUndoPhase("working", "done")).toBe("idle");
  });

  it("ignores open and cancel while the undo works", () => {
    expect(nextUndoPhase("working", "open")).toBe("working");
    expect(nextUndoPhase("working", "cancel")).toBe("working");
  });
});

describe("shouldCallUndo", () => {
  it("is true only for a confirm in the confirmation", () => {
    expect(shouldCallUndo("confirming", "confirm")).toBe(true);
    expect(shouldCallUndo("idle", "confirm")).toBe(false);
    expect(shouldCallUndo("working", "confirm")).toBe(false);
    expect(shouldCallUndo("confirming", "cancel")).toBe(false);
    expect(shouldCallUndo("idle", "open")).toBe(false);
  });
});

describe("undoMessage", () => {
  it("reports the restored count when every change was found", () => {
    expect(undoMessage({ restored: 6, notFound: 0 })).toEqual({
      key: "toast-auto-cleanup-undone",
      params: { restored: 6, notFound: 0 },
    });
  });

  it("reports both counts when some changes were not found", () => {
    expect(undoMessage({ restored: 6, notFound: 1 })).toEqual({
      key: "toast-auto-cleanup-undone-partial",
      params: { restored: 6, notFound: 1 },
    });
    expect(undoMessage({ restored: 0, notFound: 2 }).key).toBe("toast-auto-cleanup-undone-partial");
  });
});
