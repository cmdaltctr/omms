/**
 * The Memory injection section's draft and save maths: pure, with no React or
 * config imports, so tests and the section share one source. The snapshot keys
 * are also the PATCH request identifiers (src/services/global-config-writer.ts).
 */
export const DEFAULT_OPENING_QUERY = "project architecture, setup, conventions and key decisions";
export const OPENING_QUERY_MAX = 500;
const DEFAULT_RESTORE_LIMIT = 10;

export type InjectionDraft = {
  opening: boolean;
  query: string;
  subagent: boolean;
  restore: boolean;
  /** Typed text, so a half-typed or invalid number can show its help. */
  limit: string;
};

export const DEFAULT_INJECTION_DRAFT: InjectionDraft = {
  opening: false,
  query: DEFAULT_OPENING_QUERY,
  subagent: true,
  restore: true,
  limit: String(DEFAULT_RESTORE_LIMIT),
};

export type InjectionSettings = Record<string, { globalValue?: unknown } | undefined>;

/** The draft the global file holds; a key that is missing or mistyped reads as its default. */
export function injectionDraftFromSettings(
  settings: InjectionSettings | undefined
): InjectionDraft {
  const value = (key: string) => settings?.[key]?.globalValue;
  const flag = (key: string, fallback: boolean) =>
    typeof value(key) === "boolean" ? (value(key) as boolean) : fallback;
  const limit = value("compaction.memoryLimit");
  const query = value("openingContextQuery");
  return {
    opening: flag("openingContext", DEFAULT_INJECTION_DRAFT.opening),
    query: typeof query === "string" ? query : DEFAULT_INJECTION_DRAFT.query,
    subagent: flag("subagentMemory", DEFAULT_INJECTION_DRAFT.subagent),
    restore: flag("compaction.enabled", DEFAULT_INJECTION_DRAFT.restore),
    limit: typeof limit === "number" ? String(limit) : DEFAULT_INJECTION_DRAFT.limit,
  };
}

/** A positive whole number, or undefined. */
export function parseRestoreLimit(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Which field blocks Save: a limit that is not a positive whole number, or a query over the cap. */
export function injectionProblem(draft: InjectionDraft): "limit" | "query" | null {
  if (parseRestoreLimit(draft.limit) === undefined) return "limit";
  return draft.query.trim().length > OPENING_QUERY_MAX ? "query" : null;
}

/**
 * Only the changed keys. A value that returns to its default goes as `null`,
 * which removes the key from the file, so Reset to default then Save leaves none
 * of the section's keys behind.
 */
export function injectionSaveEdits(
  draft: InjectionDraft,
  loaded: InjectionDraft
): Record<string, unknown> {
  if (injectionProblem(draft)) return {};
  const edits: Record<string, unknown> = {};
  if (draft.opening !== loaded.opening) {
    edits.openingContext = draft.opening === DEFAULT_INJECTION_DRAFT.opening ? null : draft.opening;
  }
  const query = draft.query.trim();
  if (query !== loaded.query.trim()) {
    edits.openingContextQuery = query === DEFAULT_OPENING_QUERY ? null : query;
  }
  if (draft.subagent !== loaded.subagent) {
    edits.subagentMemory =
      draft.subagent === DEFAULT_INJECTION_DRAFT.subagent ? null : draft.subagent;
  }
  if (draft.restore !== loaded.restore) {
    edits["compaction.enabled"] =
      draft.restore === DEFAULT_INJECTION_DRAFT.restore ? null : draft.restore;
  }
  const limit = parseRestoreLimit(draft.limit)!;
  if (limit !== parseRestoreLimit(loaded.limit)) {
    edits["compaction.memoryLimit"] = limit === DEFAULT_RESTORE_LIMIT ? null : limit;
  }
  return edits;
}

export function canSaveInjection(draft: InjectionDraft, loaded: InjectionDraft): boolean {
  return Object.keys(injectionSaveEdits(draft, loaded)).length > 0;
}
