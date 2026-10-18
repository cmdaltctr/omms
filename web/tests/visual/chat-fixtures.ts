/** A fake chat backend for the synthetic preview: in-memory chats and a canned model. */
type Source = Record<string, unknown> & { label: string; kind: string; id: string; text: string };
type Message = Record<string, unknown> & { id: string; role: string; content: string };
type Conversation = {
  id: string;
  folderId: string | null;
  title: string;
  scopeTag: string | null;
  createdAt: number;
  updatedAt: number;
};

let seq = 100;
const now = Date.UTC(2026, 9, 18, 9, 0, 0);
const next = (prefix: string) => `${prefix}-${++seq}`;

const sources: Source[] = [
  {
    label: "S1",
    kind: "memory",
    id: "preview-memory-1",
    text: "Decided to use npm as the default package manager for JavaScript projects; bun stays for OMMS only.",
    projectName: "Synthetic preview project",
    projectTag: "omms_preview_project",
    createdAt: now - 86_400_000,
    tags: ["npm", "tooling"],
  },
  {
    label: "S2",
    kind: "memory",
    id: "preview-memory-deleted",
    text: "Old note: run installs from the worktree, never the main checkout.",
    projectName: "Synthetic preview project",
    createdAt: now - 5 * 86_400_000,
    tags: ["worktree"],
  },
  {
    label: "P1",
    kind: "profile",
    id: "preferences:0",
    text: "Uses npm as the default package manager for JavaScript projects.",
    section: "preferences",
    category: "Tooling",
    evidence: ["manual-write", "Corrected a stored preference that said bun was preferred."],
  },
];
const plan = {
  queries: ["package manager choice", "npm or bun"],
  tags: ["npm"],
  profileCategories: ["Tooling"],
  skipped: false,
};

function answer(conversationId: string, question: string): Message[] {
  return [
    {
      id: next("m"),
      conversationId,
      role: "user",
      content: question,
      sources: [],
      plan: null,
      model: null,
      errorCode: null,
      notice: null,
      createdAt: now,
    },
    {
      id: next("m"),
      conversationId,
      role: "assistant",
      content:
        "Use npm for JavaScript projects [S1][P1]. Run installs from the worktree, not the main checkout [S2].",
      sources,
      plan,
      model: "synthetic",
      errorCode: null,
      notice: null,
      createdAt: now,
    },
  ];
}

let folders = [{ id: "folder-thesis", name: "Thesis" }];
let conversations: Conversation[] = [
  {
    id: "chat-long",
    folderId: null,
    title: "Package manager history",
    scopeTag: "omms_preview_project",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "chat-thesis-1",
    folderId: "folder-thesis",
    title: "Chapter 2 sources",
    scopeTag: null,
    createdAt: now - 1,
    updatedAt: now - 1,
  },
  {
    id: "chat-thesis-2",
    folderId: "folder-thesis",
    title: "Usul al-Fiqh notes",
    scopeTag: "omms_missing_project",
    createdAt: now - 2,
    updatedAt: now - 2,
  },
];
const messages = new Map<string, Message[]>([
  [
    "chat-long",
    Array.from({ length: 4 }, (_, i) =>
      answer("chat-long", `Question ${i + 1}: which package manager did we choose, and why?`)
    ).flat(),
  ],
  ["chat-thesis-1", answer("chat-thesis-1", "Which sources did I cite for chapter 2?")],
  ["chat-thesis-2", []],
]);

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
const missing = { status: 404, body: { success: false, code: "not_found", error: "Not found" } };
const withCounts = () =>
  folders.map((f) => ({
    ...f,
    conversationCount: conversations.filter((c) => c.folderId === f.id).length,
  }));

export function chatResponse(
  method: string,
  path: string,
  body: unknown
): { status: number; body: unknown } | null {
  if (!path.startsWith("/api/chat/")) return null;
  const b = (body ?? {}) as Record<string, any>;
  if (path === "/api/chat/status")
    return ok({
      ready: true,
      missing: [],
      provider: "openai-chat",
      apiHost: "api.example.invalid",
    });
  if (path === "/api/chat/conversations" && method === "GET") {
    return ok({
      conversations: [...conversations].sort((a, c) => c.updatedAt - a.updatedAt),
      folders: withCounts(),
      readOnly: false,
    });
  }
  if (path === "/api/chat/conversations" && method === "POST") {
    const c = {
      id: next("chat"),
      folderId: b.folderId ?? null,
      title: "New chat",
      scopeTag: b.scopeTag ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    conversations.push(c);
    messages.set(c.id, []);
    return ok(c);
  }
  if (path === "/api/chat/conversations/bulk-delete") {
    const ids: string[] = b.ids ?? [];
    conversations = conversations.filter((c) => !ids.includes(c.id));
    return ok({ deleted: ids.length });
  }
  if (path === "/api/chat/folders" && method === "GET") return ok(withCounts());
  if (path === "/api/chat/folders" && method === "POST") {
    const name = String(b.name ?? "").trim();
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      return {
        status: 409,
        body: { success: false, code: "conflict", error: "A folder with this name exists" },
      };
    }
    const f = { id: next("folder"), name };
    folders.push(f);
    return ok({ ...f, conversationCount: 0 });
  }
  const folder = /^\/api\/chat\/folders\/([^/]+)$/.exec(path);
  if (folder) {
    const id = folder[1]!;
    if (method === "DELETE") {
      const count = conversations.filter((c) => c.folderId === id).length;
      conversations = conversations.filter((c) => c.folderId !== id);
      folders = folders.filter((f) => f.id !== id);
      return ok({ id, deletedConversations: count });
    }
    folders = folders.map((f) => (f.id === id ? { ...f, name: String(b.name) } : f));
    return ok({ id });
  }
  const ask = /^\/api\/chat\/conversations\/([^/]+)\/messages$/.exec(path);
  if (ask) {
    const c = conversations.find((x) => x.id === ask[1]);
    if (!c) return missing;
    const added = answer(c.id, String(b.question));
    messages.set(c.id, [...(messages.get(c.id) ?? []), ...added]);
    if (c.title === "New chat") c.title = String(b.question).slice(0, 60);
    c.scopeTag = b.scopeTag ?? null;
    c.updatedAt = Date.now();
    return ok({ messages: messages.get(c.id) });
  }
  const one = /^\/api\/chat\/conversations\/([^/]+)$/.exec(path);
  if (one) {
    const c = conversations.find((x) => x.id === one[1]);
    if (!c) return missing;
    if (method === "DELETE") {
      conversations = conversations.filter((x) => x.id !== c.id);
      return ok({ id: c.id });
    }
    if (method === "PATCH") {
      if (typeof b.title === "string") c.title = b.title;
      if (b.folderId !== undefined) c.folderId = b.folderId;
      return ok({ id: c.id });
    }
    return ok({
      conversation: c,
      messages: messages.get(c.id) ?? [],
      missingMemoryIds: ["preview-memory-deleted"],
    });
  }
  return missing;
}
