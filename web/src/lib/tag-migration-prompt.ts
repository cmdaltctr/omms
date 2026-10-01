import { readPreference, writePreference } from "$lib/preferences";

const KEY = "omms-tag-migration-closed-count";

/**
 * True when the tagging dialog should open for this many untagged memories.
 * After a Close the page asks again only when more untagged memories appear,
 * for example after more `memory add` calls without tags.
 */
export function shouldOpenTagMigration(count: number): boolean {
  if (count <= 0) return false;
  const closed = Number(readPreference(KEY, KEY) ?? 0);
  return !(Number.isFinite(closed) && count <= closed);
}

export function rememberTagMigrationClose(count: number): void {
  writePreference(KEY, String(count));
}

/** After the migration tags every memory, a later untagged memory should ask again. */
export function clearTagMigrationClose(): void {
  writePreference(KEY, "0");
}
