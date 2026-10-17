import * as aiCleanup from "./ai-cleanup-handlers.js";
import * as autoCleanup from "./auto-cleanup-handlers.js";

/**
 * The profile cleanup routes: AI Cleanup (start, status, stop, apply) and the undo of the
 * last automatic cleanup. Returns the JSON body, or undefined when the path and method are
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

  return undefined;
}
