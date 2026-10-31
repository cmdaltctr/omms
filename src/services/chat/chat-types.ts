/** Shared shapes for the web chat: stored conversations, sources, and the search plan. */

import type { SkillHistoryKind } from "../skill-learning/history.js";

export type ChatRole = "user" | "assistant";

/** One change in a skill's history, as the chat keeps it. Scrubbed; no ids or paths. */
export interface ChatSkillHistoryEntry {
  kind: SkillHistoryKind;
  at: number;
  summary: string;
  appliedBy: string | null;
}

/** The facts a `K` source holds. Counts cover the last 30 days in all projects. */
export interface ChatSkillFacts {
  name: string;
  uses: number;
  failedTurns: number;
  attention: number;
  /** True while at least one applied proposal is in place. */
  modified: boolean;
  lastAppliedAt: number | null;
  history: ChatSkillHistoryEntry[];
}

/** A source as it was sent to the model, saved with the answer so it still opens later. */
export interface ChatSource {
  /** `S1`, `S2`, … for memories; `P1`, `P2`, … for profile items; `K1`, … for skills. */
  label: string;
  kind: "memory" | "profile" | "skill";
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
  /** Skill sources only. */
  skill?: ChatSkillFacts;
}

export type SkillIntent = "none" | "needs-work" | "most-used";

export interface ChatPlanRecord {
  queries: string[];
  tags: string[];
  profileCategories: string[];
  /** True when the plan call failed or returned nothing usable. */
  skipped: boolean;
  /** Written only while skill facts are on, and never by a skipped plan. */
  skills?: string[];
  skillIntent?: SkillIntent;
  /** Set when skill facts could not be read for this question. */
  skillFacts?: "unavailable";
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
