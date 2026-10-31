import * as aiCleanup from "./ai-cleanup-handlers.js";
import * as autoCleanup from "./auto-cleanup-handlers.js";
import * as categoryCleanup from "./api-handlers.js";

/**
 * The profile cleanup routes: AI Cleanup (start, status, stop, apply), the undo of the
 * last automatic cleanup, and category cleanup (start, status, apply, undo). Returns the JSON body, or undefined when the path and method are
 * not a cleanup route. The body is read only for the routes that need it.
 */
export async function routeProfileCleanup(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<any>
): Promise<unknown | undefined> {
  const queryUser = url.searchParams.get("userId") || undefined;

  if (path === "/api/user-profile/ai-cleanup") {
    if (method === "POST") {
      const body = await readBody();
      return aiCleanup.handleAiCleanupStart(body.userId, body);
    }
    if (method === "GET") return aiCleanup.handleAiCleanupStatus(queryUser);
    if (method === "DELETE") return aiCleanup.handleAiCleanupStop(queryUser);
  }

  if (path === "/api/user-profile/ai-cleanup/apply" && method === "POST") {
    const body = await readBody();
    return aiCleanup.handleAiCleanupApply(body.userId, body);
  }

  if (path === "/api/user-profile/auto-cleanup" && method === "GET") {
    return autoCleanup.handleAutoCleanupStatus(queryUser);
  }

  if (path === "/api/user-profile/auto-cleanup/undo" && method === "POST") {
    const body = await readBody();
    return autoCleanup.handleAutoCleanupUndo(body.userId || undefined);
  }

  if (path === "/api/user-profile/category-cleanup") {
    if (method === "POST") {
      const body = await readBody();
      return categoryCleanup.handleCategoryCleanupStart(body.userId || undefined);
    }
    if (method === "GET") return categoryCleanup.handleCategoryCleanupStatus(queryUser);
  }

  if (path === "/api/user-profile/category-cleanup/apply" && method === "POST") {
    const body = await readBody();
    return categoryCleanup.handleCategoryCleanupApply(body.userId || undefined, body);
  }

  if (path === "/api/user-profile/category-cleanup/undo" && method === "POST") {
    const body = await readBody();
    return categoryCleanup.handleCategoryCleanupUndo(body.userId || undefined);
  }

  return undefined;
}
