/**
 * The rows a settings confirm dialog lists before a save: each setting the request changes, with
 * its saved value and its new value. Pure, with no React or translation imports: the card passes
 * the words of the page.
 */

/** One setting the save changes. `from` and `to` are already in plain words. */
export type SettingsChange = { key: string; label: string; from: string; to: string };

export type SettingsChangeField = {
  /** The request identifier, as the config file spells it: `maxMemories`, `compaction.enabled`. */
  key: string;
  /** The setting's name, already translated. */
  label: string;
  /** Prints a value in plain words. Without it a switch reads On or Off and anything else as text. */
  print?: (value: unknown) => string;
  /** What applies once the key is removed. A removal reads `Default (value)`. */
  default?: unknown;
};

/** The page's words for the values a card does not spell itself. */
export type SettingsChangeWords = {
  on: string;
  off: string;
  notSet: string;
  /** Says that the default applies, as `Default (10)`. */
  default: (value: string) => string;
};

/**
 * Lists what a request changes, in the order of `fields`. `saved` holds the values in force and
 * `edits` is the body the card is about to send; both use the keys of the request. A key that the
 * request leaves out, or that reads the same as its saved value, is no change. A `null` edit removes
 * the key, so the row shows the default. Throws when the request changes a key that no field
 * describes: the dialog must never leave a change out.
 */
export function settingsChanges(
  saved: Record<string, unknown>,
  edits: Record<string, unknown>,
  fields: readonly SettingsChangeField[],
  words: SettingsChangeWords
): SettingsChange[] {
  for (const key of Object.keys(edits)) {
    if (edits[key] !== undefined && !fields.some((field) => field.key === key))
      throw new Error(`settingsChanges: no field describes "${key}"`);
  }
  const plain = (value: unknown): string => {
    if (value === true) return words.on;
    if (value === false) return words.off;
    return value == null ? words.notSet : String(value);
  };
  const rows: SettingsChange[] = [];
  for (const { key, label, print = plain, default: fallback } of fields) {
    const after = edits[key];
    if (after === undefined) continue;
    const from = print(saved[key]);
    const to = after === null ? words.default(print(fallback)) : print(after);
    if (from !== to) rows.push({ key, label, from, to });
  }
  return rows;
}
