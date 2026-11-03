import type { Context } from "@opencode/plugin/promise/plugin";
import {
  OPENCODE_IMPORT_COMMAND,
  OPENCODE_IMPORT_DESCRIPTION,
  runOpencodeImportCommand,
} from "../adapters/opencode/import-command.js";
import { addPackageSkill } from "../adapters/opencode/package-skills.js";
import { SKILLS_TOOL_INPUT_SCHEMA } from "../core/skills-tool.js";
import { log } from "../services/logger.js";
import { utf8ByteLength } from "../utils/context-limit.js";
import { eventBelongsToLocation, legacyToolResult, toLegacyEvent } from "./legacy-client.js";
import type { FirstPromptSections, V2MemoryBridge } from "./memory-bridge.js";
import { createRecallReporter } from "./recall-reporter.js";
import { createSessionParents } from "./session-parent.js";

const memoryInput = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: [
        "add",
        "search",
        "profile",
        "list",
        "forget",
        "help",
        "migrate",
        "list-shards",
        "export",
        "import",
      ],
    },
    content: { type: "string" },
    query: { type: "string" },
    tags: { type: "string" },
    type: { type: "string" },
    memoryId: { type: "string" },
    limit: { type: "number" },
    scope: { type: "string", enum: ["project", "all-projects"] },
    fromPath: { type: "string" },
    fromHash: { type: "string" },
    outputPath: { type: "string" },
    inputPath: { type: "string" },
    dryRun: { type: "boolean" },
    allowLinkedSource: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

/** Per-session state is bounded so long-running servers cannot grow it without limit. */
export const MAX_TRACKED_SESSIONS = 256;

/** Session ids remembered as already seen by this process, for the first-prompt rule. */
export const MAX_SEEN_SESSIONS = 500;

/** Unadmitted prompts kept per session before the oldest is dropped. */
const MAX_PENDING_PROMPTS = 16;

/** Compaction is restored natively through the `compaction` hook, never via the V1 event path. */
const COMPACTION_EVENT_TYPES = new Set(["session.compacted", "session.compaction.ended"]);

type Retrieval = {
  readonly promise: Promise<FirstPromptSections>;
  /** The request's captured byte allowance, taken before the search started. */
  readonly budgetBytes: number;
  /** The user prompt the search ran for; the recall summary shows it as the query. */
  readonly query: string;
  /** Tokens for the opening section's row, which is recorded apart from the prompt's. */
  readonly openingToken: object;
  /** Set when the first request finds an earlier user message: the session is a resume. */
  resumed?: boolean;
  settled?: { value: FirstPromptSections };
};
type Restored = { readonly memories: unknown[] };

const NO_SECTIONS: FirstPromptSections = {
  promptSection: null,
  openingSection: null,
  openingQuery: null,
};
type PendingPrompt = { readonly messageID: string; readonly text: string };

function setBounded<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  limit = MAX_TRACKED_SESSIONS
): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function deletedSessionID(event: { type: string; properties?: any }): string | undefined {
  if (event.type !== "session.deleted") return undefined;
  const props = event.properties ?? {};
  return props.sessionID ?? props.info?.id ?? props.session?.id;
}

export async function registerV2Adapter(ctx: Context, legacy: any, memory: V2MemoryBridge) {
  const retrievals = new Map<string, Retrieval>();
  const restored = new Map<string, Restored>();
  // Sessions this process has seen a prompt or compaction for. The first prompt of a session not
  // in it is a first prompt (new session) or a resume, decided in the context hook.
  const seen = new Map<string, true>();
  const firstPending = new Map<string, true>();
  const messageIDs = new Map<string, string>();
  // The prompt hook runs before OpenCode admits a prompt, so prompts wait here
  // until their message appears in a model request's history (the context
  // hook), and are only then recorded for auto-capture and profile learning.
  const pendingPrompts = new Map<string, PendingPrompt[]>();
  const parents = createSessionParents(ctx, setBounded);
  const recall = await createRecallReporter(ctx, memory, setBounded, parents);

  const forgetSession = (sessionID: string) => {
    recall.forget(sessionID);
    parents.forget(sessionID);
    seen.delete(sessionID);
    firstPending.delete(sessionID);
    retrievals.delete(sessionID);
    restored.delete(sessionID);
    messageIDs.delete(sessionID);
    pendingPrompts.delete(sessionID);
  };

  const recordAdmittedPrompts = async (
    sessionID: string,
    messages: ReadonlyArray<{ readonly id?: string }>
  ) => {
    const pending = pendingPrompts.get(sessionID);
    if (!pending?.length) return;
    const admitted = new Set(messages.map((message) => message.id).filter(Boolean));
    const remaining: PendingPrompt[] = [];
    for (const prompt of pending) {
      if (!admitted.has(prompt.messageID)) {
        remaining.push(prompt);
        continue;
      }
      try {
        await memory.recordPrompt(sessionID, prompt.messageID, prompt.text);
      } catch (error) {
        log(
          "v2 context: failed to record user prompt",
          { sessionID, error: String(error) },
          "error"
        );
      }
    }
    if (remaining.length > 0) pendingPrompts.set(sessionID, remaining);
    else pendingPrompts.delete(sessionID);
  };

  // Resolve a prompt's retrieval once; every model step for that prompt then
  // reuses the same section, even if the search finishes after the timeout.
  const settledRetrieval = async (retrieval: Retrieval): Promise<FirstPromptSections> => {
    if (!retrieval.settled) {
      const value = await withTimeout(retrieval.promise, memory.retrievalTimeoutMs, NO_SECTIONS);
      retrieval.settled ??= { value };
    }
    return retrieval.settled.value;
  };

  // Load the session's own memories once; the restored section is formatted when a request
  // emits it, against that request's captured budget. Each load gets a new object, which keys
  // its one row.
  const loadRestored = async (sessionID: string, timeoutMs?: number) => {
    try {
      const loading = memory.restoreSession(sessionID);
      const memories = await (timeoutMs === undefined
        ? loading
        : withTimeout(loading, timeoutMs, null));
      if (memories) setBounded(restored, sessionID, { memories });
      else restored.delete(sessionID);
    } catch (error) {
      log(
        "v2 restore: failed to load session memories",
        { sessionID, error: String(error) },
        "error"
      );
    }
  };

  // The first request of a session's first prompt in this process decides new or resumed:
  // an earlier user message in the history means resumed.
  const decideFirstRequest = async (
    sessionID: string,
    messages: ReadonlyArray<{ readonly id?: string; readonly role?: string }>,
    retrieval: Retrieval | undefined
  ) => {
    if (!firstPending.delete(sessionID)) return;
    const current = messageIDs.get(sessionID);
    if (!messages.some((message) => message.role === "user" && message.id !== current)) return;
    if (retrieval) retrieval.resumed = true;
    if (!memory.isCompactionEnabled()) return;
    const subagent = await withTimeout(
      parents.isSubagent(sessionID),
      memory.retrievalTimeoutMs,
      false
    );
    if (!subagent) await loadRestored(sessionID, memory.retrievalTimeoutMs);
  };

  // Each V1 tool becomes a direct V2 tool, like OpenCode's own read/grep/skill, not a
  // Code Mode catalog entry, so the model can always see and call it (as on V1 and Pi).
  const legacyTool = (name: "memory" | "skills", input: unknown) => ({
    name,
    description: legacy.tool[name].description,
    input: input as any,
    options: { codemode: false },
    execute: async (args: any, toolContext: any) =>
      legacyToolResult(
        await legacy.tool[name].execute(args, {
          sessionID: toolContext.sessionID,
          messageID: toolContext.messageID,
          agent: toolContext.agent,
          directory: ctx.location.directory,
          worktree: ctx.location.project.directory,
          abort: new AbortController().signal,
          metadata() {},
          async ask() {},
        })
      ) as any,
  });
  await ctx.tool.transform((editor) => {
    editor.add(legacyTool("memory", memoryInput) as any);
    editor.add(legacyTool("skills", SKILLS_TOOL_INPUT_SCHEMA) as any);
  });

  // The omms-memory skill ships in the package; V1 loads it through the config hook.
  await (ctx as any).skill?.transform?.((editor: any) => addPackageSkill(editor));

  // Same command as V1 and Pi. V2 runs it natively, so no model turn relays the report.
  await (ctx as any).command?.transform?.((editor: any) =>
    editor.add({
      name: OPENCODE_IMPORT_COMMAND,
      description: OPENCODE_IMPORT_DESCRIPTION,
      execute: async (invocation: { sessionID: string; prompt?: { text?: string } }) => {
        const sessionID = invocation.sessionID;
        const report = await runOpencodeImportCommand({
          argsText: invocation.prompt?.text ?? "",
          directory: ctx.location.directory,
          sessionModel: async () => {
            try {
              const session: any = await ctx.session.get({ sessionID } as any);
              const model = session?.model ?? session?.data?.model;
              return model?.providerID && model?.id
                ? { providerID: String(model.providerID), modelID: String(model.id) }
                : null;
            } catch (error) {
              log("v2 import: could not read the session model", { error: String(error) });
              return null;
            }
          },
        });
        await ctx.session.synthetic({ sessionID, text: report, resume: false } as any);
      },
    })
  );

  await ctx.session.hook("prompt", async (event) => {
    const budgetBytes = memory.snapshotRequestBudget();
    const sessionID = event.sessionID;
    const text = event.prompt.text ?? "";
    setBounded(messageIDs, sessionID, event.messageID);
    retrievals.delete(sessionID);

    if (!memory.isConfigured() || memory.isInternalPrompt(sessionID, text)) return;

    if (text.trim()) {
      const pending = [
        ...(pendingPrompts.get(sessionID) ?? []),
        { messageID: event.messageID, text },
      ].slice(-MAX_PENDING_PROMPTS);
      setBounded(pendingPrompts, sessionID, pending);
    }

    if (!text.trim()) return;
    const first = !seen.has(sessionID);
    if (first) {
      setBounded(seen, sessionID, true, MAX_SEEN_SESSIONS);
      setBounded(firstPending, sessionID, true);
    }
    if (!memory.isInjectionEnabled()) return;

    // A subagent session gets the prompt recall only when `subagentMemory` is on, and never the
    // opening section. A failed or slow lookup counts as a root session.
    const subagent = await withTimeout(
      parents.isSubagent(sessionID),
      memory.retrievalTimeoutMs,
      false
    );
    if (subagent && !memory.isSubagentMemoryEnabled()) return;

    // Start the search now with the entry snapshot, so it overlaps prompt admission.
    // An edit during retrieval must not change this request's allowance.
    const search = async (): Promise<FirstPromptSections> =>
      first && !subagent
        ? memory.retrieveFirstPrompt(text, sessionID, budgetBytes)
        : { ...NO_SECTIONS, promptSection: await memory.retrieve(text, sessionID, budgetBytes) };
    const promise = search().catch((error) => {
      log("v2 prompt: memory retrieval failed", { sessionID, error: String(error) }, "error");
      return NO_SECTIONS;
    });
    setBounded(retrievals, sessionID, {
      promise,
      budgetBytes,
      query: text,
      openingToken: {},
    });
  });

  await ctx.session.hook("context", async (event) => {
    const sessionID = event.sessionID;
    const retrieval = retrievals.get(sessionID);
    const budgetBytes = retrieval?.budgetBytes ?? memory.snapshotRequestBudget();

    // Before chat.params, which stores the model on the recorded prompt row.
    await recordAdmittedPrompts(sessionID, event.messages);
    await decideFirstRequest(sessionID, event.messages as any, retrieval);
    // The retrieval sections and the restored section share one request budget: the
    // restored section is formatted here, within what the retrieval left.
    let remainingBytes: number | null = null;
    if (retrieval) {
      const { promptSection, openingSection, openingQuery } = await settledRetrieval(retrieval);
      remainingBytes = retrieval.budgetBytes;
      if (promptSection) {
        event.system.push({ type: "text", text: promptSection });
        recall.record(sessionID, retrieval, "search", retrieval.query, promptSection);
        remainingBytes -= utf8ByteLength(promptSection);
      }
      if (openingSection && !retrieval.resumed) {
        event.system.push({ type: "text", text: openingSection });
        recall.record(sessionID, retrieval.openingToken, "opening", openingQuery, openingSection);
        remainingBytes -= utf8ByteLength(openingSection);
      }
    }

    const restoredEntry = restored.get(sessionID);
    if (restoredEntry) {
      const section = memory.formatRestoredSession(
        restoredEntry.memories,
        remainingBytes ?? budgetBytes
      );
      if (section) {
        event.system.push({ type: "text", text: section });
        recall.record(sessionID, restoredEntry, "restore", null, section);
      }
    }

    if (legacy["chat.params"]) {
      await legacy["chat.params"]({
        message: { id: messageIDs.get(sessionID) ?? sessionID },
        model: { providerID: event.model.providerID, id: event.model.id },
      });
    }
  });

  await ctx.session.hook("compaction", async (event) => {
    memory.snapshotRequestBudget();
    const sessionID = event.sessionID;
    setBounded(seen, sessionID, true, MAX_SEEN_SESSIONS);
    firstPending.delete(sessionID);
    if (!memory.isCompactionEnabled()) return;
    await loadRestored(sessionID);
  });

  const controller = new AbortController();
  const watcher = (async () => {
    try {
      for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
        const event = toLegacyEvent(raw);
        const deleted = deletedSessionID(event);
        if (deleted) forgetSession(deleted);
        if (!legacy.event || COMPACTION_EVENT_TYPES.has(event.type)) continue;
        if (await eventBelongsToLocation(ctx, raw)) {
          await legacy.event({ event });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log("omms v2 event bridge failed", { error: String(error) }, "error");
      }
    }
  })();

  return async () => {
    controller.abort();
    await watcher;
    retrievals.clear();
    restored.clear();
    messageIDs.clear();
    pendingPrompts.clear();
    seen.clear();
    firstPending.clear();
    parents.clear();
    recall.clear();
    await legacy.dispose?.();
  };
}
