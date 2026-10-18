import { join } from "node:path";
import { log } from "../logger.js";
import type { ChatServiceDeps } from "./chat-service.js";
import { ChatStore } from "./chat-store.js";
import type { MemoryHit, ProfileCandidate } from "./chat-retrieve.js";

/** Each model call gets this long before chat gives up on it. */
export const CHAT_MODEL_TIMEOUT_MS = 60_000;

/** The settings chat reads. The caller passes `CONFIG`. */
export interface ChatRuntimeConfig {
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

async function callTool(
  config: ChatRuntimeConfig,
  system: string,
  user: string,
  tool: Parameters<ChatServiceDeps["callTool"]>[2]
) {
  const { AIProviderFactory } = await import("../ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("../ai/provider-config.js");
  const { aiSessionManager } = await import("../ai/session/ai-session-manager.js");
  const provider = AIProviderFactory.createProvider(
    config.memoryProvider as Parameters<typeof AIProviderFactory.createProvider>[0],
    buildMemoryProviderConfig(config, { maxIterations: 1, iterationTimeout: CHAT_MODEL_TIMEOUT_MS })
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
  const { tursoShardManager } = await import("../turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../turso/connection-manager.js");
  const shards = [
    ...(await tursoShardManager.getAllShards("user", "")),
    ...(await tursoShardManager.getAllShards("project", "")),
  ];
  const marks = ids.map(() => "?").join(",");
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const rows = await db.all(`SELECT id FROM memories WHERE id IN (${marks})`, ids);
    for (const row of rows) found.add(String(row.id));
  }
  return found;
}

/** Real dependencies for `askQuestion`, built from the settings passed in. */
export async function chatServiceDeps(config: ChatRuntimeConfig): Promise<ChatServiceDeps> {
  const store = await chatStore(config);
  return {
    store,
    model: config.memoryModel ?? config.memoryProvider,
    callTool: (system, user, tool) => callTool(config, system, user, tool),
    retrieve: {
      searchMemories: async (query, scopeTag) => {
        const { memoryClient } = await import("../client.js");
        const result = await memoryClient.searchMemories(
          query,
          scopeTag ?? "",
          scopeTag ? "project" : "all-projects"
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
