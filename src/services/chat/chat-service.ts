import { isFullyPrivate, stripPrivateContent } from "../privacy.js";
import type { ToolCallResult } from "../ai/providers/base-provider.js";
import { ANSWER_TOOL, buildAnswerPrompt, finaliseAnswer, numberSources } from "./chat-answer.js";
import { PLAN_TOOL, buildPlanPrompt, validatePlan, type PlanInput } from "./chat-plan.js";
import { retrieveSources, type RetrieveDeps } from "./chat-retrieve.js";
import type { ChatStore } from "./chat-store.js";
import type { ChatMessage, ChatPlanRecord } from "./chat-types.js";

export const MAX_QUESTION_CHARS = 4000;
const TITLE_CHARS = 60;
const DEFAULT_TITLE = "New chat";

type Tool = typeof PLAN_TOOL | typeof ANSWER_TOOL;

export interface ChatServiceDeps {
  store: ChatStore;
  model: string;
  /** One structured model call. Throws or returns `success: false` on failure. */
  callTool: (system: string, user: string, tool: Tool) => Promise<ToolCallResult>;
  retrieve: RetrieveDeps;
  listTags: (scopeTag: string | null) => Promise<PlanInput["tags"]>;
  profileCategories: () => Promise<string[]>;
  /** Metadata only: sizes, counts, codes, timings. Never question or answer text. */
  log: (message: string, meta: Record<string, unknown>) => void;
}

export interface AskInput {
  question: string;
  scopeTag: string | null;
  /** Re-run a failed answer instead of adding the question again. */
  retry?: boolean;
}

export type AskOutcome =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

function fail(status: 400 | 404 | 409, code: string, error: string): AskOutcome {
  return { ok: false, status, code, error };
}

/** A short code for a failed model call. Provider error text can echo keys, so it is dropped. */
function modelErrorCode(result: ToolCallResult | null): string {
  if (result?.transportError) return "model_unreachable";
  if (result?.httpStatus) return `model_http_${result.httpStatus}`;
  return "model_failed";
}

async function safeCall(deps: ChatServiceDeps, system: string, user: string, tool: Tool) {
  try {
    return await deps.callTool(system, user, tool);
  } catch {
    return null;
  }
}

async function plan(deps: ChatServiceDeps, input: PlanInput): Promise<ChatPlanRecord> {
  const prompt = buildPlanPrompt(input);
  const result = await safeCall(deps, prompt.system, prompt.user, PLAN_TOOL);
  return validatePlan(result?.success ? result.data : null, input);
}

/**
 * One question end to end: strip private text, save the question, plan the
 * search, retrieve sources, answer with checked citations, save the answer.
 * A model failure saves an assistant message with an error code so the page
 * can offer a retry.
 */
export async function askQuestion(
  conversationId: string,
  input: AskInput,
  deps: ChatServiceDeps
): Promise<AskOutcome> {
  if (isFullyPrivate(input.question)) {
    return fail(400, "private", "The question is fully private");
  }
  let question = stripPrivateContent(input.question).trim();
  if (!question) return fail(400, "empty", "A question is required");
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(400, "too_long", `Questions have at most ${MAX_QUESTION_CHARS} characters`);
  }
  if (deps.store.isReadOnly()) {
    return fail(409, "read_only", "chats.db is from a newer OMMS and is read-only");
  }

  const found = await deps.store.getConversation(conversationId);
  if (!found) return fail(404, "not_found", "Conversation not found");
  let history = found.messages;

  const last = history[history.length - 1];
  const userTurn = history[history.length - 2];
  if (input.retry && last?.role === "assistant" && last.errorCode && userTurn?.role === "user") {
    await deps.store.deleteMessage(last.id);
    history = history.slice(0, -2);
    // Answer the question that was stored, whatever text the request carries.
    question = userTurn.content;
  } else {
    if (found.messages.length === 0 && found.conversation.title === DEFAULT_TITLE) {
      await deps.store.renameConversation(conversationId, question.slice(0, TITLE_CHARS));
    }
    await deps.store.appendMessage(conversationId, { role: "user", content: question });
  }
  if (found.conversation.scopeTag !== input.scopeTag) {
    await deps.store.setConversationScope(conversationId, input.scopeTag);
  }

  const started = Date.now();
  const turns = history
    .filter((message) => !message.errorCode && message.content)
    .map((message) => ({ role: message.role, content: message.content }));
  const [tags, categories] = await Promise.all([
    deps.listTags(input.scopeTag).catch(() => []),
    deps.profileCategories().catch(() => []),
  ]);
  const searchPlan = await plan(deps, { question, turns, tags, categories });

  let sources;
  try {
    sources = numberSources(
      await retrieveSources(question, searchPlan, input.scopeTag, deps.retrieve)
    );
  } catch {
    return save(deps, conversationId, { errorCode: "search_failed", plan: searchPlan }, started);
  }
  if (sources.length === 0) {
    return save(deps, conversationId, { notice: "no_sources", plan: searchPlan }, started);
  }

  const prompt = buildAnswerPrompt(question, turns, sources);
  const result = await safeCall(deps, prompt.system, prompt.user, ANSWER_TOOL);
  const answer = result?.success ? finaliseAnswer(result.data, sources) : null;
  if (!answer) {
    const errorCode = result?.success ? "model_invalid_reply" : modelErrorCode(result);
    return save(deps, conversationId, { errorCode, plan: searchPlan, sources }, started);
  }
  return save(
    deps,
    conversationId,
    {
      content: answer.text,
      sources,
      plan: searchPlan,
      notice: answer.insufficient ? "insufficient" : answer.uncited ? "uncited" : null,
      cited: answer.cited.length,
    },
    started
  );
}

async function save(
  deps: ChatServiceDeps,
  conversationId: string,
  out: {
    content?: string;
    sources?: ChatMessage["sources"];
    plan: ChatPlanRecord;
    errorCode?: string;
    notice?: ChatMessage["notice"];
    cited?: number;
  },
  started: number
): Promise<AskOutcome> {
  const message = await deps.store.appendMessage(conversationId, {
    role: "assistant",
    content: out.content ?? "",
    sources: out.sources ?? [],
    plan: out.plan,
    model: deps.model,
    errorCode: out.errorCode ?? null,
    notice: out.notice ?? null,
  });
  deps.log("chat: question answered", {
    conversationId,
    outcome: out.errorCode ?? out.notice ?? "answered",
    planSkipped: out.plan.skipped,
    queries: out.plan.queries.length,
    tags: out.plan.tags.length,
    categories: out.plan.profileCategories.length,
    sources: out.sources?.length ?? 0,
    cited: out.cited ?? 0,
    answerChars: out.content?.length ?? 0,
    ms: Date.now() - started,
  });
  const full = await deps.store.getConversation(conversationId);
  return { ok: true, messages: full?.messages ?? [message] };
}
