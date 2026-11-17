/**
 * The catalogue of settings the web UI can change. One list feeds the plain setting rows, the
 * settings search and the test that every writable config key has an entry. Texts are English and
 * double as lookup keys: `i18n/settings-catalogue*.ts` hold the Chinese and Arabic pairs, and
 * `web/tests/settings-catalogue.spec.ts` fails when one is missing.
 */
import { AFFECTS, DEFAULT, row, type CatalogueEntry } from "./settings-catalogue-base";
import { MEMORY_CATALOGUE } from "./settings-catalogue-memory";

export * from "./settings-catalogue-base";

const basics = "settings-section-memory-basics";
const cleanup = "settings-section-memory-cleanup";
const external = "settings-section-external-api";
const models = "settings-section-models";
const embedding = "settings-section-embedding";
const diagnostics = "settings-section-diagnostics";

const SETTINGS_PAGE_CATALOGUE: readonly CatalogueEntry[] = [
  row(
    "autoCaptureEnabled",
    "settings",
    basics,
    "Save memories automatically",
    "Saves a short memory from your coding sessions as you work.",
    DEFAULT.on,
    AFFECTS.capture
  ),
  row(
    "chatMessage.enabled",
    "settings",
    basics,
    "Recall memories in prompts",
    "Adds the memories that match your prompt, so the agent remembers earlier work.",
    DEFAULT.on,
    AFFECTS.prompt
  ),
  row(
    "visibleRecall",
    "settings",
    basics,
    "Show recall rows",
    "Shows a line in the terminal each time memories are added to a prompt.",
    DEFAULT.on,
    AFFECTS.terminal
  ),
  row(
    "injectProfile",
    "settings",
    basics,
    "Add your profile to prompts",
    "Adds your learned preferences and habits to the memories the agent gets.",
    DEFAULT.on,
    AFFECTS.profile
  ),
  row(
    "memory.defaultScope",
    "settings",
    basics,
    "Where a search looks",
    "Searches this project only, or every project, when a search does not say.",
    "This project",
    AFFECTS.search
  ),
  row(
    "autoDeleteOldMemories",
    "settings",
    cleanup,
    "Delete old memories automatically",
    "Deletes memories that have not changed for a set number of days. A deleted memory cannot be restored.",
    DEFAULT.off,
    AFFECTS.remove
  ),
  row(
    "autoCleanupRetentionDays",
    "settings",
    cleanup,
    "Days before a memory is old",
    "A memory that has not changed for this many days counts as old.",
    "30 days",
    AFFECTS.remove
  ),
  row(
    "memoryProvider",
    "settings",
    external,
    "Model service type",
    "The kind of service that runs the model that writes your memories.",
    "OpenAI Chat Completions",
    AFFECTS.model
  ),
  row(
    "memoryApiUrl",
    "settings",
    external,
    "Model service address",
    "The web address of the service. Every provider needs one, except OrcaRouter, which has its own.",
    DEFAULT.unset,
    AFFECTS.model
  ),
  row(
    "memoryModel",
    "settings",
    external,
    "Model name",
    "The model that writes your memories.",
    DEFAULT.unset,
    AFFECTS.model
  ),
  row(
    "memoryApiKey",
    "settings",
    external,
    "Model service key",
    "The key that lets OMMS use the service. It stays in a private file or an environment variable.",
    DEFAULT.unset,
    AFFECTS.model
  ),
  row(
    "opencodeProvider",
    "settings",
    models,
    "OpenCode model service",
    "The service OpenCode uses to write memories. Choose the session's model to use the one you chat with.",
    "External API, else the session model",
    AFFECTS.model
  ),
  row(
    "opencodeModel",
    "settings",
    models,
    "OpenCode model",
    "The model OpenCode uses to write memories.",
    "External API, else the session model",
    AFFECTS.model
  ),
  row(
    "piProvider",
    "settings",
    models,
    "Pi model service",
    "The service Pi uses to write memories. Choose the session's model to use the one you chat with.",
    "External API, else the session model",
    AFFECTS.model
  ),
  row(
    "piModel",
    "settings",
    models,
    "Pi model",
    "The model Pi uses to write memories.",
    "External API, else the session model",
    AFFECTS.model
  ),
  row(
    "opencodeBackfillModel",
    "settings",
    models,
    "OpenCode import model",
    "The model that reads past OpenCode sessions during an import.",
    "Session model",
    AFFECTS.imports
  ),
  row(
    "piBackfillModel",
    "settings",
    models,
    "Pi import model",
    "The model that reads past Pi sessions during an import.",
    "Session model",
    AFFECTS.imports
  ),
  row(
    "embeddingModel",
    "settings",
    embedding,
    "Embedding model",
    "The model that turns text into numbers, so OMMS can match memories by meaning.",
    "Built-in nomic-embed-text",
    AFFECTS.embed
  ),
  row(
    "embeddingDimensions",
    "settings",
    embedding,
    "Embedding size",
    "How many numbers describe one memory. Change it only when the model needs it.",
    "Read from the model",
    AFFECTS.embed
  ),
  row(
    "embeddingApiUrl",
    "settings",
    embedding,
    "Embedding server address",
    "Where OMMS asks for embeddings. Empty means the built-in model runs on this machine.",
    "Not set (built-in model)",
    AFFECTS.embed
  ),
  row(
    "embeddingApiKey",
    "settings",
    embedding,
    "Embedding server key",
    "The key for the embedding server, when it needs one.",
    DEFAULT.unset,
    AFFECTS.embed
  ),
  row(
    "webServerAuthUsername",
    "settings",
    "settings-section-keys",
    "Browser user name",
    "The user name for the web app when you open it from another machine.",
    DEFAULT.unset,
    AFFECTS.access
  ),
  row(
    "webServerAuthPassword",
    "settings",
    "settings-section-keys",
    "Browser password",
    "The password for the web app. It stays in a private file.",
    DEFAULT.unset,
    AFFECTS.access
  ),
  row(
    "captureTrace",
    "settings",
    diagnostics,
    "Record capture traces",
    "Saves the text sent to and from the memory model, to help find problems. A trace can hold your conversations.",
    DEFAULT.off,
    AFFECTS.diagnostics
  ),
  row(
    "captureTraceRetentionDays",
    "settings",
    diagnostics,
    "Days to keep traces",
    "How long a trace file stays before OMMS deletes it.",
    "7 days",
    AFFECTS.diagnostics
  ),
  row(
    "captureAttemptRetentionDays",
    "settings",
    diagnostics,
    "Days to keep capture records",
    "How long OMMS keeps the record of each save attempt.",
    "30 days",
    AFFECTS.diagnostics
  ),
  row(
    "captureRetryRetentionHours",
    "settings",
    diagnostics,
    "Hours to keep failed turns",
    "How long a turn that failed to save waits for a retry. 0 turns retries off and deletes the waiting turns.",
    "72 hours",
    AFFECTS.capture
  ),
  row(
    "webServerAutoStart",
    "settings",
    "settings-section-web-app",
    "Start the web app at login",
    "Adds a login item that starts the OMMS web app when you sign in to your computer. OpenCode, Pi and Claude Code all use the web app.",
    DEFAULT.on,
    AFFECTS.web
  ),
  row(
    "claudeConfigDir",
    "settings",
    "settings-section-claude-folder",
    "Claude Code folder",
    "The folder where Claude Code keeps its settings and history.",
    "The usual Claude folder",
    AFFECTS.claude
  ),
  row(
    "autoCaptureLanguage",
    "settings",
    "settings-section-capture-language",
    "Memory language",
    "The language that saved memories are written in.",
    "Same as the conversation",
    AFFECTS.capture
  ),
  row(
    "skillLearning",
    "settings",
    "settings-section-skill-learning",
    "Learn from skill use",
    "Records each turn, so OMMS can rank your skills and draft better versions.",
    DEFAULT.off,
    AFFECTS.skills
  ),
  row(
    "skillLearningRedact",
    "settings",
    "settings-section-skill-learning",
    "Hide private text in skill records",
    "Removes private text and secrets before a turn is recorded.",
    DEFAULT.on,
    AFFECTS.skills
  ),
  row(
    "skillFolders",
    "skills",
    "skills-section-folders",
    "Skill folders",
    "The folders OMMS reads your skills from.",
    "The usual skill folders",
    AFFECTS.skills
  ),
];

export const SETTINGS_CATALOGUE: readonly CatalogueEntry[] = [
  ...SETTINGS_PAGE_CATALOGUE,
  ...MEMORY_CATALOGUE,
];

export function findCatalogueEntry(key: string): CatalogueEntry | undefined {
  return SETTINGS_CATALOGUE.find((entry) => entry.key === key);
}

/** The route and anchor that open the card with this setting. */
export function settingTarget(entry: CatalogueEntry): { path: string; hash: string } {
  const hash = `#${entry.anchor}`;
  if (entry.page === "settings") return { path: "/settings", hash };
  if (entry.page === "memorisation") return { path: "/memorisation", hash };
  if (entry.page === "skills") return { path: "/skills", hash };
  return { path: entry.anchor.startsWith("shared-") ? "/memory/shared" : "/memory", hash };
}

/** Every text of an entry, for the translation check. */
export function entryTexts(entry: CatalogueEntry): string[] {
  return [entry.name, entry.description, entry.default, entry.affects];
}
