/**
 * The catalogue of settings the web UI can change. One list feeds the plain setting rows, the
 * settings search and the test that every writable config key has an entry. Texts here are
 * English and double as lookup keys: `i18n/settings-catalogue.ts` holds the Chinese and Arabic
 * pairs, and `web/tests/settings-catalogue.spec.ts` fails when one is missing.
 */

/** Where a setting is edited. The Memory page holds the shared cards, the Settings page most of the rest. */
export type SettingsPage = "settings" | "memory" | "memorisation" | "skills";

export type CatalogueEntry = {
  /** The config key, shown as small secondary text. Nested keys use one dot. */
  key: string;
  /** A plain name a non-expert understands. */
  name: string;
  /** One line that says what the setting does. */
  description: string;
  /** The default, as words. */
  default: string;
  /** What the setting changes, as words. */
  affects: string;
  page: SettingsPage;
  /** The element id of the card or row that holds the control. */
  anchor: string;
};

/** The words for "what it affects", shared by many entries. */
export const AFFECTS = {
  capture: "Saving memories from your sessions",
  search: "Finding memories for your prompts",
  prompt: "Memories added to your prompts",
  terminal: "What you see in the terminal",
  profile: "Your user profile",
  remove: "Deleting old memories",
  diagnostics: "Capture diagnostics",
  web: "The web app",
  access: "Who can open the web app",
  model: "Which model saves memories",
  imports: "Importing past sessions",
  skills: "Skill learning",
  embed: "How memories are matched by meaning",
  rank: "The order of search results",
  claude: "Reading Claude Code history",
  memorise: "Memorisations",
} as const;

/** The same, for defaults that repeat. */
export const DEFAULT = { on: "On", off: "Off", unset: "Not set", none: "None" } as const;

export const row = (
  key: string,
  page: SettingsPage,
  anchor: string,
  name: string,
  description: string,
  defaultText: string,
  affects: string
): CatalogueEntry => ({ key, name, description, default: defaultText, affects, page, anchor });

/** Plain wording for notes and labels that cards used to word in technical terms. */
export const PLAIN_TEXT = {
  bytesNote:
    "Text sizes are counted in bytes. An English letter is one byte; some languages use more.",
  tokensNote:
    "A word piece is a small part of a word. A provider can count a few more or fewer for the same text.",
  keywordBoost: "Add a bonus for word matches",
  keywordMerge: "Merge two ranked lists (experimental)",
  keywordMergeHelp:
    "Merging ranks a list by meaning and a list by words together. A memory with a word from your prompt can come back even when its meaning score is low. Experimental: it has not been shown to help.",
  keywordMergeWithReranker: "Merging is not used while the reranker is on. Search uses the bonus.",
} as const;

export const PAGE_LABELS: Record<SettingsPage, string> = {
  settings: "Settings page",
  memory: "Memory page",
  memorisation: "Memorisation page",
  skills: "Skills page",
};
