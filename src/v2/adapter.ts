import type { Context } from "@opencode/plugin/promise/plugin";
import {
  OPENCODE_IMPORT_COMMAND,
  OPENCODE_IMPORT_DESCRIPTION,
  runOpencodeImportCommand,
} from "../adapters/opencode/import-command.js";
import { log } from "../services/logger.js";
import { eventBelongsToLocation, legacyToolResult, toLegacyEvent } from "./legacy-client.js";
import type { V2MemoryBridge } from "./memory-bridge.js";

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

/** Unadmitted prompts kept per session before the oldest is dropped. */
const MAX_PENDING_PROMPTS = 16;

/** Compaction is restored natively through the `compaction` hook, never via the V1 event path. */
const COMPACTION_EVENT_TYPES = new Set(["session.compacted", "session.compaction.ended"]);

type Retrieval = { readonly promise: Promise<string | null>; settled?: { value: string | null } };
type PendingPrompt = { readonly messageID: string; readonly text: string };

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_TRACKED_SESSIONS) {
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
  const restored = new Map<string, string>();
  const messageIDs = new Map<string, string>();
  // The prompt hook runs before OpenCode admits a prompt, so prompts wait here
  // until their message appears in a model request's history (the context
  // hook), and are only then recorded for auto-capture and profile learning.
  const pendingPrompts = new Map<string, PendingPrompt[]>();

  const forgetSession = (sessionID: string) => {
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
        log("v2 context: failed to record user prompt", { sessionID, error: String(error) });
      }
    }
    if (remaining.length > 0) pendingPrompts.set(sessionID, remaining);
    else pendingPrompts.delete(sessionID);
  };

  // Resolve a prompt's retrieval once; every model step for that prompt then
  // reuses the same section, even if the search finishes after the timeout.
  const settledRetrieval = async (retrieval: Retrieval): Promise<string | null> => {
    if (!retrieval.settled) {
      const value = await withTimeout(retrieval.promise, memory.retrievalTimeoutMs, null);
      retrieval.settled ??= { value };
    }
    return retrieval.settled.value;
  };

  await ctx.tool.transform((editor) =>
    editor.add({
      name: "memory",
      description: legacy.tool.memory.description,
      input: memoryInput as any,
      // A direct tool like OpenCode's own read/grep/skill, not a Code Mode catalog entry,
      // so the model can always see and call it (as it can on V1 and Pi).
      options: { codemode: false },
      execute: async (args: any, toolContext: any) =>
        legacyToolResult(
          await legacy.tool.memory.execute(args, {
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
    } as any)
  );

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

    if (!memory.isInjectionEnabled() || !text.trim()) return;

    // Start the search now so it overlaps prompt admission; `context` awaits it.
    const promise = memory.retrieve(text, sessionID).catch((error) => {
      log("v2 prompt: memory retrieval failed", { sessionID, error: String(error) });
      return null;
    });
    setBounded(retrievals, sessionID, { promise });
  });

  await ctx.session.hook("context", async (event) => {
    const sessionID = event.sessionID;

    // Before chat.params, which stores the model on the recorded prompt row.
    await recordAdmittedPrompts(sessionID, event.messages);

    const retrieval = retrievals.get(sessionID);
    if (retrieval) {
      const section = await settledRetrieval(retrieval);
      if (section) event.system.push({ type: "text", text: section });
    }

    const restoredSection = restored.get(sessionID);
    if (restoredSection) event.system.push({ type: "text", text: restoredSection });

    if (legacy["chat.params"]) {
      await legacy["chat.params"]({
        message: { id: messageIDs.get(sessionID) ?? sessionID },
        model: { providerID: event.model.providerID, id: event.model.id },
      });
    }
  });

  await ctx.session.hook("compaction", async (event) => {
    if (!memory.isCompactionEnabled()) return;
    const sessionID = event.sessionID;
    try {
      const section = await memory.restoreSession(sessionID);
      if (section) setBounded(restored, sessionID, section);
      else restored.delete(sessionID);
    } catch (error) {
      log("v2 compaction: failed to load session memories", { sessionID, error: String(error) });
    }
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
        log("omms v2 event bridge failed", { error: String(error) });
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
    await legacy.dispose?.();
  };
}
