/**
 * The page's copy of `isValidClaudeConfigDir` in `src/services/claude-folder.ts`,
 * for a message before the save. The server check stays the rule;
 * `tests/web-auto-settings.test.ts` checks that the two agree.
 */
export function isValidClaudeConfigDir(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  );
}

/** The field after a new snapshot: an edited, unsaved value stays; otherwise the saved one. */
export function nextClaudeDraft(saved: unknown, draft: string, edited: boolean): string {
  if (edited) return draft;
  return typeof saved === "string" ? saved : "";
}
