import { extractScopeFromContainerTag } from "../memory-scope.js";
import { CONFIG } from "../../config.js";
import {
  ensureTursoReady,
  tursoConnectionManager,
  tursoShardManager,
  tursoVectorSearch,
  type ShardInfo,
} from "./shards.js";

/** The one place the API handlers read CONFIG. Groups pass it on as an argument. */
export function apiConfig(): typeof CONFIG {
  return CONFIG;
}

export async function getAllMemoryShards(): Promise<ShardInfo[]> {
  await ensureTursoReady();
  const projectShards = await tursoShardManager.getAllShards("project", "");
  const userShards = await tursoShardManager.getAllShards("user", "");
  return [...projectShards, ...userShards];
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function safeToISOString(timestamp: any): string {
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

export function safeJSONParse(jsonString: any): any {
  if (!jsonString || typeof jsonString !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

export function extractScopeFromTag(tag: string): { scope: "user" | "project"; hash: string } {
  return extractScopeFromContainerTag(tag);
}

export function getProjectPathFromTag(tag: string): Promise<string | undefined> {
  return (async () => {
    const shards = await getAllMemoryShards();
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const tags = await tursoVectorSearch.getDistinctTags(db);
      for (const t of tags) {
        if (t.container_tag === tag && t.project_path) {
          return String(t.project_path);
        }
      }
    }
    return undefined;
  })();
}
