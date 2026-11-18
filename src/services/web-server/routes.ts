import { extname } from "node:path";
import { log } from "../logger.js";
import { corsPreflightResponse, disallowedCorsResponse, isAllowedBrowserOrigin } from "../cors.js";
import { authorizeApiRequest, isLoopbackHost } from "../web-api-auth.js";
import { healthBody } from "../health-body.js";
import { packageVersion } from "../package-version.js";
import { isAuthorizedApiRequest } from "../auth-token.js";
import { handleUpdateProfileItem } from "../api-handlers.js";
import { routeModules } from "../web-route-modules.js";
import { routeMemoryApi } from "./memory-api.js";
import type { RouteHost } from "./route-host.js";
import { routeSettingsApi } from "./settings-api.js";
import { contentTypeFor, jsonResponse } from "./static-files.js";
import { PROCESS_INSTANCE } from "./web-control.js";

/**
 * Route one request: CORS, Basic Auth and the API token first, then the
 * health check, the web UI files, and the API routes in their fixed order.
 */
export async function routeRequest(
  web: RouteHost,
  req: Request,
  remoteAddress?: string
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const origin = req.headers.get("Origin");
  const auth = web.config.auth;
  const corsOptions = { httpAuthEnabled: auth?.isEnabled() ?? false };

  if (!isAllowedBrowserOrigin(origin, corsOptions)) {
    return disallowedCorsResponse();
  }

  if (method === "OPTIONS") {
    return corsPreflightResponse(req, corsOptions);
  }

  if (auth?.isEnabled()) {
    const authCheck = auth.check(req, path);
    if (!authCheck.ok && authCheck.response) return authCheck.response;
  }

  if (
    path.startsWith("/api/") &&
    path !== "/api/health" &&
    !(path.startsWith("/api/settings") && auth?.isEnabled()) &&
    !isAuthorizedApiRequest(req)
  ) {
    const tokenFailure = authorizeApiRequest(req);
    if (tokenFailure) {
      if (path === "/api/web/step-aside") {
        log("Web server step-aside request", {
          outcome: "refused_auth",
          ownVersion: packageVersion(),
          callerVersion: "",
        });
      }
      if (method === "POST" && (path === "/api/web/stop" || path === "/api/web/restart")) {
        log("Web server power request", {
          action: path === "/api/web/stop" ? "stop" : "restart",
          outcome: "refused_auth",
          ownVersion: packageVersion(),
        });
      }
      return tokenFailure;
    }
  }

  if (/^\/api\/(settings|skills(\/|$))/.test(path) && !["GET", "HEAD"].includes(method)) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
      return jsonResponse({ error: "JSON content type required" }, 415);
    }
    if (!isLoopbackHost(web.config.host) && !auth?.isEnabled()) {
      const denied = authorizeApiRequest(req);
      if (denied) return denied;
    }
  }

  try {
    if (path === "/api/health" && method === "GET") {
      const { CONFIG: config } = await web.loadConfig();
      const authEnabled = auth?.isEnabled() ?? false;
      return jsonResponse(healthBody({ authEnabled, instance: PROCESS_INSTANCE, config }));
    }

    if (path === "/" || path === "/index.html" || path === "/settings" || path === "/memory") {
      return web.serveStaticFile("index.html", "text/html");
    }

    if (path === "/favicon.ico") {
      return web.serveStaticFile("favicon.ico", "image/x-icon");
    }

    // Vite production assets (hashed JS/CSS/fonts) and other static files.
    if (method === "GET" && !path.startsWith("/api/")) {
      const relative = path.replace(/^\/+/, "");
      if (relative && !relative.includes("..")) {
        const staticResponse = web.serveStaticFile(relative, contentTypeFor(relative));
        if (staticResponse.status !== 404) {
          return staticResponse;
        }
      }
    }

    const settings = await routeSettingsApi(web, req, url, remoteAddress);
    if (settings) return settings;

    const memory = await routeMemoryApi(web, req, url);
    if (memory) return memory;
    const routed = await routeModules(path, method, url, req, {
      cwd: web.config.directory ?? process.cwd(),
      configModule: await web.loadConfig(),
      remoteAddress,
      startRecordPast: async (cwd) =>
        (await web.importer.api()).startRecordPast(web.importJobs, cwd),
      settings: {
        networkWithoutAuth: !isLoopbackHost(web.config.host) && !auth?.isEnabled(),
        testExternalApi: async (given) => (await web.importer.api()).testExternalApi(given),
      },
    });
    if (routed) return routed.response ?? jsonResponse(routed.body, routed.status);

    if (path === "/api/user-profile/item" && method === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as any;
      const result = await handleUpdateProfileItem(body);
      return jsonResponse(result);
    }

    // SPA fallback for client routes (e.g. /profile) — serve the app shell.
    if (method === "GET" && !path.startsWith("/api/") && !extname(path)) {
      return web.serveStaticFile("index.html", "text/html");
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: String(error),
      },
      500
    );
  }
}
