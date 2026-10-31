import { tryExtractScopeFromContainerTag } from "../memory-scope.js";
import { log } from "../logger.js";
import {
  chatServiceDeps,
  chatStore,
  existingMemoryIds,
  listedSkillNames,
  type ChatRuntimeConfig,
} from "./chat-runtime.js";
import { askQuestion } from "./chat-service.js";
import { chatStatus } from "./chat-status.js";
import { ChatStoreError, type ChatMessage } from "./chat-types.js";

export interface RouteResult {
  status: number;
  body: unknown;
}

type Body = Record<string, unknown>;

const ok = (data: unknown): RouteResult => ({ status: 200, body: { success: true, data } });
const fail = (status: number, code: string, error: string): RouteResult => ({
  status,
  body: { success: false, code, error },
});

const STATUS_BY_CODE = { not_found: 404, conflict: 409, invalid: 400, read_only: 409 } as const;

function scopeTag(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  // A scope must be a real container tag; anything else could reach a shard path.
  return typeof value === "string" && tryExtractScopeFromContainerTag(value) ? value : undefined;
}

function folderId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value ? value : undefined;
}

const CONVERSATION = /^\/api\/chat\/conversations\/([^/]+)$/;
const MESSAGES = /^\/api\/chat\/conversations\/([^/]+)\/messages$/;
const FOLDER = /^\/api\/chat\/folders\/([^/]+)$/;

/**
 * The `K` source names that the current ranking no longer lists. Empty while
 * skill learning is off, and empty, with no error, when the ranking cannot be read.
 */
async function missingSkillNames(
  messages: ChatMessage[],
  config: ChatRuntimeConfig
): Promise<string[]> {
  if (config.skillLearning !== true) return [];
  const cited = [
    ...new Set(
      messages.flatMap((m) => m.sources.filter((s) => s.kind === "skill").map((s) => s.id))
    ),
  ];
  if (cited.length === 0) return [];
  const listed = await listedSkillNames(config).catch(() => null);
  return listed ? cited.filter((name) => !listed.has(name)) : [];
}

/**
 * The chat routes under `/api/chat/`. Returns undefined for any other path.
 * Store errors map to 400, 404 or 409; anything else is logged by code only.
 */
export async function routeChat(
  path: string,
  method: string,
  readBody: () => Promise<Body>,
  config: ChatRuntimeConfig
): Promise<RouteResult | undefined> {
  if (!path.startsWith("/api/chat/")) return undefined;
  try {
    return await dispatch(path, method, readBody, config);
  } catch (error) {
    if (error instanceof ChatStoreError) {
      return fail(STATUS_BY_CODE[error.code], error.code, error.message);
    }
    log("chat route: error", { path: path.replace(/\/[0-9a-f-]{36}/g, "/:id"), method }, "error");
    return fail(500, "internal", "Chat request failed");
  }
}

async function dispatch(
  path: string,
  method: string,
  readBody: () => Promise<Body>,
  config: ChatRuntimeConfig
): Promise<RouteResult | undefined> {
  if (path === "/api/chat/status" && method === "GET") return ok(chatStatus(config));

  const store = await chatStore(config);

  if (path === "/api/chat/conversations") {
    if (method === "GET") {
      const [conversations, folders] = await Promise.all([
        store.listConversations(),
        store.listFolders(),
      ]);
      return ok({ conversations, folders, readOnly: store.isReadOnly() });
    }
    if (method === "POST") {
      const body = await readBody();
      const scope = scopeTag(body.scopeTag);
      const folder = body.folderId === undefined ? null : folderId(body.folderId);
      if (scope === undefined || folder === undefined) {
        return fail(400, "invalid", "Invalid scope or folder");
      }
      return ok(await store.createConversation({ title: "", scopeTag: scope, folderId: folder }));
    }
  }

  if (path === "/api/chat/conversations/bulk-delete" && method === "POST") {
    const body = await readBody();
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
    if (!Array.isArray(body.ids) || ids.length !== body.ids.length) {
      return fail(400, "invalid", "ids must be a list of conversation ids");
    }
    return ok({ deleted: await store.bulkDeleteConversations(ids as string[]) });
  }

  const messages = MESSAGES.exec(path);
  if (messages && method === "POST") {
    const body = await readBody();
    const scope = scopeTag(body.scopeTag);
    if (scope === undefined) return fail(400, "invalid", "Invalid scope");
    if (typeof body.question !== "string") return fail(400, "empty", "A question is required");
    const status = chatStatus(config);
    if (!status.ready) {
      return fail(409, "not_configured", `Missing settings: ${status.missing.join(", ")}`);
    }
    const outcome = await askQuestion(
      messages[1]!,
      { question: body.question, scopeTag: scope, retry: body.retry === true },
      await chatServiceDeps(config)
    );
    return outcome.ok
      ? ok({ messages: outcome.messages })
      : fail(outcome.status, outcome.code, outcome.error);
  }

  const conversation = CONVERSATION.exec(path);
  if (conversation) {
    const id = conversation[1]!;
    if (method === "GET") {
      const found = await store.getConversation(id);
      if (!found) return fail(404, "not_found", "Conversation not found");
      const cited = [
        ...new Set(
          found.messages.flatMap((m) =>
            m.sources.filter((s) => s.kind === "memory").map((s) => s.id)
          )
        ),
      ];
      const existing = await existingMemoryIds(cited).catch(() => new Set(cited));
      return ok({
        ...found,
        missingMemoryIds: cited.filter((memoryId) => !existing.has(memoryId)),
        missingSkillNames: await missingSkillNames(found.messages, config),
      });
    }
    if (method === "PATCH") {
      const body = await readBody();
      if (typeof body.title === "string") await store.renameConversation(id, body.title);
      if (body.folderId !== undefined) {
        const folder = folderId(body.folderId);
        if (folder === undefined) return fail(400, "invalid", "Invalid folder");
        await store.moveConversation(id, folder);
      }
      return ok({ id });
    }
    if (method === "DELETE") {
      await store.deleteConversation(id);
      return ok({ id });
    }
  }

  if (path === "/api/chat/folders") {
    if (method === "GET") return ok(await store.listFolders());
    if (method === "POST") {
      const body = await readBody();
      return ok(await store.createFolder(typeof body.name === "string" ? body.name : ""));
    }
  }

  const folder = FOLDER.exec(path);
  if (folder) {
    if (method === "PATCH") {
      const body = await readBody();
      await store.renameFolder(folder[1]!, typeof body.name === "string" ? body.name : "");
      return ok({ id: folder[1] });
    }
    if (method === "DELETE") {
      return ok({ id: folder[1], deletedConversations: await store.deleteFolder(folder[1]!) });
    }
  }

  return fail(404, "not_found", "Unknown chat route");
}
