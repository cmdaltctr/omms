import { translateCatalogue } from "./i18n/settings-catalogue";
import type { CatalogueEntry } from "./settings-catalogue";

type Language = "en" | "zh" | "ar";
const MAX_RESULTS = 8;

/** Retired config keys and the setting that took their place, so an old name still finds it. */
const RETIRED_KEYS: Record<string, string> = { autoCleanupEnabled: "autoDeleteOldMemories" };

/** Lower case, without Arabic short vowels and tatweel, so a word typed without them matches. */
function plain(text: string): string {
  return text.toLowerCase().replace(/[\u064B-\u0652\u0670\u0640]/g, "");
}

/**
 * The settings that match a query, best first. Every word of the query must appear in the name,
 * the description or the config key, in English or in the reader's language. The whole key, or a
 * retired key it replaced, ranks first; then a match in the name, the key and the description.
 */
export function searchSettings(
  query: string,
  entries: readonly CatalogueEntry[],
  language: Language = "en"
): CatalogueEntry[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: CatalogueEntry; score: number }[] = [];
  for (const entry of entries) {
    const name = plain(`${entry.name} ${translateCatalogue(entry.name, language)}`);
    const key = entry.key.toLowerCase();
    const exact = [
      key,
      ...Object.keys(RETIRED_KEYS)
        .filter((old) => RETIRED_KEYS[old] === entry.key)
        .map((old) => old.toLowerCase()),
    ];
    const description = plain(
      `${entry.description} ${translateCatalogue(entry.description, language)}`
    );
    let score = 0;
    for (const word of words) {
      if (exact.includes(word)) score += 4;
      else if (name.includes(word)) score += 3;
      else if (key.includes(word)) score += 2;
      else if (description.includes(word)) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ entry, score });
  }
  // Array.sort is stable, so equal scores keep the catalogue order.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((item) => item.entry);
}
