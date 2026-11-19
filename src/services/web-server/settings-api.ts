import { log } from "../logger.js";
import { testReranker } from "../reranker-test.js";
import { isLoopbackHost } from "../web-api-auth.js";
import { HOSTS, hostChoiceMessage, isMemoryHost, type MemoryHost } from "../../shared/hosts.js";
import { importResponse, type RouteHost } from "./route-host.js";
import {
  catchUpRoute,
  embeddingRoute,
  profilesRoute,
  tokenRoute,
  webPasswordRoute,
} from "./settings-admin.js";
import { jsonResponse } from "./static-files.js";

/** The /api/settings/* routes and the /api/web/* routes, or null for any other path. */
export async function routeSettingsApi(
  web: RouteHost,
  req: Request,
  url: URL,
  remoteAddress: string | undefined
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;
  const auth = web.config.auth;

  if (path === "/api/settings" && method === "GET") {
    const { getSettingsSnapshot } = await import("../settings-snapshot.js");
    const snapshot = getSettingsSnapshot(
      web.config.directory ?? process.cwd(),
      await web.loadConfig()
    );
    // The Keys card needs evidence that Claude Code uses OMMS; the default folder is not enough.
    let attempts = false;
    try {
      const { hasCaptureAttempts } = await import("../capture-attempt-store.js");
      attempts = await hasCaptureAttempts("claude-code");
    } catch {
      // No diagnostics store yet: no evidence.
    }
    return jsonResponse({
      ...snapshot,
      claudeCodeEvidence: { attempts, folderSet: snapshot.claudeFolder.source === "setting" },
    });
  }

  if (path === "/api/settings/backfill" && method === "GET") {
    const [{ CONFIG }, { readBackfillStatus, readUnresolvedReport, visibleUnresolvedCount }] =
      await Promise.all([web.loadConfig(), import("../storage/backfill-state.js")]);
    // Read at request time from the Directory maps list, so the badge and the
    // list agree and an Ignore click changes every badge at once. The list
    // hides ignored directories and directories with a saved map.
    const hidden = [
      ...(CONFIG.importIgnoredDirectories ?? []),
      ...CONFIG.importPathMaps.map((map) => map.from),
    ];
    const status = async (host: MemoryHost) => {
      const current = await readBackfillStatus(host);
      if (!current) return current;
      // A damaged list must not hide the host's status: keep the run's count.
      const saved = await readUnresolvedReport(host).catch(() => null);
      if (!saved) return current;
      // The list and its total come from one report; an older row has no total yet.
      const total = saved.total ?? current.counts.unresolved;
      const unresolved = visibleUnresolvedCount(total, saved.directories, hidden);
      return { ...current, counts: { ...current.counts, unresolved } };
    };
    const statuses = await Promise.all(HOSTS.map((host) => status(host)));
    return jsonResponse(Object.fromEntries(HOSTS.map((host, i) => [host, statuses[i]])));
  }

  if (path === "/api/settings/backfill/runs" && method === "GET") {
    return jsonResponse(await (await web.backfillControls()).status());
  }

  const backfillAction = new RegExp(
    `^/api/settings/backfill/(${HOSTS.join("|")})/(run|pause|resume)$`
  ).exec(path);
  if (backfillAction && method === "POST") {
    const host = backfillAction[1] as MemoryHost;
    const controls = await web.backfillControls();
    const cwd = web.config.directory ?? process.cwd();
    return importResponse(() =>
      backfillAction[2] === "pause"
        ? controls.pause(host)
        : backfillAction[2] === "resume"
          ? controls.resume(host, cwd)
          : controls.runNow(host, cwd)
    );
  }

  const control = await web.webControl(req, path, method, remoteAddress);
  if (control) return control;

  if (path === "/api/settings/version" && method === "GET") {
    const [{ packageVersion }, { globalCommandVersion, globalRelation }] = await Promise.all([
      import("../package-version.js"),
      import("../global-version.js"),
    ]);
    const running = packageVersion();
    const global = globalCommandVersion();
    return jsonResponse({
      running,
      global: global.version,
      globalPath: global.path,
      mismatch: global.version !== null && global.version !== running,
      relation: globalRelation(running, global.version),
    });
  }

  if (path === "/api/settings/web-autostart" && method === "GET") {
    const { webAutostartStatus } = await import("../web-autostart.js");
    return jsonResponse(webAutostartStatus());
  }

  if (path === "/api/settings" && method === "PATCH") {
    const body = (await req.json()) as { edits?: Record<string, unknown>; revision?: string };
    if (
      !body ||
      typeof body.edits !== "object" ||
      !body.edits ||
      Array.isArray(body.edits) ||
      typeof body.revision !== "string"
    ) {
      return jsonResponse({ error: "Edits and revision required" }, 400);
    }
    if (
      body.edits.captureTrace === true &&
      !isLoopbackHost(web.config.host) &&
      !auth?.isEnabled()
    ) {
      return jsonResponse({ error: "Tracing requires Basic Auth on network hosts" }, 403);
    }
    const { writeGlobalConfigKeys, ConfigConflictError } = await import("../../config-writer.js");
    // Turning the queue off clears the turns queued until now, read before the write.
    const clearUpTo =
      body.edits.captureRetryRetentionHours === 0 ? await lastQueuedRetry(web) : undefined;
    let result;
    try {
      result = await writeGlobalConfigKeys(body.edits, body.revision);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Invalid settings" },
        error instanceof ConfigConflictError ? 409 : 400
      );
    }
    // The file is already saved; a reload problem must not report the save as failed.
    try {
      const { refreshConfigIfChanged } = await web.loadConfig();
      refreshConfigIfChanged(web.config.directory ?? process.cwd());
    } catch (error) {
      log(
        "Settings saved, but reloading them failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "error"
      );
    }
    if (clearUpTo !== undefined) {
      // Turning the queue off removes waiting turns now, not at the next cleanup.
      try {
        const [{ CONFIG }, { clearCaptureRetriesUpTo }] = await Promise.all([
          web.loadConfig(),
          import("../storage/capture-retry-queue.js"),
        ]);
        await clearCaptureRetriesUpTo(CONFIG, clearUpTo);
      } catch (error) {
        log(
          "Settings saved, but clearing the capture retry queue failed",
          {
            code: error instanceof Error ? error.name : "unknown",
          },
          "error"
        );
      }
    }
    return jsonResponse(result);
  }

  if (path === "/api/settings/tokens" || path.startsWith("/api/settings/tokens/")) {
    return tokenRoute(web, req, path, method, remoteAddress);
  }
  if (path === "/api/settings/profiles" || path.startsWith("/api/settings/profiles/")) {
    const response = await profilesRoute(web, req, path, method);
    if (response) return response;
  }

  if (path.startsWith("/api/settings/profile/catch-up")) {
    const response = await catchUpRoute(web, req, path, method, remoteAddress);
    if (response) return response;
  }
  if (path === "/api/settings/web-password" && method === "POST") {
    return webPasswordRoute(web, req, remoteAddress);
  }

  if (path.startsWith("/api/settings/embedding")) {
    const response = await embeddingRoute(web, req, path, method, remoteAddress);
    if (response) return response;
  }

  if (path === "/api/settings/reranker/test") {
    const network = !isLoopbackHost(web.config.host) && !auth?.isEnabled();
    return testReranker(req, method, remoteAddress, network);
  }

  if (path === "/api/settings/import-maps" && method === "GET") {
    const [{ directoryMapsView, readStoreProjects }, { CONFIG }] = await Promise.all([
      web.importer.api(),
      web.loadConfig(),
    ]);
    // Every save on the page reloads this list; the store's projects rarely change.
    // A memory space switch moves the store, so the cache holds one store path.
    if (
      !web.storeProjects ||
      web.storeProjects.storagePath !== CONFIG.storagePath ||
      Date.now() - web.storeProjects.readAt > 60_000
    ) {
      web.storeProjects = {
        readAt: Date.now(),
        storagePath: CONFIG.storagePath,
        projects: readStoreProjects(web.config.directory ?? process.cwd()),
      };
    }
    const knownProjects = await web.storeProjects.projects;
    // An empty result is a failed read or no store yet; try again next time.
    if (!knownProjects.length) web.storeProjects = undefined;
    return jsonResponse(await directoryMapsView({ knownProjects }));
  }

  if (path === "/api/settings/models" && method === "GET") {
    const { listSettingsModels } = await web.importer.models();
    const host = url.searchParams.get("host");
    const models = isMemoryHost(host) ? await listSettingsModels(host) : null;
    if (!models) return jsonResponse({ error: "Invalid host" }, 400);
    return jsonResponse(models);
  }

  if (path === "/api/settings/last-saved" && method === "GET") {
    const { lastLiveSaves } = await import("../capture-attempt-store.js");
    return jsonResponse({ hosts: await lastLiveSaves() });
  }

  if (path === "/api/settings/diagnostics" && method === "GET") {
    const [{ queryCaptureAttempts }, { CONFIG }, { countCaptureRetries }] = await Promise.all([
      import("../capture-attempt-store.js"),
      web.loadConfig(),
      import("../storage/capture-retry-queue.js"),
    ]);
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 7));
    const host = url.searchParams.get("host") || undefined;
    if (host && !isMemoryHost(host)) {
      return jsonResponse({ error: "Invalid host" }, 400);
    }
    return jsonResponse({
      ...(await queryCaptureAttempts(Date.now() - days * 86400000, Date.now(), 100, host)),
      retryQueue: await countCaptureRetries(CONFIG),
    });
  }

  const retryNow = new RegExp(`^/api/settings/capture-retry/(${HOSTS.join("|")})/run$`).exec(path);
  if (retryNow && method === "POST") {
    const [{ CONFIG }, { requestCaptureRetryNow }] = await Promise.all([
      web.loadConfig(),
      import("../capture-retry-drain.js"),
    ]);
    const host = retryNow[1] as MemoryHost;
    return jsonResponse({ result: await requestCaptureRetryNow(host, CONFIG) });
  }

  if (path === "/api/settings/traces" && method === "GET") {
    const { listSettingsTraces } = await import("../settings-traces.js");
    return jsonResponse({ traces: await listSettingsTraces() });
  }

  if (path.startsWith("/api/settings/traces/") && (method === "GET" || method === "DELETE")) {
    const file = decodeURIComponent(path.slice("/api/settings/traces/".length));
    if (!/^capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) {
      return jsonResponse({ error: "Invalid trace file name" }, 400);
    }
    const { readSettingsTrace, deleteSettingsTrace } = await import("../settings-traces.js");
    if (method === "DELETE") {
      await deleteSettingsTrace(file);
      return jsonResponse({ deleted: true });
    }
    return jsonResponse({ file, content: await readSettingsTrace(file) });
  }

  if (path === "/api/settings/health" && method === "POST") {
    const body = (await req.json()) as { testModels?: unknown };
    if (
      !body ||
      typeof body !== "object" ||
      (body.testModels !== undefined && typeof body.testModels !== "boolean")
    ) {
      return jsonResponse({ error: "Invalid health options" }, 400);
    }
    const { runSettingsHealth } = await web.importer.health();
    return jsonResponse(
      await runSettingsHealth({
        directory: web.config.directory ?? process.cwd(),
        host: web.config.host,
        authEnabled: auth?.isEnabled() ?? false,
        apiTokenSet: (await import("../api-tokens.js")).hasUnexpiredApiToken(),
        testModels: body.testModels === true,
      })
    );
  }

  if (path === "/api/settings/imports/readiness" && method === "GET") {
    const { importReadiness } = await web.importer.api();
    return jsonResponse(await importReadiness({ directory: web.config.directory }));
  }

  if (path === "/api/settings/imports/sources/browse" && method === "POST") {
    // Listing folders would expose the machine's layout to remote users.
    if (!isLoopbackHost(web.config.host)) {
      return jsonResponse(
        { error: "Browsing is available only on a loopback bind; enter a path instead" },
        403
      );
    }
    const body = (await req.json()) as { host?: unknown; path?: unknown };
    if (!isMemoryHost(body?.host)) {
      return jsonResponse({ error: hostChoiceMessage() }, 400);
    }
    const [{ browseImportSources }, { CONFIG }] = await Promise.all([
      web.importer.api(),
      web.loadConfig(),
    ]);
    return importResponse(() =>
      browseImportSources(body.host as MemoryHost, body.path, CONFIG.claudeConfigDir)
    );
  }

  if (path === "/api/settings/imports/sources/validate" && method === "POST") {
    const body = (await req.json()) as { host?: unknown; path?: unknown };
    if (!isMemoryHost(body?.host)) {
      return jsonResponse({ error: hostChoiceMessage() }, 400);
    }
    const { validateImportSource } = await web.importer.api();
    return importResponse(() => validateImportSource(body.host as MemoryHost, body.path));
  }

  if (path === "/api/settings/imports/sessions" && method === "POST") {
    const body = (await req.json()) as Record<string, unknown> | null;
    const { listImportSessions, validateSessionListRequest } = await web.importer.api();
    return importResponse(async () => {
      const request = validateSessionListRequest(body);
      return listImportSessions(request, {
        ...request.match,
        cwd: web.config.directory ?? process.cwd(),
      });
    });
  }

  if (path === "/api/settings/imports" && method === "POST") {
    const jobs = await web.importJobs();
    return importResponse(
      async () => jobs.start(await req.json(), web.config.directory ?? process.cwd()),
      202
    );
  }

  if (path === "/api/settings/imports/current" && method === "GET") {
    return jsonResponse({ job: (await web.importJobs()).current() });
  }

  if (path === "/api/settings/imports/current/cancel" && method === "POST") {
    try {
      return jsonResponse({ job: (await web.importJobs()).cancel() });
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "No running import" },
        409
      );
    }
  }

  if (path === "/api/settings/log" && method === "GET") {
    const { readSettingsLog } = await import("../settings-log.js");
    return jsonResponse(await readSettingsLog(Object.fromEntries(url.searchParams)));
  }
  return null;
}

/** The capture retry queue's newest row id. A failed read clears every row, as before. */
async function lastQueuedRetry(web: RouteHost): Promise<number> {
  try {
    const [{ CONFIG }, { lastCaptureRetryId }] = await Promise.all([
      web.loadConfig(),
      import("../storage/capture-retry-queue.js"),
    ]);
    return await lastCaptureRetryId(CONFIG);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
