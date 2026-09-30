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
