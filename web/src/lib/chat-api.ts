import { fetchAPI } from "$lib/api";

/** Mirrors src/services/chat/chat-types.ts. */
export interface ChatSource {
  label: string;
  kind: "memory" | "profile";
  id: string;
  text: string;
  projectName?: string;
  projectTag?: string;
  createdAt?: number;
  tags?: string[];
  score?: number;
  section?: "preferences" | "patterns" | "workflows";
  category?: string;
  evidence?: string[];
}

export interface ChatPlan {
  queries: string[];
  tags: string[];
  profileCategories: string[];
  skipped: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  plan: ChatPlan | null;
  model: string | null;
  errorCode: string | null;
  notice: "no_sources" | "insufficient" | "uncited" | null;
  createdAt: number;
}

export interface ChatConversation {
  id: string;
  folderId: string | null;
  title: string;
  scopeTag: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatFolder {
  id: string;
  name: string;
  conversationCount: number;
}

export interface ChatStatus {
  ready: boolean;
  missing: string[];
  provider: string;
  apiHost: string | null;
}

export interface ChatList {
  conversations: ChatConversation[];
  folders: ChatFolder[];
  readOnly: boolean;
}

export interface ChatDetail {
  conversation: ChatConversation;
  messages: ChatMessage[];
  /** Memory ids cited in this conversation that no longer exist. */
  missingMemoryIds?: string[];
}

const BASE = "/api/chat";
const JSON_HEADERS = { "Content-Type": "application/json" };
/** Two model calls of up to 60 seconds each, plus the search. */
const ASK_TIMEOUT_MS = 150_000;

const send = <T>(path: string, method: string, body?: unknown, timeout?: number) =>
  fetchAPI<T>(`${BASE}${path}`, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout,
  });

export const chatApi = {
  status: () => fetchAPI<ChatStatus>(`${BASE}/status`),
  list: () => fetchAPI<ChatList>(`${BASE}/conversations`),
  get: (id: string) => fetchAPI<ChatDetail>(`${BASE}/conversations/${encodeURIComponent(id)}`),
  create: (folderId: string | null, scopeTag: string | null) =>
    send<ChatConversation>("/conversations", "POST", { folderId, scopeTag }),
  rename: (id: string, title: string) =>
    send<{ id: string }>(`/conversations/${encodeURIComponent(id)}`, "PATCH", { title }),
  move: (id: string, folderId: string | null) =>
    send<{ id: string }>(`/conversations/${encodeURIComponent(id)}`, "PATCH", { folderId }),
  remove: (id: string) =>
    send<{ id: string }>(`/conversations/${encodeURIComponent(id)}`, "DELETE"),
  removeMany: (ids: string[]) =>
    send<{ deleted: number }>("/conversations/bulk-delete", "POST", { ids }),
  ask: (id: string, question: string, scopeTag: string | null, retry = false) =>
    send<{ messages: ChatMessage[] }>(
      `/conversations/${encodeURIComponent(id)}/messages`,
      "POST",
      { question, scopeTag, retry },
      ASK_TIMEOUT_MS
    ),
  createFolder: (name: string) => send<ChatFolder>("/folders", "POST", { name }),
  renameFolder: (id: string, name: string) =>
    send<{ id: string }>(`/folders/${encodeURIComponent(id)}`, "PATCH", { name }),
  removeFolder: (id: string) =>
    send<{ id: string; deletedConversations: number }>(
      `/folders/${encodeURIComponent(id)}`,
      "DELETE"
    ),
};
