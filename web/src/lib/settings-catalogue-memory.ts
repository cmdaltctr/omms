/** The catalogue entries for settings on the Memory and Memorisation pages. */
import { AFFECTS, DEFAULT, row, type CatalogueEntry } from "./settings-catalogue-base";

export const MEMORY_CATALOGUE: readonly CatalogueEntry[] = [
  row(
    "autoBackfill",
    "memory",
    "memory-section-auto-import",
    "Import past sessions automatically",
    "Reads sessions from before OMMS was set up and saves memories from them.",
    DEFAULT.on,
    AFFECTS.imports
  ),
  row(
    "importPathMaps",
    "memory",
    "shared-directory-maps",
    "Folder maps",
    "Tells OMMS where a project folder moved to, so old sessions find their project.",
    DEFAULT.none,
    AFFECTS.imports
  ),
  row(
    "importIgnoredDirectories",
    "memory",
    "shared-directory-maps",
    "Ignored folders",
    "Folders that an import skips.",
    DEFAULT.none,
    AFFECTS.imports
  ),
  row(
    "userProfileAutoCleanupEnabled",
    "memory",
    "shared-profile",
    "Tidy the profile automatically",
    "Removes profile items that are old and have little support.",
    DEFAULT.on,
    AFFECTS.profile
  ),
  row(
    "userProfileAutoCleanupInterval",
    "memory",
    "shared-profile",
    "Profile tidy interval",
    "How many analysed prompts pass between profile tidy-ups.",
    "500 prompts",
    AFFECTS.profile
  ),
  row(
    "userProfileWithoutEmail",
    "memory",
    "shared-profile",
    "No user email",
    "What learning does when no user email is known: save to a profile called unknown, or skip the prompts.",
    "Learn anyway",
    AFFECTS.profile
  ),
  row(
    "userProfileDecayBeforeMerge",
    "memory",
    "shared-profile",
    "Fade old items",
    "Lowers the weight of old profile items before each merge, so newer habits count more.",
    DEFAULT.off,
    AFFECTS.profile
  ),
  row(
    "userProfilePromptDetail",
    "memory",
    "shared-profile",
    "Model input",
    "What the model reads each time it learns: your prompts with a profile summary and guidance, or the prompts alone.",
    "Prompts with profile and guidance",
    AFFECTS.profile
  ),
  row(
    "userProfileValidationEnabled",
    "memory",
    "shared-profile",
    "Check older items",
    "Asks the model to check older profile items against new prompts after each learning pass.",
    DEFAULT.off,
    AFFECTS.profile
  ),
  row(
    "showUserProfileToasts",
    "memory",
    "shared-profile",
    "Notice when done",
    "Shows a short notice when a learning pass ends. Claude Code shows it on your next prompt.",
    DEFAULT.on,
    AFFECTS.profile
  ),
  row(
    "userProfileDuringCatchUp",
    "memory",
    "shared-profile",
    "During a catch-up run",
    "Keeps live learning running, or pauses it, while a profile catch-up run is active.",
    "Keep learning",
    AFFECTS.profile
  ),
  row(
    "maxMemories",
    "memory",
    "shared-limits",
    "Memories per search",
    "The most memories one search returns.",
    "10 memories",
    AFFECTS.search
  ),
  row(
    "autoCaptureMaxContextBytes",
    "memory",
    "shared-limits",
    "Conversation size when saving",
    "How much of a conversation OMMS reads when it writes a memory.",
    "128 KB of text",
    AFFECTS.capture
  ),
  row(
    "userProfileMaxContextBytes",
    "memory",
    "shared-limits",
    "Conversation size for the profile",
    "How much text OpenCode reads each time it learns your profile.",
    "32 KB of text",
    AFFECTS.profile
  ),
  row(
    "retrievalMaxTokens",
    "memory",
    "shared-limits",
    "Memory text per prompt",
    "The most memory text one prompt can carry, in small word pieces.",
    "2,000 word pieces",
    AFFECTS.prompt
  ),
  row(
    "similarityThreshold",
    "memory",
    "shared-limits",
    "Match strictness",
    "How close a memory must be to your prompt to come back. A higher number is stricter.",
    "0.6 (0.5 with qwen3-embedding)",
    AFFECTS.search
  ),
  row(
    "compaction.memoryLimit",
    "memory",
    "memory-injection",
    "Memories added back after a summary",
    "The most memories added back when a session is compacted or resumed.",
    "10 memories",
    AFFECTS.prompt
  ),
  row(
    "openingContext",
    "memory",
    "memory-injection",
    "Add memories to the first message",
    "Adds the memories that match the opening search to the first message of a session.",
    DEFAULT.off,
    AFFECTS.prompt
  ),
  row(
    "openingContextQuery",
    "memory",
    "memory-injection",
    "Opening search text",
    "What OMMS searches for when it builds the first message.",
    "project architecture, setup, conventions and key decisions",
    AFFECTS.prompt
  ),
  row(
    "subagentMemory",
    "memory",
    "memory-injection",
    "Give subagents memories",
    "Each subagent session gets the memories that match its task.",
    DEFAULT.on,
    AFFECTS.prompt
  ),
  row(
    "compaction.enabled",
    "memory",
    "memory-injection",
    "Add memories back after a summary",
    "Adds the session's own memories back after a compaction or a resume.",
    DEFAULT.on,
    AFFECTS.prompt
  ),
  row(
    "keywordMode",
    "memory",
    "shared-keywords",
    "How word matches join the results",
    "Chooses between a bonus for word matches and a merge of two ranked lists.",
    "Add a bonus for word matches",
    AFFECTS.search
  ),
  row(
    "rerankerEnabled",
    "memory",
    "shared-reranker",
    "Reorder results with a reranker",
    "Asks a reranker server to put the best memories first. If it fails, search works as before.",
    DEFAULT.off,
    AFFECTS.rank
  ),
  row(
    "rerankerApiUrl",
    "memory",
    "shared-reranker",
    "Reranker server address",
    "The web address of the reranker server.",
    DEFAULT.unset,
    AFFECTS.rank
  ),
  row(
    "rerankerModel",
    "memory",
    "shared-reranker",
    "Reranker model",
    "The model name sent to the reranker server.",
    DEFAULT.unset,
    AFFECTS.rank
  ),
  row(
    "rerankerApiKey",
    "memory",
    "shared-reranker",
    "Reranker key",
    "The key for the reranker server, when it needs one.",
    DEFAULT.unset,
    AFFECTS.rank
  ),
  row(
    "rerankerTimeoutMs",
    "memory",
    "shared-reranker",
    "Reranker wait time",
    "How long a search waits for the reranker before it carries on without it.",
    "4 seconds",
    AFFECTS.rank
  ),
  row(
    "memorisationMaxSize",
    "memorisation",
    "memorisation-settings",
    "Largest memorisation",
    "The biggest piece of text OMMS accepts as one memorisation.",
    "2,000 characters",
    AFFECTS.memorise
  ),
  row(
    "memorisationSizeUnit",
    "memorisation",
    "memorisation-settings",
    "Memorisation size unit",
    "Counts the largest memorisation in characters or in word pieces.",
    "Characters",
    AFFECTS.memorise
  ),
  row(
    "memorisationRepeat",
    "memorisation",
    "memorisation-settings",
    "Saving a session again",
    "Adds a new memorisation or replaces the old one when the same session is saved again.",
    "Add a new one",
    AFFECTS.memorise
  ),
  row(
    "memorisationRerank",
    "memorisation",
    "memorisation-settings",
    "Reorder recalled text with the reranker",
    "Experimental. Puts the best matches of a text recall first, using the reranker.",
    DEFAULT.off,
    AFFECTS.memorise
  ),
];
