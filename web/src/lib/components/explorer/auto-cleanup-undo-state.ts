/** The newest automatic cleanup that can still be undone, as `GET /api/user-profile/auto-cleanup` returns it. */
export type AutoCleanupRecord = {
  id: number;
  createdAt: number;
  merged: number;
  removed: number;
};

export type UndoPhase = "idle" | "confirming" | "working";
export type UndoAction = "open" | "cancel" | "confirm" | "done";

/** The Undo button shows only while there is a record to undo. */
export function showUndoButton(record: AutoCleanupRecord | null): boolean {
  return record !== null;
}

/** What the confirmation tells the user before anything changes. */
export function confirmationParams(record: AutoCleanupRecord): {
  createdAt: number;
  merged: number;
  removed: number;
} {
  return { createdAt: record.createdAt, merged: record.merged, removed: record.removed };
}

/** The undo flow: it works only after the user confirms, and cancel leaves everything as it was. */
export function nextUndoPhase(phase: UndoPhase, action: UndoAction): UndoPhase {
  if (phase === "idle" && action === "open") return "confirming";
  if (phase === "confirming" && action === "cancel") return "idle";
  if (phase === "confirming" && action === "confirm") return "working";
  if (phase === "working" && action === "done") return "idle";
  return phase;
}

/** True when this step is the user's confirmation, the only step that calls the undo. */
export function shouldCallUndo(phase: UndoPhase, action: UndoAction): boolean {
  return phase === "confirming" && action === "confirm";
}

/** The message after an undo: the restored count, and the not-found count when there is one. */
export function undoMessage(result: { restored: number; notFound: number }): {
  key: "toast-auto-cleanup-undone" | "toast-auto-cleanup-undone-partial";
  params: { restored: number; notFound: number };
} {
  return {
    key: result.notFound > 0 ? "toast-auto-cleanup-undone-partial" : "toast-auto-cleanup-undone",
    params: { restored: result.restored, notFound: result.notFound },
  };
}
