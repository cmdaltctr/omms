import {
  handleListTags,
  handleListKeywords,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleRunCleanup,
  handleRunDeduplication,
  handleDetectMigration,
  handleRunMigration,
  handleDetectTagMigration,
  handleRunTagMigrationBatch,
  handleGetTagMigrationProgress,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
} from "../api-handlers.js";
import type { RouteHost } from "./route-host.js";
import { jsonResponse } from "./static-files.js";

/** Claude Code hook requests; they reach this point only with a valid API token. */
async function claudeHookResponse(web: RouteHost, req: Request, path: string): Promise<Response> {
  const api = await web.importer.claudeHook();
  const body: unknown = await req.json().catch(() => null);
  try {
    if (path === "/api/claude/capture") {
      return jsonResponse(api.handleClaudeCapture(body), 202);
    }
    if (path === "/api/claude/notices") return jsonResponse(api.handleClaudeNoticesShown(body));
    const cwd = web.config.directory ?? process.cwd();
    return jsonResponse(
      await api.handleClaudeRetrieve(body, {
        startBackfill: async () => (await web.backfillControls()).startAuto("claude-code", cwd),
      })
    );
  } catch (error) {
    if (error instanceof api.ClaudeHookRequestError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    throw error;
  }
}

/** The memory, prompt and profile routes, and the Claude Code hooks; null for any other path. */
export async function routeMemoryApi(
  web: RouteHost,
  req: Request,
  url: URL
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/tags" && method === "GET") {
    const result = await handleListTags();
    return jsonResponse(result);
  }

  if (path === "/api/keywords" && method === "GET") {
    const result = await handleListKeywords(url.searchParams.get("tag") || undefined);
    return jsonResponse(result);
  }

  if (path === "/api/memories" && method === "GET") {
    const tag = url.searchParams.get("tag") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("pageSize") || "20");
    const includePrompts = url.searchParams.get("includePrompts") !== "false";
    const keyword = url.searchParams.get("keyword") || undefined;
    const result = await handleListMemories(tag, page, pageSize, includePrompts, keyword);
    return jsonResponse(result);
  }

  if (path === "/api/memories" && method === "POST") {
    const body = (await req.json()) as any;
    const result = await handleAddMemory(body);
    return jsonResponse(result);
  }

  if (path.startsWith("/api/memories/") && method === "DELETE") {
    const parts = path.split("/");
    const id = parts[3];
    if (!id || id === "bulk-delete") {
      return jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeleteMemory(id, cascade);
    return jsonResponse(result);
  }

  if (path.startsWith("/api/memories/") && method === "PUT") {
    const id = path.split("/").pop();
    if (!id) {
      return jsonResponse({ success: false, error: "Invalid ID" });
    }
    const body = (await req.json()) as any;
    const result = await handleUpdateMemory(id, body);
    return jsonResponse(result);
  }

  if (path === "/api/memories/bulk-delete" && method === "POST") {
    const body = (await req.json()) as any;
    const cascade = body.cascade !== false;
    const result = await handleBulkDelete(body.ids || [], cascade);
    return jsonResponse(result);
  }

  if (path === "/api/search" && method === "GET") {
    const query = url.searchParams.get("q");
    const tag = url.searchParams.get("tag") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("pageSize") || "20");

    if (!query) {
      return jsonResponse({ success: false, error: "query parameter required" });
    }

    const result = await handleSearch(query, tag, page, pageSize);
    return jsonResponse(result);
  }

  if (/^\/api\/claude\/(retrieve|capture|notices)$/.test(path) && method === "POST") {
    return claudeHookResponse(web, req, path);
  }

  if (path === "/api/stats" && method === "GET") {
    const result = await handleStats();
    return jsonResponse(result);
  }

  if (path.match(/^\/api\/memories\/[^/]+\/pin$/) && method === "POST") {
    const id = path.split("/")[3];
    if (!id) {
      return jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = await handlePinMemory(id);
    return jsonResponse(result);
  }

  if (path.match(/^\/api\/memories\/[^/]+\/unpin$/) && method === "POST") {
    const id = path.split("/")[3];
    if (!id) {
      return jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = await handleUnpinMemory(id);
    return jsonResponse(result);
  }

  if (path === "/api/cleanup" && method === "POST") {
    const result = await handleRunCleanup(await web.loadConfig());
    return jsonResponse(result);
  }

  if (path === "/api/deduplicate" && method === "POST") {
    const result = await handleRunDeduplication(await web.loadConfig());
    return jsonResponse(result);
  }

  if (path === "/api/migration/detect" && method === "GET") {
    const result = await handleDetectMigration();
    return jsonResponse(result);
  }

  if (path === "/api/migration/tags/detect" && method === "GET") {
    const result = await handleDetectTagMigration();
    return jsonResponse(result);
  }

  if (path === "/api/migration/tags/run-batch" && method === "POST") {
    const body = (await req.json()) as any;
    const batchSize = body?.batchSize || 5;
    const result = await handleRunTagMigrationBatch(await web.loadConfig(), batchSize);
    return jsonResponse(result);
  }

  if (path === "/api/migration/tags/progress" && method === "GET") {
    const result = await handleGetTagMigrationProgress();
    return jsonResponse(result);
  }

  if (path === "/api/migration/run" && method === "POST") {
    const body = (await req.json()) as any;
    const strategy = body.strategy || "fresh-start";
    if (strategy !== "fresh-start" && strategy !== "re-embed") {
      return jsonResponse({ success: false, error: "Invalid strategy" });
    }
    const result = await handleRunMigration(strategy);
    return jsonResponse(result);
  }

  if (path.startsWith("/api/prompts/") && method === "DELETE") {
    const parts = path.split("/");
    const id = parts[3];
    if (!id || id === "bulk-delete") {
      return jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeletePrompt(id, cascade);
    return jsonResponse(result);
  }

  if (path === "/api/prompts/bulk-delete" && method === "POST") {
    const body = (await req.json()) as any;
    const cascade = body.cascade !== false;
    const result = await handleBulkDeletePrompts(body.ids || [], cascade);
    return jsonResponse(result);
  }

  if (path === "/api/user-profile" && method === "GET") {
    const userId = url.searchParams.get("userId") || undefined;
    const result = await handleGetUserProfile(await web.loadConfig(), userId);
    return jsonResponse(result);
  }

  if (path === "/api/user-profile/changelog" && method === "GET") {
    const profileId = url.searchParams.get("profileId");
    const limit = parseInt(url.searchParams.get("limit") || "5");
    if (!profileId) {
      return jsonResponse({ success: false, error: "profileId parameter required" });
    }
    const result = await handleGetProfileChangelog(profileId, limit);
    return jsonResponse(result);
  }

  if (path === "/api/user-profile/snapshot" && method === "GET") {
    const changelogId = url.searchParams.get("chlogId");
    if (!changelogId) {
      return jsonResponse({ success: false, error: "changelogId parameter required" });
    }
    const result = await handleGetProfileSnapshot(changelogId);
    return jsonResponse(result);
  }

  if (path === "/api/user-profile/refresh" && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const userId = body.userId || undefined;
    const result = await handleRefreshProfile(await web.loadConfig(), userId);
    return jsonResponse(result);
  }
  return null;
}
