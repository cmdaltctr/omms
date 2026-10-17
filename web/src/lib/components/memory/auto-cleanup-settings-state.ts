/** The limits of the interval field. The server refuses a value outside them, too. */
export const AUTO_CLEANUP_INTERVAL_MIN = 50;
export const AUTO_CLEANUP_INTERVAL_MAX = 100000;

const INTERVAL_MESSAGE = "Enter a whole number from 50 to 100000.";

export type IntervalParse = { ok: true; value: number } | { ok: false; message: string };

/** A whole number from 50 to 100000. Anything else gets one message and writes nothing. */
export function parseInterval(text: string): IntervalParse {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: INTERVAL_MESSAGE };
  const value = Number(trimmed);
  if (value < AUTO_CLEANUP_INTERVAL_MIN || value > AUTO_CLEANUP_INTERVAL_MAX) {
    return { ok: false, message: INTERVAL_MESSAGE };
  }
  return { ok: true, value };
}

export type IntervalEdit =
  | { kind: "none" }
  | { kind: "edit"; edits: { userProfileAutoCleanupInterval: number } }
  | { kind: "error"; message: string };

/** What saving the interval field does: nothing when unchanged, an edit, or an error to show. */
export function intervalEdit(saved: number, text: string): IntervalEdit {
  const parsed = parseInterval(text);
  if (!parsed.ok) return { kind: "error", message: parsed.message };
  if (parsed.value === saved) return { kind: "none" };
  return { kind: "edit", edits: { userProfileAutoCleanupInterval: parsed.value } };
}

/** The edit for the switch, or null when it already has that value. */
export function enabledEdit(
  saved: boolean,
  checked: boolean
): { userProfileAutoCleanupEnabled: boolean } | null {
  return saved === checked ? null : { userProfileAutoCleanupEnabled: checked };
}
