const values: Record<string, unknown> = {
  opencodeProvider: "example",
  opencodeModel: "preview-model",
  piProvider: "inherit",
  piModel: "inherit",
  memoryProvider: "openai-chat",
  memoryApiUrl: "https://synthetic.invalid/v1",
  memoryModel: "example/model-preview",
  autoBackfill: false,
  opencodeBackfillModel: "external",
  piBackfillModel: "inherit",
  captureTrace: false,
  captureTraceRetentionDays: 7,
  captureAttemptRetentionDays: 30,
  captureRetryRetentionHours: 72,
  importPathMaps: [{ from: "/synthetic/old-project", to: "/synthetic/preview-project" }],
  claudeConfigDir: "/synthetic/claude",
  webServerAutoStart: false,
};
const unset = { set: false, source: null, reference: null };
let revision = 1;

function snapshot() {
  return {
    revision: `fixture-${revision}`,
    settings: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { value, globalValue: value, source: "global" },
      ])
    ),
    secrets: {
      memoryApiKey: unset,
      embeddingApiKey: unset,
      webServerApiToken: unset,
      webServerAuthPassword: unset,
    },
    fallback: { model: "example/model-preview", configured: false },
    externalKey: { source: null, reference: null, resolvesInWebApp: false, warning: null },
    effective: {
      opencode: { ready: true, mode: "manual" },
      pi: { kind: "session" },
      "claude-code": { ready: false, mode: "external", issues: ["memoryApiKey"] },
    },
    claudeFolder: { root: "/synthetic/claude/projects", source: "setting", exists: false },
    access: {
      host: "127.0.0.1",
      authEnabled: false,
      authUsername: "preview",
      tokenAvailable: false,
      embeddingApiUrl: null,
      configTokenIgnored: false,
    },
    claudeCodeEvidence: { attempts: true, folderSet: true },
  };
}

/** Settings-shaped examples. Only the declared PATCH changes in-memory fixture values. */
export function settingsResponse(
  method: string,
  path: string,
  body?: unknown
): { status: number; body: unknown } | undefined {
  if (!path.startsWith("/api/settings")) return;
  const ok = (data: unknown) => ({ status: 200, body: data });
  if (method === "PATCH" && path === "/api/settings") {
    const edits = (body as { edits?: Record<string, unknown> })?.edits ?? {};
    for (const [key, value] of Object.entries(edits)) {
      if (Object.hasOwn(values, key)) values[key] = value;
    }
    revision++;
    return ok({ migratedLegacy: false });
  }
  if (method !== "GET")
    return { status: 405, body: { success: false, error: "Synthetic operation disabled" } };
  switch (path) {
    case "/api/settings":
      return ok(snapshot());
    case "/api/settings/models":
      return ok({
        available: true,
        models: [{ provider: "example", model: "preview-model", name: "Synthetic model" }],
      });
    case "/api/settings/embedding":
      return ok({
        kind: "builtin",
        url: null,
        model: "synthetic-embedding",
        dimensions: 768,
        memoryCount: 2,
        run: { state: "idle", progress: { processed: 0, total: 0 } },
      });
    case "/api/settings/tokens":
      return ok({ tokens: [] });
    case "/api/settings/profile/catch-up":
      return ok({
        preview: { waiting: 12, calls: 1 },
        job: { state: "paused", batchesBuilt: 1, remaining: 12 },
      });
    case "/api/settings/profiles":
      return ok({
        profiles: [
          {
            id: "preview-a",
            userId: "synthetic-a",
            displayName: "Synthetic preview",
            preferences: 1,
            patterns: 1,
            workflows: 1,
            totalPromptsAnalyzed: 12,
            lastAnalyzedAt: 1791028800000,
            inUse: true,
          },
          {
            id: "preview-b",
            userId: "synthetic-b",
            displayName: "Second synthetic profile",
            preferences: 1,
            patterns: 0,
            workflows: 0,
            totalPromptsAnalyzed: 3,
            lastAnalyzedAt: 1791028800000,
            inUse: false,
          },
        ],
      });
    case "/api/settings/import-maps":
      return ok({
        saved: values.importPathMaps,
        pi: [
          {
            directory: "/synthetic/old-project",
            sessions: 2,
            suggestion: "/synthetic/preview-project",
          },
        ],
        opencode: [],
        "claude-code": [],
      });
    case "/api/settings/diagnostics":
      return ok({
        byModel: [
          {
            host: "opencode",
            provider: "example",
            model: "preview-model",
            total: 5,
            saved: 3,
            skipped: 1,
            failed: 1,
          },
        ],
        byReason: [{ host: "opencode", reason: "timeout", count: 1 }],
        recent: [],
        retryQueue: { opencode: 1, pi: 0, "claude-code": 0 },
      });
    case "/api/settings/traces":
      return ok({ traces: [] });
    case "/api/settings/backfill":
      return ok({ opencode: null, pi: null, "claude-code": null });
    case "/api/settings/backfill/runs":
      return ok(
        Object.fromEntries(
          ["opencode", "pi", "claude-code"].map((host) => [
            host,
            { run: null, runNowUnavailable: "Synthetic preview" },
          ])
        )
      );
    case "/api/settings/imports/readiness":
      return ok({
        external: { state: "missing", missing: ["memoryApiKey"] },
        opencode: { available: false, models: [], reason: "Synthetic preview" },
        piReader: { available: true },
        claudeCode: {
          available: true,
          defaultRoot: "/synthetic/claude/projects",
          defaultRootFound: false,
          modelChoices: ["external"],
        },
      });
    case "/api/settings/imports/current":
      return ok({ job: null });
    case "/api/settings/web-autostart":
      return ok({ state: "not installed" });
    case "/api/settings/version":
      return ok({ running: "4.4.1", global: "4.4.1", relation: "same" });
    case "/api/settings/log":
      return ok({
        path: "/synthetic/omms/logs/omms.log",
        lines: ["Synthetic preview log. No real activity is read."],
      });
    default:
      return { status: 404, body: { success: false, error: "Unknown synthetic settings route" } };
  }
}
