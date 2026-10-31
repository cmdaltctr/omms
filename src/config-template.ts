/**
 * The JSONC template written to a new ~/.config/omms/omms.jsonc. Lived in
 * src/config.ts until that file reached its size ceiling; the text is
 * unchanged. Shared by config.ts and the global settings writer.
 */

export const CONFIG_TEMPLATE = `{
  // ============================================
  // omms (Opinionated Modular Memory System) Configuration
  // ============================================
  
  // Storage location for the vector database. Leave unset to use the
  // default ~/.omms/data (a legacy ~/.opencode-mem/data store is migrated
  // there automatically on first start; see docs/omms-migration.md).
  // "storagePath": "~/.omms/data",

  "userEmailOverride": "",
  "userNameOverride": "",
  
  // ============================================
  // Embedding Model (for similarity search)
  // ============================================
  // Local = Hugging Face / ONNX via @huggingface/transformers (not Apple MLX).
  // Remote = set embeddingApiUrl (OpenAI-compatible /embeddings); embeddingApiKey is optional.
  
  // Default: Nomic Embed v1 (768 dimensions, 8192 context, multilingual)
  "embeddingModel": "Xenova/nomic-embed-text-v1",

  // Opt-in Nomic task prefixes (search_document: / search_query:). After enabling,
  // re-index existing memories so store and query vectors stay aligned.
  // "embeddingUseTaskPrefixes": true,
  
  // Auto-detected dimensions (no need to set manually)
  // "embeddingDimensions": 768,
  
  // Other recommended local models:
  // "embeddingModel": "Xenova/jina-embeddings-v2-base-en",  // 768 dims, English-only, 8192 context
  // "embeddingModel": "Xenova/jina-embeddings-v2-small-en", // 512 dims, faster, 8192 context
  // "embeddingModel": "Xenova/all-MiniLM-L6-v2",            // 384 dims, very fast, 512 context
  // "embeddingModel": "Xenova/all-mpnet-base-v2",           // 768 dims, good quality, 512 context
  
  // Optional: OpenAI-compatible API for embeddings (URL required; key only if the server needs one)
  // "embeddingApiUrl": "https://api.openai.com/v1",
  // "embeddingApiKey": "env://OPENAI_API_KEY",  // or "sk-..." / "file:///path/to/key"
  // "embeddingModel": "text-embedding-3-small",  // 1536 dims, auto-detected
 
  // ============================================
  // Web Server Settings
  // ============================================
  
  // Start a background import of past chats on each host's next start.
  "autoBackfill": true,
  // "piBackfillModel": "inherit", // or "external", or "provider/model"
  // "opencodeBackfillModel": "inherit", // or "external", or "provider/model"
  // Directory maps for history recorded in moved or deleted directories.
  // "importPathMaps": [{ "from": "~/code/app-feat-x", "to": "~/code/app" }],
  // Unresolved directories to hide on the Directory maps page. They stay unimported.
  // "importIgnoredDirectories": ["/private/tmp/scratch"],
  // Claude Code's folder, when it is not ~/.claude (like CLAUDE_CONFIG_DIR).
  // "claudeConfigDir": "~/.claude-work",

  // Register the web app to start when you log in.
  "webServerAutoStart": true,
  // Enable web UI for managing memories (accessible at http://localhost:4747)
  "webServerEnabled": true,
  
  // Port for web UI server
  "webServerPort": 4747,
  
  // Host address for web UI (use 127.0.0.1 for local only, 0.0.0.0 for network access)
  "webServerHost": "127.0.0.1",

  // Optional HTTP Basic Auth for the web UI. Accepts literal, env://, or file:// secrets.
  // "webServerAuthPassword": "",
  // "webServerAuthUsername": "",

  // Deprecated: imported once into the API token table, then no longer read.
  // Create API tokens on the Settings page (Keys and access) instead.
  // "webServerApiToken": "env://OMMS_WEB_TOKEN",
  
  // ============================================
  // Database Settings
  // ============================================
  
  // Maximum vectors per database shard (auto-creates new shard when limit reached)
  "maxVectorsPerShard": 50000,
  
  // Automatically delete old memories based on retention period
  "autoCleanupEnabled": true,
  
  // Days to keep memories before auto-cleanup (only if autoCleanupEnabled is true)
  "autoCleanupRetentionDays": 30,
  
  // Automatically detect and remove duplicate memories
  "deduplicationEnabled": true,
  
   // Similarity threshold (0-1) for detecting duplicates (higher = stricter)
   "deduplicationSimilarityThreshold": 0.90,
   
  // ============================================
  // Memory Scope Settings
  // ============================================

  // Default scope for memory list/search queries
  // "project" keeps queries within the current project, "all-projects" searches across all project shards
  "memory": {
    "defaultScope": "project"
  },

  // ============================================
  // Model for auto-capture and profile learning (same rule in OpenCode and Pi)
  // ============================================

   // Which model summarises your work, in this order:
   //   1. The host model below: opencodeProvider/opencodeModel in OpenCode,
   //      piProvider/piModel in Pi. Set the model to "inherit" to follow
   //      whatever model the session is using, or to "external" to send
   //      every call to the external API below.
   //   2. If no host model is set: the external API (memoryModel/memoryApiUrl/
   //      memoryApiKey further down).
   //   3. If neither is set: the session's own model.
   // If the host model fails and the external API is configured, the external
   // API is used instead.
   //
   // Host models go through OpenCode's or Pi's own sign-in (OAuth like Claude
   // Pro/Max, GitHub Copilot, ChatGPT, or your own key there), so no separate API
   // key is needed here.
   //
   // Examples (OpenCode names from 'opencode providers list'; Pi names from its model list):
   //   "opencodeProvider": "anthropic",    "opencodeModel": "claude-haiku-4-5-20251001"
   //   "opencodeProvider": "openai",       "opencodeModel": "inherit"
   //   "piProvider": "openai-codex",       "piModel": "gpt-5.6-luna"
   //
   // "opencodeProvider": "anthropic",
   // "opencodeModel": "claude-haiku-4-5-20251001",
   // "piProvider": "openai-codex",
   // "piModel": "gpt-5.6-luna",

   // ============================================
   // Auto-Capture Settings
   // ============================================
  
  // Auto-capture runs in the background without blocking your main session.
  // Note: Ollama may not support tool calling. Use OpenAI, Anthropic, or Groq for best results.
  
  "autoCaptureEnabled": true,
  
  // Provider type: "openai-chat" | "openai-responses" | "anthropic" | "minimax" | "orcarouter" | "google-gemini"
  // Note: "openai-chat" is a generic OpenAI API-compatible mode.
  // Any service that follows the OpenAI Chat Completions API can use it via custom "memoryApiUrl".
  "memoryProvider": "openai-chat",
  
  // External API (step 2 above, and the fallback when a host model fails).
  // Uncomment all 3 lines and replace memoryApiKey before use:
  // "memoryModel": "gpt-4o-mini",
  // "memoryApiUrl": "https://api.openai.com/v1",
  // "memoryApiKey": "sk-...",

  // API Key Formats:
  // Direct value:        "sk-..."
  // From file:           "file://~/.config/litellm-key.txt"
  // From env variable:   "env://LITELLM_API_KEY"
  
  // Examples for different providers:
  // Any OpenAI-compatible endpoint can use the "openai-chat" provider pattern below.
  // Common examples: DeepSeek, Qwen (via Alibaba Cloud ModelStudio),
  // Zhipu GLM (BigModel platform), and Kimi (Moonshot AI platform).

  // OpenAI Chat Completion (default, backward compatible):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "gpt-4o-mini"
  //   "memoryApiUrl": "https://api.openai.com/v1"
  //   "memoryApiKey": "sk-..."

  // DeepSeek (OpenAI-compatible example):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "deepseek-chat"
  //   "memoryApiUrl": "https://api.deepseek.com/v1"
  //   "memoryApiKey": "sk-..."
  
  // OpenAI Responses API (recommended, with session support):
  //   "memoryProvider": "openai-responses"
  //   "memoryModel": "gpt-4o"
  //   "memoryApiUrl": "https://api.openai.com/v1"
  //   "memoryApiKey": "sk-..."
  
  // Anthropic (with session support):
  //   "memoryProvider": "anthropic"
  //   "memoryModel": "claude-3-5-haiku-20241022"
  //   "memoryApiUrl": "https://api.anthropic.com/v1"
  //   "memoryApiKey": "sk-ant-..."

  // MiniMax (Anthropic Messages-compatible endpoint, with session support):
  //   "memoryProvider": "minimax"
  //   "memoryModel": "MiniMax-M3"
  //   "memoryApiUrl": "https://api.minimax.io"        // global endpoint
  //   "memoryApiKey": "<MiniMax API key>"
  //   // China endpoint: "memoryApiUrl": "https://api.minimaxi.com"
  //   // Optional adaptive thinking for MiniMax-M3:
  //   "memoryExtraParams": { "thinking": { "type": "adaptive" } }

  // OrcaRouter (OpenAI-compatible gateway, namespaced model IDs, with session support):
  //   "memoryProvider": "orcarouter"
  //   "memoryApiKey": "<OrcaRouter API key>"
  //   // memoryApiUrl and memoryModel are optional — they default to
  //   // https://api.orcarouter.ai/v1 and "orcarouter/auto" (a routing alias).
  //   // OrcaRouter rejects bare model names, so if you set memoryModel, use a
  //   // namespaced ID such as "openai/gpt-5.5" or "deepseek/deepseek-v4-flash".
  //   "memoryModel": "openai/gpt-5.5"

  // Groq (OpenAI-compatible, use openai-chat provider):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "llama-3.3-70b-versatile"
  //   "memoryApiUrl": "https://api.groq.com/openai/v1"
  //   "memoryApiKey": "gsk_..."
  
  // Maximum iterations for multi-turn AI analysis (for openai-responses, anthropic, and minimax)
  "autoCaptureMaxIterations": 5,
   
  // Timeout per iteration in milliseconds (30 seconds default)
  "autoCaptureIterationTimeout": 30000,

  // Tries for one turn's capture, on Pi and OpenCode, 2 and 4 seconds apart. After the
  // last one fails, a turn the model could not reach goes to the capture retry queue.
  "autoCaptureMaxRetries": 3,

  // Maximum UTF-8 bytes for the auto-capture markdown context sent to the summary model.
  // Prevents HTTP 400 context overflows on models with ~131K token windows (e.g. Groq Llama).
  // Rough guide: tokens ≈ bytes / 4 for mixed code/prose.
  "autoCaptureMaxContextBytes": 131072,
   
  // Days to keep AI session history before cleanup
  "aiSessionRetentionDays": 7,

  // Capture diagnostics: every capture attempt always writes one metadata line
  // (model, stop reason, sizes, outcome) to ~/.omms/omms.log, with no
  // conversation text. Set captureTrace to true to also write each attempt's
  // prompt and raw reply to ~/.omms/traces/ for debugging. Traces can contain
  // conversation content: <private> text and common API key formats are
  // redacted, files are readable only by you, and they are deleted after
  // captureTraceRetentionDays. Only this global file can turn tracing on.
  // "captureTrace": false,
  // "captureTraceRetentionDays": 7,
  // "captureAttemptRetentionDays": 30,

  // Skill learning: record each full turn (prompt, replies, tool calls with
  // their outcome, and the skills used) in ~/.omms/data/skills.db, so OMMS can
  // rank your skills and draft better versions. Off by default. A project config
  // can turn it off but never on. No model call is made to record a turn.
  // "skillLearning": false,
  // Remove <private> text and common API key formats before a turn is stored.
  // Global config only. Turning this off stores text as written.
  // "skillLearningRedact": true,
  // Folders OMMS reads skills from. Absolute or starting with ~/. Global config
  // only. Unset: ~/.agents/skills and the Claude Code folder's skills folder.
  // "skillFolders": ["~/.agents/skills"],

  // Capture retry queue: when a live capture fails because the model cannot be
  // reached (network error, timeout, HTTP 408, 429 or 5xx), OMMS keeps a copy of
  // the turn in ~/.omms/data and tries it again later. The copy has <private>
  // text and common API key formats removed. Turns are deleted when the retry
  // ends or after captureRetryRetentionHours (0 to 720). 0 turns the queue off.
  // Only this global file can set it.
  // "captureRetryRetentionHours": 72,

  // Temperature for AI API requests (set to false to omit parameter for models that don't support it)
  // Some reasoning models (like o1, o3, gpt-5) don't support temperature parameter
  // Set to false and add "memoryTemperature": false in config when using such models
  "memoryTemperature": 0.3,

  // Extra parameters to include in API request body
  // Useful for local inference servers (e.g. llama-server with --jinja) that support
  // additional parameters like disabling thinking/reasoning mode
  // Example for Qwen3 models: { "enable_thinking": false }
  // "memoryExtraParams": {},

  // Language for auto-capture summaries (default: "auto" for auto-detection)
  // Options: "auto", "en", "id", "zh", "ja", "es", "fr", "de", "ru", "pt", "ar", "ko"
  // "autoCaptureLanguage": "auto",

  // ============================================
  // Toast Notifications
  // ============================================

  // Show toast when memory is auto-captured
  "showAutoCaptureToasts": true,

  // Show toast when user profile is updated
  "showUserProfileToasts": true,

  // Show toast for error messages
  "showErrorToasts": true,

  // ============================================
  // User Profile System
  // ============================================

  // Analyze user prompts every N prompts to build/update your user profile
  // When N uncaptured prompts accumulate, AI will analyze them to identify:
  // - User preferences (code style, communication style, tool preferences)
  // - User patterns (recurring topics, problem domains, technical interests)
  // - User workflows (development habits, sequences, learning style)
  // - Skill level (overall and per-domain assessment)
  "userProfileAnalysisInterval": 10,

  // Days before inactive items (all types) are eligible for removal
  "userProfileStaleDays": 2,

  // Days before an inactive workflow is eligible for removal. A workflow seen
  // userProfileMinEvidenceForRetention times or more is kept.
  "userProfileWorkflowStaleDays": 30,

  // Number of preferences shown in UI
  "userProfileDisplayPreferences": 20,
  
  // Number of patterns shown in UI
  "userProfileDisplayPatterns": 15,
  
  // Number of workflows shown in UI
  "userProfileDisplayWorkflows": 10,
  
  // Number of preferences injected into LLM conversation context
  // Keep this small — the strongest signals are enough; more dilute LLM attention
  "userProfileInjectPreferences": 5,
  
  // Number of patterns injected into LLM conversation context
  "userProfileInjectPatterns": 5,
  
  // Number of workflows injected into LLM conversation context
  "userProfileInjectWorkflows": 3,
  
  // Days before preference confidence starts to decay (if not reinforced)
  // Preferences that aren't seen again will gradually lose confidence and be removed
  "userProfileConfidenceDecayDays": 30,
  
  // Number of profile versions to keep in changelog (for rollback/debugging)
  // Older versions are automatically cleaned up
  "userProfileChangelogRetentionCount": 5,

  // Minimum evidence count for a preference/pattern to survive confidence decay
  // Items confirmed fewer times are more likely to be pruned when confidence decays
  "userProfileMinEvidenceForRetention": 3,

  // Merge duplicate or vague profile items every N analysed prompts (about 1 model call per 100 items)
  "userProfileAutoCleanupEnabled": true,
  "userProfileAutoCleanupInterval": 500,

  // Enable LLM validation of existing preferences against recent behavior.
  // When enabled, each analysis round checks if top-5 preferences still match recent prompts.
  // Experimental — disabled by default.
  "userProfileValidationEnabled": false,

  // ============================================
  // Search Settings
  // ============================================
   
  // Minimum similarity score (0-1) for memory search results. Leave unset to
  // follow the default for your embedding model: 0.5 for qwen3-embedding:0.6b
  // (the only model measured), 0.6 for every other embedder.
  // "similarityThreshold": 0.5,

  // Maximum number of memories to return in search results.
  // Manual searches can ask for fewer; prompt retrieval uses this ceiling.
  "maxMemories": 10,

  // ============================================
  // Memory Context Controls
  // ============================================

  // Recent memories added at fresh session start (OpenCode V1 and Claude Code).
  // Pi and OpenCode V2 search the store with each prompt instead.
  "chatMessage": {
    "enabled": true,
    // Recent memories injected at session start.
    "maxMemories": 3,
    "excludeCurrentSession": true,
    // When to inject: "first" message of a session or "always".
    // "injectOn": "first",
  },

  // OpenCode profile-learning input limit, in UTF-8 bytes. Smaller values can
  // omit prompts from that input. Does not limit Pi or Claude Code profile input.
  "userProfileMaxContextBytes": 32768,

  // Shared budget for automatic memory context (profile text, memories, and
  // formatting) across all hosts, in approximate tokens: ceil(UTF-8 bytes / 4).
  // Covers prompt retrieval, recent-memory injection, and session-memory
  // restoration. Not an exact provider token limit or a spending limit.
  "retrievalMaxTokens": 2000,

  // ============================================
  // Advanced Settings
  // ============================================
  
  // Inject user profile into AI context (preferences, patterns, workflows)
  "injectProfile": true
}
`;
