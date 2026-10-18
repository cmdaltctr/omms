import type { ChatRuntimeConfig } from "./chat/chat-runtime.js";
import { routeChat, type RouteResult } from "./chat/chat-routes.js";
import { routeMemoryHosts } from "./memory-host-routes.js";
import { routeProfileCleanup } from "./profile-cleanup-routes.js";

/**
 * Route modules that live outside web-server.ts, which sits at its size
 * ceiling. Each returns undefined for paths it does not own. The request body
 * is read once, and only by a route that needs it.
 */
export async function routeModules(
  path: string,
  method: string,
  url: URL,
  req: Request,
  config: ChatRuntimeConfig
): Promise<RouteResult | undefined> {
  let body: Promise<any> | undefined;
  const readBody = () => (body ??= req.json().catch(() => ({})));

  const cleanup = await routeProfileCleanup(path, method, url, readBody);
  if (cleanup !== undefined) return { status: 200, body: cleanup };

  const hosts = await routeMemoryHosts(path, method, url, readBody, config);
  if (hosts !== undefined) return hosts;

  return routeChat(path, method, readBody, config);
}
