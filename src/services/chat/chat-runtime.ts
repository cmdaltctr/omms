import { join } from "node:path";
import type { MemorySearchConfig } from "../client-read-settings.js";
import { log } from "../logger.js";
import type { ChatServiceDeps } from "./chat-service.js";
import { ChatStore } from "../storage/chat-store.js";
import type { MemoryHit, ProfileCandidate } from "./chat-retrieve.js";
import { chatSkillsDep, type ChatSkillsConfig } from "./chat-skills-runtime.js";

export { listedSkillNames } from "./chat-skills-runtime.js";

/** Each model call gets this long before chat gives up on it. */
export const CHAT_MODEL_TIMEOUT_MS = 60_000;

/** The settings chat reads. The caller passes `CONFIG`. */
export interface ChatRuntimeConfig extends Partial<Omit<ChatSkillsConfig, "storagePath">> {
  storagePath: string;
  memoryProvider: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  userEmailOverride?: string;
}

const stores = new Map<string, Promise<ChatStore>>();

/** The chat store for this storage path, opened and migrated once. */
export function chatStore(config: Pick<ChatRuntimeConfig, "storagePath">): Promise<ChatStore> {
  const path = join(config.storagePath, "chats.db");
  let store = stores.get(path);
  if (!store) {
    const opened = new ChatStore(path);
    store = opened.init().then(() => opened);
    store.catch(() => stores.delete(path));
    stores.set(path, store);
  }
  return store;
}

/** One structured call to the external memory model. Skill drafting reuses it (design §6). */
export async function callTool(
  config: ChatRuntimeConfig,
  system: string,
  user: string,
  tool: object,
  timeoutMs = CHAT_MODEL_TIMEOUT_MS
) {
  const { AIProviderFactory } = await import("../ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("../ai/provider-config.js");
  const { aiSessionManager } = await import("../storage/ai-sessions.js");
  const provider = AIProviderFactory.createProvider(
    config.memoryProvider as Parameters<typeof AIProviderFactory.createProvider>[0],
    buildMemoryProviderConfig(config, {
      maxIterations: 1,
      iterationTimeout: timeoutMs,
      keylessForLocalUrl: true,
    })
  );
  const sessionId = `chat_${crypto.randomUUID()}`;
  try {
    return await provider.executeToolCall(system, user, tool, sessionId);
  } finally {
    // Providers keep a session transcript; chat keeps its own history in chats.db.
    await aiSessionManager
      .deleteSession(sessionId, config.memoryProvider as never)
      .catch(() => undefined);
  }
}

async function activeProfileItems(config: ChatRuntimeConfig): Promise<ProfileCandidate[]> {
  const { resolveWebProfileUserId } = await import("../profile-identity.js");
  const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
  const userId = await resolveWebProfileUserId(config);
  const profile = userId ? await userProfileManager.getActiveProfile(userId) : null;
  if (!profile) return [];
  const data = JSON.parse(profile.profileData) as Record<string, any[] | undefined>;
  const sections = ["preferences", "patterns", "workflows"] as const;
  return sections.flatMap((section) =>
    (data[section] ?? []).map((item, index) => ({
      section,
      index,
      category: item.category,
      description: String(item.description ?? ""),
      evidence: item.evidence,
      centroid: Array.isArray(item.centroid) ? item.centroid : undefined,
    }))
  );
}

/** The memory ids from `ids` that still exist in any project or user shard. */
export async function existingMemoryIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  const { listEveryMemoryShard } = await import("../storage/memory/shards.js");
  const { existingMemoryIdsInShard } = await import("../storage/memory/rows.js");
  for (const shard of await listEveryMemoryShard("user")) {
    for (const id of await existingMemoryIdsInShard(shard, ids)) found.add(id);
  }
  return found;
}

/** The settings a chat answer reads: chat's own and the memory search's. */
export type ChatAnswerConfig = ChatRuntimeConfig & MemorySearchConfig;

/** Real dependencies for `askQuestion`, built from the settings passed in. */
export async function chatServiceDeps(config: ChatAnswerConfig): Promise<ChatServiceDeps> {
  const store = await chatStore(config);
  const skills = await chatSkillsDep(config);
  return {
    store,
    ...(skills ? { skills } : {}),
    model: config.memoryModel ?? config.memoryProvider,
    callTool: (system, user, tool) => callTool(config, system, user, tool),
    retrieve: {
      searchMemories: async (query, scopeTag) => {
        const { memoryClient } = await import("../client.js");
        const result = await memoryClient.searchMemories(
          query,
          scopeTag ?? "",
          scopeTag ? "project" : "all-projects",
          { includeLinked: true, config }
        );
        return result.success ? (result.results as MemoryHit[]) : [];
      },
      embed: async (text) => {
        const { embeddingService } = await import("../embedding.js");
        return embeddingService.embedWithTimeout(text, { task: "query" });
      },
      profileItems: () => activeProfileItems(config),
    },
    listTags: async (scopeTag) => {
      const { handleListKeywords } = await import("../api-handlers.js");
      const result = await handleListKeywords(scopeTag ?? undefined);
      return result.success && result.data ? result.data.keywords : [];
    },
    profileCategories: async () => [
      ...new Set(
        (await activeProfileItems(config))
          .map((item) => item.category)
          .filter((category): category is string => !!category)
      ),
    ],
    log: (message, meta) => log(message, meta),
  };
}
