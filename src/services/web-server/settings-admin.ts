import { isAuthorizedApiRequest } from "../auth-token.js";
import { isLoopbackAddress } from "../web-api-auth.js";
import type { RouteHost } from "./route-host.js";
import { jsonResponse } from "./static-files.js";

// Settings routes that only a caller on this machine may change.

/** API token routes. Only a caller on this machine with the local token manages tokens. */
export async function tokenRoute(
  web: RouteHost,
  req: Request,
  path: string,
  method: string,
  remoteAddress: string | undefined
): Promise<Response> {
  if (!isLoopbackAddress(remoteAddress)) {
    return jsonResponse({ error: "Only this machine can manage API tokens" }, 403);
  }
  if (!isAuthorizedApiRequest(req)) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  const tokens = await import("../api-tokens.js");
  if (path === "/api/settings/tokens" && method === "GET") {
    return jsonResponse({ tokens: tokens.listApiTokens() });
  }
  if (path === "/api/settings/tokens" && method === "POST") {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    try {
      const expiry = body?.expiresInDays ?? null;
      return jsonResponse(
        tokens.createApiToken(
          String(body?.name ?? ""),
          expiry as import("../api-tokens.js").TokenExpiryDays
        ),
        201
      );
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Token not created" },
        400
      );
    }
  }
  const revoke = /^\/api\/settings\/tokens\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (revoke && method === "DELETE") {
    return tokens.revokeApiToken(revoke[1]!)
      ? jsonResponse({ success: true })
      : jsonResponse({ error: "Token not found" }, 404);
  }
  return jsonResponse({ error: "Not found" }, 404);
}

/** Profile catch-up: a preview for anyone with API access; runs only from this machine. */
export async function catchUpRoute(
  web: RouteHost,
  req: Request,
  path: string,
  method: string,
  remoteAddress: string | undefined
): Promise<Response | null> {
  const catchUp = await web.importer.api();
  if (path === "/api/settings/profile/catch-up" && method === "GET") {
    return jsonResponse({
      preview: await catchUp.previewCatchUp(),
      job: catchUp.catchUpState(),
    });
  }
  const action = /^\/api\/settings\/profile\/catch-up\/(start|pause|resume)$/.exec(path)?.[1];
  if (!action || method !== "POST") return null;
  if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
    return jsonResponse({ error: "Only this machine can run a profile catch-up" }, 403);
  }
  if (action === "pause") return jsonResponse(catchUp.pauseCatchUp());
  try {
    const job = await catchUp.startCatchUp(web.config.directory ?? process.cwd());
    return jsonResponse(job, 202);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Catch-up not started" },
      (error as { status?: number }).status ?? 400
    );
  }
}

/** List active profiles, choose the one in use, or merge one into another. */
export async function profilesRoute(
  web: RouteHost,
  req: Request,
  path: string,
  method: string
): Promise<Response | null> {
  const { userProfileManager } = await import("../user-profile/user-profile-manager.js");
  const { listProfiles, mergeProfiles, ProfileAdminError } = await import("../profile-admin.js");
  const { resolveWebProfileUserId } = await import("../profile-identity.js");
  const { CONFIG, refreshConfigIfChanged } = await web.loadConfig();
  const store = userProfileManager;
  if (path === "/api/settings/profiles" && method === "GET") {
    const current = await resolveWebProfileUserId(CONFIG);
    return jsonResponse({ profiles: await listProfiles(store, current) });
  }
  if (method !== "POST") return null;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (path === "/api/settings/profiles/use") {
      const userId = typeof body?.userId === "string" ? body.userId : "";
      if (typeof body?.revision !== "string") {
        return jsonResponse({ error: "Revision required" }, 400);
      }
      const active = await store.getAllActiveProfiles();
      if (!active.some((profile) => profile.userId === userId)) {
        return jsonResponse({ error: "No active profile has that email" }, 404);
      }
      const { writeGlobalConfigKeys } = await import("../../config-writer.js");
      const result = await writeGlobalConfigKeys({ userEmailOverride: userId }, body.revision, {
        only: new Set(["userEmailOverride"]),
      });
      refreshConfigIfChanged(web.config.directory ?? process.cwd());
      return jsonResponse(result);
    }
    if (path === "/api/settings/profiles/merge") {
      const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
      const targetId = typeof body?.targetId === "string" ? body.targetId : "";
      return jsonResponse(await mergeProfiles(store, sourceId, targetId));
    }
  } catch (error) {
    const status =
      error instanceof ProfileAdminError
        ? error.status
        : ((error as { status?: number }).status ?? 400);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Profile change failed" },
      status
    );
  }
  return null;
}

/** Set or clear the browser password. The body holds the password: never log or echo it. */
export async function webPasswordRoute(
  web: RouteHost,
  req: Request,
  remoteAddress: string | undefined
): Promise<Response> {
  if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
    return jsonResponse({ error: "Only this machine can change the browser password" }, 403);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (typeof body?.revision !== "string") {
    return jsonResponse({ error: "Revision required" }, 400);
  }
  try {
    const { clearWebPassword, saveWebPassword } = await import("../web-password.js");
    const result =
      body.clear === true
        ? await clearWebPassword(body.revision)
        : await saveWebPassword(
            password,
            typeof body.username === "string" ? body.username : undefined,
            body.revision
          );
    const { refreshConfigIfChanged } = await web.loadConfig();
    refreshConfigIfChanged(web.config.directory ?? process.cwd());
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password not saved";
    return jsonResponse(
      { error: password ? message.replaceAll(password, "[redacted]") : message },
      (error as { status?: number }).status ?? 400
    );
  }
}

/** Embedding card routes. Changing the embedder needs a caller on this machine with the local token. */
export async function embeddingRoute(
  web: RouteHost,
  req: Request,
  path: string,
  method: string,
  remoteAddress: string | undefined
): Promise<Response | null> {
  const change = await import("../embedding-change.js");
  if (path === "/api/settings/embedding" && method === "GET") {
    return jsonResponse(await change.currentEmbedding((await web.loadConfig()).CONFIG));
  }
  if (path === "/api/settings/embedding/run" && method === "GET") {
    return jsonResponse(change.embeddingRunState());
  }
  const routes = ["/api/settings/embedding/test", "/api/settings/embedding/apply"];
  if (method !== "POST" || ![...routes, "/api/settings/embedding/run"].includes(path)) return null;
  if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
    return jsonResponse({ error: "Only this machine can change the embedder" }, 403);
  }
  // The body can hold a pasted key: never log it, and never echo it back.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pasted = (body?.candidate ?? body) as { key?: { value?: unknown } } | null;
  const secret = typeof pasted?.key?.value === "string" ? pasted.key.value.trim() : "";
  try {
    if (path === "/api/settings/embedding/test") {
      return jsonResponse(
        await change.testEmbeddingCandidate(
          change.parseEmbeddingCandidate(body),
          (await web.loadConfig()).CONFIG
        )
      );
    }
    if (path === "/api/settings/embedding/run") {
      await change.startReembed();
      return jsonResponse(change.embeddingRunState(), 202);
    }
    if (typeof body?.revision !== "string") {
      return jsonResponse({ error: "Revision required" }, 400);
    }
    const configModule = await web.loadConfig();
    await change.applyEmbeddingCandidate(
      change.parseEmbeddingCandidate(body.candidate),
      body.revision,
      () => {
        configModule.refreshConfigIfChanged(web.config.directory ?? process.cwd());
      },
      configModule.CONFIG
    );
    return jsonResponse(change.embeddingRunState(), 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedder not changed";
    const status = (error as { status?: number }).status ?? 400;
    return jsonResponse(
      { error: secret ? message.replaceAll(secret, "[redacted]") : message },
      status
    );
  }
}
