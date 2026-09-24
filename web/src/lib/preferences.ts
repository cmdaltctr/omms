/**
 * Read a saved UI preference, adopting the value stored under its
 * opencode-mem-era key the first time so upgrading keeps the user's choice.
 */
export function readPreference(key: string, legacyKey: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode, blocked site data); keep the in-memory value
  }
}
