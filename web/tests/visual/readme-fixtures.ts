import { fixtureResponse } from "./fixtures";
import type { MemoryItem } from "../../../src/shared/api";

export const demoCode = `export function retryDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 8_000);
}`;
const timestamp = "2026-10-03T12:00:00.000Z";
const common = {
  containerTag: "omms_demo_app",
  displayName: "DemoUser / Taskboard",
  projectPath: "/demo/taskboard",
  createdAt: timestamp,
  updatedAt: timestamp,
  isPinned: false,
};
const memories: MemoryItem[] = [
  {
    ...common,
    id: "demo-retry-memory",
    type: "memory",
    memoryType: "feature",
    linkedPromptId: "demo-retry-prompt",
    tags: ["typescript", "retry", "tests"],
    content: `Added capped exponential backoff to the API client. Retries wait 250 ms initially and stop growing at 8 seconds.\n\n\`\`\`ts\n${demoCode}\n\`\`\`\n\n\`\`\`text\n$ bun test tests/retry.test.ts\n4 pass · 0 fail\n\`\`\``,
  },
  {
    ...common,
    id: "demo-retry-prompt",
    type: "prompt",
    linkedMemoryId: "demo-retry-memory",
    tags: [],
    content:
      "DemoUser: Add exponential backoff to our TypeScript API client. Start at 250 ms, cap at 8 seconds, and test the delay before we ship.",
  },
  {
    ...common,
    createdAt: "2026-10-02T09:30:00.000Z",
    updatedAt: "2026-10-02T09:30:00.000Z",
    id: "demo-filter-memory",
    type: "memory",
    memoryType: "bug-fix",
    linkedPromptId: "demo-filter-prompt",
    tags: ["search", "typescript"],
    content:
      "Fixed case-insensitive task search and covered empty queries.\n\n```ts\nconst query = input.trim().toLowerCase();\nconst visible = tasks.filter(task =>\n  task.title.toLowerCase().includes(query)\n);\n```\n\n```text\n$ bun test tests/search.test.ts\n6 pass · 0 fail\n```",
  },
  {
    ...common,
    id: "demo-filter-prompt",
    type: "prompt",
    linkedMemoryId: "demo-filter-memory",
    tags: [],
    content:
      "DemoUser: Task search misses titles when I type capital letters. Make matching case-insensitive and keep every task visible for an empty search.",
  },
];
const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
const raw = (body: unknown) => ({ status: 200, body });
const disabled = { status: 405, body: { error: "Operation disabled in the README demo" } };
const readRoutes = new Set([
  "/api/health",
  "/api/migration/detect",
  "/api/migration/tags/detect",
  "/api/settings/models",
  "/api/settings/embedding",
  "/api/settings/tokens",
  "/api/settings/import-maps",
  "/api/settings/diagnostics",
  "/api/settings/traces",
  "/api/settings/backfill",
  "/api/settings/backfill/runs",
  "/api/settings/web-autostart",
  "/api/settings/version",
  "/api/settings/log",
  "/api/settings/profile/catch-up",
]);

/** English-only README demo. No request reaches a store, history reader or model. */
export function readmeFixtureResponse(
  method: string,
  url: string,
  body?: unknown
): { status: number; body: unknown } {
  const path = new URL(url, "http://synthetic.invalid").pathname;
  if (method === "POST" && path === "/api/settings/imports/sessions")
    return fixtureResponse(method, url, body);
  if (
    method === "POST" &&
    path === "/api/settings/imports" &&
    (body as { options?: { dryRun?: boolean } })?.options?.dryRun === true
  )
    return fixtureResponse(method, url, body);
  if (method !== "GET") return disabled;
  switch (path) {
    case "/api/memories":
    case "/api/search":
      return ok({ items: memories, total: memories.length, page: 1, totalPages: 1 });
    case "/api/tags":
      return ok({ project: [{ tag: "omms_demo_app", displayName: "Taskboard", count: 2 }] });
    case "/api/keywords":
      return ok({
        keywords: ["typescript", "retry", "tests", "search"].map((keyword) => ({
          keyword,
          count: keyword === "typescript" ? 2 : 1,
        })),
      });
    case "/api/stats":
      return ok({ total: 4 });
    case "/api/user-profile":
      return ok({
        exists: true,
        userId: "demo-user",
        displayName: "DemoUser",
        version: 2,
        totalPromptsAnalyzed: 24,
        lastAnalyzedAt: timestamp,
        profileData: {
          preferences: [
            {
              category: "Testing",
              description: "Write focused tests before changing behaviour.",
              confidence: 0.96,
              frequency: 8,
            },
          ],
          patterns: [],
          workflows: [],
        },
      });
    case "/api/settings/profiles":
      return raw({
        profiles: [
          {
            id: "demo-profile",
            userId: "demo-user",
            displayName: "DemoUser",
            preferences: 1,
            patterns: 0,
            workflows: 0,
            totalPromptsAnalyzed: 24,
            lastAnalyzedAt: 1791028800000,
            inUse: true,
          },
        ],
      });
    case "/api/settings": {
      const result = structuredClone(fixtureResponse("GET", path));
      const settings = result.body as {
        settings: Record<string, unknown>;
        secrets: Record<string, unknown>;
        fallback: unknown;
        externalKey: unknown;
        effective: unknown;
        claudeFolder: unknown;
        access: { authUsername: string };
      };
      for (const [key, value] of Object.entries({
        opencodeProvider: "inherit",
        opencodeModel: "inherit",
        memoryApiUrl: "https://api.example.invalid/v1",
        memoryModel: "demo-memory-model",
        importPathMaps: [],
        claudeConfigDir: "/demo/claude",
      }))
        settings.settings[key] = { value, globalValue: value, source: "global" };
      settings.secrets.memoryApiKey = {
        set: true,
        source: "global",
        reference: "env://DEMO_MEMORY_API_KEY",
      };
      settings.fallback = { model: "demo-memory-model", configured: true };
      settings.externalKey = {
        source: "env",
        reference: "env://DEMO_MEMORY_API_KEY",
        resolvesInWebApp: true,
        warning: null,
      };
      settings.effective = {
        opencode: { ready: true, mode: "inherit" },
        pi: { kind: "session" },
        "claude-code": { ready: true, mode: "external", issues: [] },
      };
      settings.claudeFolder = { root: "/demo/claude/projects", source: "setting", exists: true };
      settings.access.authUsername = "DemoUser";
      return result;
    }
    case "/api/settings/imports/readiness":
      return raw({
        external: { state: "ready", provider: "openai-chat", model: "demo-memory-model" },
        opencode: { available: false, models: [] },
        piReader: { available: true },
        claudeCode: {
          available: true,
          defaultRoot: "/demo/claude/projects",
          defaultRootFound: true,
          modelChoices: ["external"],
        },
      });
    case "/api/settings/imports/current": {
      const preview = fixtureResponse("POST", "/api/settings/imports", {
        hosts: [{ host: "pi" }],
        options: { dryRun: true },
      });
      return raw({ job: preview.body });
    }
    case "/api/web/status":
      return raw({
        canControl: false,
        isLocal: true,
        version: "4.4.1",
        instance: "readme-demo-only",
      });
    default:
      return readRoutes.has(path)
        ? fixtureResponse(method, url)
        : { status: 404, body: { error: "Unknown README demo route" } };
  }
}
