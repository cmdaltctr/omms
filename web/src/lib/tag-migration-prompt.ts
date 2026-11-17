import { readPreference, writePreference } from "$lib/preferences";

const KEY = "omms-tag-migration-closed-count";

/**
 * True when the tagging dialog should open for `count` untagged memories in a
 * store of `total`. The dialog is for a store whose memories pre-date tags, so
 * it opens when at least half are untagged. A few untagged memories in a tagged
 * store (for example one `memory add` without tags) do not open it. After a
 * Close the page asks again only when more untagged memories appear.
 */
export function shouldOpenTagMigration(count: number, total: number): boolean {
  if (count <= 0 || total <= 0 || count * 2 < total) return false;
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
