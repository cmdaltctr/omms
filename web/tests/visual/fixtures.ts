import { settingsResponse } from "./settings-fixtures";

const timestamp = "2026-10-03T12:00:00.000Z";
const memories = [
  {
    id: "preview-memory-1",
    type: "memory",
    content:
      '## Synthetic project note\n\nKeep configuration in the shared owner.\n\n```ts\nconst model = "example/model-preview";\n```\n\nمسودة تجريبية مع example/model-preview.\n中文内容用于检查换行。',
    memoryType: "decision",
    containerTag: "omms_preview_project",
    displayName: "Design preview",
    projectPath:
      "/synthetic/projects/a-long-example-project-path/visual-preview/src/shared/settings.ts",
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: ["preview", "shared-controls"],
    isPinned: false,
  },
  {
    id: "preview-memory-2",
    type: "memory",
    content:
      "A synthetic warning state stays visible while controls are disabled. This record contains no private user data.",
    memoryType: "pattern",
    containerTag: "omms_preview_project",
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: ["preview"],
    isPinned: true,
  },
];

const profile = {
  exists: true,
  userId: "synthetic-profile",
  displayName: "Synthetic preview profile",
  version: 2,
  totalPromptsAnalyzed: 12,
  lastAnalyzedAt: timestamp,
  profileData: {
    preferences: [
      {
        category: "UI",
        description: "Keep helper text visible. 中文长标签检查换行。",
        confidence: 0.96,
        frequency: 3,
      },
    ],
    patterns: [
      {
        category: "Preview",
        description: "تحقق من المسارات مثل example/model-preview دون تغيير البيانات.",
        confidence: 0.86,
        frequency: 2,
      },
    ],
    workflows: [
      {
        description: "Check the shared visual controls",
        steps: ["Open the preview", "Inspect the draft", "Keep changes isolated"],
        confidence: 0.92,
        frequency: 4,
      },
    ],
  },
};

/** Deterministic preview data. No request can reach a store, model, or backend. */
export function fixtureResponse(
  method: string,
  url: string,
  body?: unknown
): { status: number; body: unknown } {
  const path = new URL(url, "http://synthetic.invalid").pathname;
  const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
  const settings = settingsResponse(method, path, body);
  if (settings) return settings;

  if (method === "PUT" && path === "/api/memories/preview-memory-1") {
    const content = (body as { content?: unknown })?.content;
    if (typeof content !== "string")
      return { status: 400, body: { success: false, error: "Invalid synthetic draft" } };
    memories[0].content = content;
    return ok(memories[0]);
  }
  if (method !== "GET")
    return {
      status: 405,
      body: { success: false, error: "Mutation disabled in the synthetic preview" },
    };
  switch (path) {
    case "/api/health":
      return { status: 200, body: { authEnabled: true, synthetic: true } };
    case "/api/tags":
      return ok({
        project: [
          { tag: "omms_preview_project", displayName: "Synthetic preview project", count: 2 },
        ],
      });
    case "/api/stats":
      return ok({ total: memories.length });
    case "/api/memories":
    case "/api/search": {
      const query = new URL(url, "http://synthetic.invalid").searchParams.get("q");
      if (query === "preview-error")
        return { status: 500, body: { success: false, error: "Synthetic search failure" } };
      const items = query === "preview-empty" ? [] : memories;
      return ok({ items, total: items.length, page: 1, totalPages: 1 });
    }
    case "/api/migration/detect":
      return ok({ needsMigration: false, shardMismatches: [] });
    case "/api/migration/tags/detect":
      return ok({ needsMigration: false, count: 0 });
    case "/api/user-profile":
      return ok(profile);
    case "/api/web/status":
      return {
        status: 200,
        body: { canControl: true, isLocal: true, version: "synthetic", instance: "preview-only" },
      };
    default:
      return { status: 404, body: { success: false, error: "Unknown synthetic API route" } };
  }
}
