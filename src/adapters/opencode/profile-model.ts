import { CONFIG } from "../../config.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { resolveOpencodeHostModel } from "../../services/ai/live-model-choice.js";
import { log } from "../../services/logger.js";
import { OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS } from "../../services/request-timeouts.js";
import { registerHostProfileModel } from "../../services/user-profile/profile-model.js";
import type { OpencodeModelRef } from "./opencode-import-models.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";
import { getOpenCodeClient } from "./profile-llm-client.js";

type PromptPart = { type?: string; text?: string };
type PromptInfo = {
  error?: { name: string; data?: { message?: string } };
};
type PromptResultShape = {
  data?: { info?: PromptInfo; parts?: PromptPart[] };
  info?: PromptInfo;
  parts?: PromptPart[];
};

/**
 * Extract assistant text from an OpenCode session.prompt result.
 * AssistantMessage has no `text` field; content lives in `parts` (#177).
 */
export function extractTextFromPromptResult(promptResult: unknown): {
  info: PromptInfo | undefined;
  rawText: string;
} {
  const result = promptResult as PromptResultShape;
  const info = result?.data?.info ?? result?.info;
  const parts = result?.data?.parts ?? result?.parts ?? [];
  const rawText = parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n")
    .trim();
  return { info, rawText };
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Plain-text reply through a transient OpenCode session. Only AI profile cleanup
 * calls it, so the session carries the cleanup title the history reader skips.
 */
async function completeViaSession(
  v2Client: any,
  hostModel: OpencodeModelRef,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const t0 = Date.now();
  // Only "inherit" (or no model configured) needs resolving to the session's recent model.
  const model =
    hostModel.modelID === "inherit"
      ? (await loadOpencodeProvider()).resolveOpencodeModelRef(hostModel)
      : hostModel;

  const created = (await raceWithTimeout(
    v2Client.session.create({
      title: "omms profile cleanup",
      directory: process.cwd(),
    }),
    30000,
    "session.create timeout"
  )) as any;
  log("AI cleanup: session.create result", {
    rawType: typeof created,
    keys: Object.keys(created || {}),
    hasData: !!created?.data,
    dataId: created?.data?.id,
  });

  const sessionID = created?.data?.id || created?.id || created?.sessionID;
  if (!sessionID) throw new Error("session.create returned no session id");

  log("AI cleanup: session created", { sessionID, createMs: Date.now() - t0 });

  try {
    const TIMEOUT_MS = OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS;
    const promptResult = await raceWithTimeout(
      v2Client.session.prompt({
        sessionID,
        model,
        system: systemPrompt,
        parts: [{ type: "text", text: userPrompt }],
        // `noReply` suppresses assistant generation; cleanup needs the JSON reply (#177).
        noReply: false,
      }),
      TIMEOUT_MS,
      `opencodeClient prompt timeout after ${TIMEOUT_MS}ms`
    );

    log("AI cleanup: session.prompt done", { promptMs: Date.now() - t0 });

    const { info, rawText } = extractTextFromPromptResult(promptResult);

    if (!info) throw new Error("prompt response missing info");
    if (info.error)
      throw new Error(`opencode reported ${info.error.name}: ${info.error.data?.message ?? ""}`);
    return rawText;
  } finally {
    try {
      await v2Client.session.delete({ sessionID });
    } catch {
      // ignore cleanup failures for ephemeral sessions
    }
  }
}

/** Adapt OpenCode's host model to the shared profile code, as `adaptPiProfileModel` does for Pi. */
export function adaptOpencodeProfileModel(
  v2Client: unknown,
  hostModel: OpencodeModelRef
): ModelPort {
  return {
    provider: hostModel.providerID,
    modelId: hostModel.modelID,
    complete: (systemPrompt, userPrompt) =>
      completeViaSession(v2Client, hostModel, systemPrompt, userPrompt),
    async completeStructured(systemPrompt, userPrompt, schema) {
      const client = await getOpenCodeClient();
      const { generateStructuredOutput } = await loadOpencodeProvider();
      return generateStructuredOutput({
        client,
        providerID: hostModel.providerID,
        modelID: hostModel.modelID,
        systemPrompt,
        userPrompt,
        schema,
      });
    },
  };
}

/** Route shared profile calls in this process to OpenCode's host model while one is configured. */
export function registerOpencodeProfileModel(): void {
  registerHostProfileModel(async () => {
    const hostModel = resolveOpencodeHostModel(CONFIG);
    if (!hostModel) return null;
    const v2Client = (await loadOpencodeProvider()).getV2Client();
    if (!v2Client) {
      log("profile model: opencode client unavailable, falling back to external API");
      return null;
    }
    return adaptOpencodeProfileModel(v2Client, hostModel);
  });
}
