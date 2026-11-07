import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveMemoryScope } from "./memory-scope.js";
import { log } from "./logger.js";
import {
  DEFAULT_SPACE_ID,
  readRegistryFile,
  resolveSpaceFolder,
  spaceLinks,
} from "./spaces/registry.js";
import { ommsHomeDir } from "./spaces/storage-resolution.js";
import type { SpaceReadStore } from "./spaces/space-store.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import type { SearchResult, ShardInfo } from "./turso/types.js";
import type { KeywordMode } from "../utils/keyword-boost.js";

/**
 * Linked-space reads (design D6): the active space may link other spaces and
 * read their memories, read-only. This module holds every rule of that read:
 * own results keep their places, a linked space is skipped with a warning when
 * it is unavailable or was embedded differently, links are never followed
 * further than the active space's own links, and the linked folder is only
 * ever opened through the cached read store, which sets `query_only`.
 *
 * Pure with respect to CONFIG: the caller passes the settings, so tests that
 * stub `src/config.js` keep working.
 */

export type LinkedScope = "project" | "all-projects";

/** Options shared by the search and list reads: `includeLinked` reads linked spaces too (D6). */
export interface MemoryReadOptions {
  includeLinked?: boolean;
}

/** The settings a linked search needs; the caller snapshots them from CONFIG. */
export interface LinkedSearchSettings {
  maxMemories: number;
  similarityThreshold: number;
  embeddingDimensions: number;
  embeddingModel: string;
  keywordBoost: number;
  keywordMode: KeywordMode;
  /** The Default space folder, `CONFIG.skillStoragePath ?? CONFIG.storagePath`. */
  globalStoragePath: string;
}

/** Which space is reading. `customStoragePath` means the project folder wins, so no link applies. */
export interface LinkedOwner {
  id: string;
  customStoragePath: boolean;
}

/**
 * Snapshots the settings a linked read needs from a CONFIG-shaped object. The
 * value is passed in, so this module never imports `src/config.js`.
 */
export function linkedSettingsFrom(config: {
  maxMemories: number;
  similarityThreshold: number;
  embeddingDimensions: number;
  embeddingModel: string;
  keywordBoost: number;
  keywordMode: KeywordMode;
  skillStoragePath?: string;
  storagePath: string;
}): LinkedSearchSettings {
  return {
    maxMemories: config.maxMemories,
    similarityThreshold: config.similarityThreshold,
    embeddingDimensions: config.embeddingDimensions,
    embeddingModel: config.embeddingModel,
    keywordBoost: config.keywordBoost,
    keywordMode: config.keywordMode,
    globalStoragePath: config.skillStoragePath ?? config.storagePath,
  };
}

export interface LinkedSearchResult extends SearchResult {
  /** The display name of the linked space the result came from. Own results carry none. */
  spaceName: string;
}

export interface ListedMemory {
  id: string;
  summary: string;
  type: string | undefined;
  createdAt: string;
  metadata: Record<string, unknown> | undefined;
  displayName: unknown;
  userName: unknown;
  userEmail: unknown;
  projectPath: unknown;
  projectName: unknown;
  gitRepoUrl: unknown;
  spaceName?: string;
}

function safeToISOString(timestamp: unknown): string {
  try {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    const numValue = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp);

    if (isNaN(numValue) || numValue < 0) {
      return new Date().toISOString();
    }

    return new Date(numValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function safeJSONParse(jsonString: unknown): any {
  if (!jsonString || typeof jsonString !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

/** Maps one raw `memories` row onto the listed-memory shape of `listMemories`. */
export function mapListedMemory(row: Record<string, unknown>): ListedMemory {
  return {
    id: String(row.id),
    summary: String(row.content),
    type: row.type ? String(row.type) : undefined,
    createdAt: safeToISOString(row.created_at),
    metadata: safeJSONParse(row.metadata),
    displayName: row.display_name,
    userName: row.user_name,
    userEmail: row.user_email,
    projectPath: row.project_path,
    projectName: row.project_name,
    gitRepoUrl: row.git_repo_url,
  };
}

interface LinkedTarget {
  name: string;
  store: SpaceReadStore;
}

/** The shards of one scope walk: the scope refs of the caller, resolved against the store. */
async function shardsForScope(
  store: SpaceReadStore,
  scope: LinkedScope,
  containerTag: string
): Promise<ShardInfo[]> {
  const refs = resolveMemoryScope(scope, containerTag);
  return (await Promise.all(refs.map((ref) => store.listShards(ref.scope, ref.hash)))).flat();
}

/**
 * Every reachable linked space of the owner, as cached read stores. A link that
 * cannot be read leaves a warning naming the space and is skipped; the search
 * itself keeps going.
 */
async function linkedTargets(
  owner: LinkedOwner,
  settings: LinkedSearchSettings,
  warnings: string[]
): Promise<LinkedTarget[]> {
  // The Default space holds no links, and a project storage folder bypasses spaces entirely.
  if (owner.id === DEFAULT_SPACE_ID || owner.customStoragePath) return [];

  // Loaded here, not at the top: the cache module opens database environments,
  // and importing it statically would pull it into every client import.
  const { getCachedSpaceReadStore } = await import("./spaces/read-store-cache.js");

  const { registry, problem } = readRegistryFile(join(ommsHomeDir(), "spaces.json"));
  if (problem) return [];

  const targets: LinkedTarget[] = [];
  for (const link of spaceLinks(registry, owner.id)) {
    if (!link.available) {
      warnings.push(`Linked space "${link.name}" is archived or deleted; skipped.`);
      continue;
    }
    const folder = resolveSpaceFolder(link.id, {
      globalStoragePath: settings.globalStoragePath,
      spacesRoot: join(ommsHomeDir(), "spaces"),
    });
    if (!existsSync(folder)) {
      warnings.push(`Linked space "${link.name}" has no folder; skipped.`);
      continue;
    }
    const store = getCachedSpaceReadStore(folder);
    // No metadata.db means the space holds no memories: nothing to read, nothing to warn about.
    if (!store.hasMetadata) continue;
    targets.push({ name: link.name, store });
  }
  return targets;
}

/**
 * The space-level embedding gate: null when the space can be searched with the
 * current query vector, a reason naming the difference when it cannot. A shard
 * with no recorded dimensions never matches (the own-space rule); a space with
 * no recorded model is read when the dimensions match.
 */
async function embeddingMismatchReason(
  store: SpaceReadStore,
  shards: ShardInfo[],
  settings: LinkedSearchSettings
): Promise<string | null> {
  for (const shard of shards) {
    const db = await store.openShard(shard.dbPath);
    const rows = await db.all(
      `SELECT key, value FROM shard_metadata WHERE key IN ('embedding_dimensions', 'embedding_model')`
    );
    const metadata = new Map(
      rows.map((row: Record<string, unknown>) => [String(row.key), row.value])
    );
    const dimensions = metadata.get("embedding_dimensions");
    if (dimensions === undefined || Number(dimensions) !== settings.embeddingDimensions) {
      return `embedded with ${dimensions === undefined ? "no recorded" : String(dimensions)} dimensions (${settings.embeddingDimensions} expected)`;
    }
    const model = metadata.get("embedding_model");
    if (model !== undefined && String(model) !== settings.embeddingModel) {
      return `embedded with model "${String(model)}" (${settings.embeddingModel} expected)`;
    }
  }
  return null;
}

/** Reads the linked spaces of the owner and returns their results, best first, within `room`. */
export async function searchLinkedSpaces(input: {
  query: string;
  /** The query vector of the own search, reused as-is: one prompt, one embedding. */
  queryVector: Float32Array;
  scope: LinkedScope;
  containerTag: string;
  /** How many results the own search already returned. */
  ownCount: number;
  owner: LinkedOwner;
  settings: LinkedSearchSettings;
}): Promise<{ results: LinkedSearchResult[]; warnings: string[] }> {
  const warnings: string[] = [];
  const room = input.settings.maxMemories - input.ownCount;
  if (room <= 0) return { results: [], warnings };

  const linked: LinkedSearchResult[] = [];
  for (const target of await linkedTargets(input.owner, input.settings, warnings)) {
    const shards = await shardsForScope(target.store, input.scope, input.containerTag);
    if (shards.length === 0) continue;

    const reason = await embeddingMismatchReason(target.store, shards, input.settings);
    if (reason) {
      warnings.push(
        `Linked space "${target.name}" was ${reason}; skipped. Re-embed it to search it.`
      );
      continue;
    }

    try {
      const { results } = await tursoVectorSearch.searchAcrossShards(
        shards,
        input.queryVector,
        input.scope === "all-projects" ? "" : input.containerTag,
        room,
        input.settings.similarityThreshold,
        input.query,
        input.settings.keywordBoost,
        input.settings.keywordMode,
        (dbPath) => target.store.openShard(dbPath)
      );
      linked.push(...results.map((result) => ({ ...result, spaceName: target.name })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Linked space "${target.name}" could not be searched: ${message}; skipped.`);
      log("Linked space search failed", { space: target.name, error: message }, "warn");
    }
  }

  linked.sort((a, b) => b.similarity - a.similarity);
  return { results: linked.slice(0, room), warnings };
}

/** Lists the newest memories of the linked spaces, newest first, within `room`. */
export async function listLinkedSpaces(input: {
  scope: LinkedScope;
  containerTag: string;
  limit: number;
  ownCount: number;
  owner: LinkedOwner;
  settings: LinkedSearchSettings;
}): Promise<{ memories: ListedMemory[]; warnings: string[] }> {
  const warnings: string[] = [];
  const room = input.limit - input.ownCount;
  if (room <= 0) return { memories: [], warnings };

  const linked: ListedMemory[] = [];
  for (const target of await linkedTargets(input.owner, input.settings, warnings)) {
    const shards = await shardsForScope(target.store, input.scope, input.containerTag);
    if (shards.length === 0) continue;

    const reason = await embeddingMismatchReason(target.store, shards, input.settings);
    if (reason) {
      warnings.push(
        `Linked space "${target.name}" was ${reason}; skipped. Re-embed it to search it.`
      );
      continue;
    }

    try {
      for (const shard of shards) {
        const db = await target.store.openShard(shard.dbPath);
        const rows = await tursoVectorSearch.listMemories(
          db,
          input.scope === "all-projects" ? "" : input.containerTag,
          room
        );
        linked.push(...rows.map((row) => ({ ...mapListedMemory(row), spaceName: target.name })));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Linked space "${target.name}" could not be read: ${message}; skipped.`);
      log("Linked space list failed", { space: target.name, error: message }, "warn");
    }
  }

  linked.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { memories: linked.slice(0, room), warnings };
}

/**
 * Finds the linked space a memory id belongs to, for the refusal of `forget`:
 * a linked space is read-only, so the id is looked up, never changed. Returns
 * the space display name, or null when no linked space holds the id.
 */
/** The refusal a write gets when the memory belongs to a linked, read-only space. */
export function linkedRefusal(name: string): { success: false; error: string } {
  return {
    success: false,
    error: `This memory belongs to "${name}", a linked read-only space. Switch to that space to change it.`,
  };
}

export async function findLinkedMemoryOwner(
  memoryId: string,
  owner: LinkedOwner,
  settings: LinkedSearchSettings
): Promise<{ name: string } | null> {
  const warnings: string[] = [];
  for (const target of await linkedTargets(owner, settings, warnings)) {
    if (!target.store.hasMetadata) continue;
    const shards = [
      ...(await target.store.listShards("user", "")),
      ...(await target.store.listShards("project", "")),
    ];
    for (const shard of shards) {
      const db = await target.store.openShard(shard.dbPath);
      const row = await db.get(`SELECT id FROM memories WHERE id = ?`, [memoryId]);
      if (row) return { name: target.name };
    }
  }
  return null;
}
