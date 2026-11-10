/** Earlier fixes and decisions are stored in memory, so agents should look there first. */
export const MEMORY_SEARCH_FIRST =
  "Search it before you debug or investigate a problem: earlier fixes and decisions are stored here.";

/** The `memory` tool description, the same text for Pi and OpenCode. */
export function memoryToolDescription(languageName: string): string {
  return `Manage and query project memory (MATCH USER LANGUAGE: ${languageName}). ${MEMORY_SEARCH_FIRST} Use 'search' with technical keywords/tags, 'add' to store knowledge, 'profile' for preferences. Use 'memorise' to save an exact note or a session snapshot (topic, done, doing, next) with a short ms- ID, and 'recall' to fetch it by ID, by text or by its labels (tags, all of which must match); memorisations never appear in 'search' or automatic recall. When the user quotes an ms- ID or asks what was planned or memorised ("what were we going to do with X"), use 'recall', not 'search'. Use migrate/list-shards/export/import when a project directory moves. Search/list scope: project or all-projects.`;
}
