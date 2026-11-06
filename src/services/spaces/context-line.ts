/**
 * The line that names the active memory space in every memory context block (design D9).
 * Pi, OpenCode V2 and Claude Code all build their block in `formatContextForPrompt`, so one
 * line serves the three hosts. A space name is user text, so it is cut to one line and
 * stripped of angle brackets before it enters a model prompt.
 */
export function activeSpaceLine(space: { name: string; customStoragePath: boolean }): string {
  if (space.customStoragePath) {
    return "Active memory space: custom storage folder set by this project";
  }
  const name = space.name.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return `Active memory space: ${name}`;
}
