/** Shared shapes for the web chat: stored conversations, sources, and the search plan. */

export type ChatRole = "user" | "assistant";

/** A source as it was sent to the model, saved with the answer so it still opens later. */
export interface ChatSource {
  /** `S1`, `S2`, … for memories; `P1`, `P2`, … for profile items. */
  label: string;
  kind: "memory" | "profile";
  id: string;
  text: string;
  projectName?: string;
  projectTag?: string;
  createdAt?: number;
  tags?: string[];
  score?: number;
  /** Profile sources only. */
  section?: "preferences" | "patterns" | "workflows";
  category?: string;
  evidence?: string[];
}

export interface ChatPlanRecord {
  queries: string[];
  tags: string[];
  profileCategories: string[];
  /** True when the plan call failed or returned nothing usable. */
  skipped: boolean;
}

/** Shown with an assistant message that is not a normal cited answer. */
export type ChatNotice = "no_sources" | "insufficient" | "uncited";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  sources: ChatSource[];
  plan: ChatPlanRecord | null;
  model: string | null;
  errorCode: string | null;
  notice: ChatNotice | null;
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
  createdAt: number;
  updatedAt: number;
  conversationCount: number;
}

export class ChatStoreError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid" | "read_only"
  ) {
    super(message);
  }
}
