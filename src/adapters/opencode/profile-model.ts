import { CONFIG } from "../../config.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { withExternalFallback } from "../../core/profile-learning/fallback.js";
import type { ProfileLearningNotice } from "../../core/profile-learning/pass.js";
import {
  isExternalModelReady,
  resolveOpencodeHostModel,
} from "../../services/ai/live-model-choice.js";
import { log } from "../../services/logger.js";
import { OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS } from "../../services/request-timeouts.js";
import { registerHostProfileModel } from "../../services/user-profile/profile-model.js";
import type { OpencodeModelRef } from "./opencode-import-models.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";
import type { OpencodeHost } from "./opencode-host.js";
import { getOpencodeProfileHost } from "./profile-llm-client.js";

function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Plain-text reply through one sessionless OpenCode generation. Only AI profile cleanup calls it. */
async function completeViaGeneration(
  host: Pick<OpencodeHost, "generate">,
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
  const timeoutMs = OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS;
  const generated = await raceWithTimeout(
    host.generate.text({
      prompt: [systemPrompt, userPrompt].filter(Boolean).join("\n\n"),
      model: { providerID: model.providerID, id: model.modelID } as never,
    }),
    timeoutMs,
    `opencode generation timeout after ${timeoutMs}ms`
  );
  log("AI cleanup: generation done", { generateMs: Date.now() - t0 });
  return (generated?.text ?? "").trim();
}

/** Adapt OpenCode's host model to the shared profile code, as `adaptPiProfileModel` does for Pi. */
export function adaptOpencodeProfileModel(
  host: Pick<OpencodeHost, "generate">,
  hostModel: OpencodeModelRef
): ModelPort {
  return {
    provider: hostModel.providerID,
    modelId: hostModel.modelID,
    complete: (systemPrompt, userPrompt) =>
      completeViaGeneration(host, hostModel, systemPrompt, userPrompt),
    completeStructured: (systemPrompt, userPrompt, schema) =>
      structuredOutput(hostModel, systemPrompt, userPrompt, schema),
  };
}

/** One sessionless OpenCode structured-output call (the V2 rule lives in `opencode-v2-adapter`). */
async function structuredOutput<T>(
  hostModel: OpencodeModelRef,
  systemPrompt: string,
  userPrompt: string,
  schema: Parameters<NonNullable<ModelPort["completeStructured"]>>[2]
): Promise<T> {
  const profileHost = await getOpencodeProfileHost();
  const { generateStructuredOutput } = await loadOpencodeProvider();
  return generateStructuredOutput({
    host: profileHost,
    providerID: hostModel.providerID,
    modelID: hostModel.modelID,
    systemPrompt,
    userPrompt,
    schema,
  }) as Promise<T>;
}

/** The limit on one learning call, as the OpenCode loop had before the shared pass. */
export const OPENCODE_PROFILE_LEARNING_TIMEOUT_MS = 120_000;

/** OpenCode's host model for a learning pass: structured output with the 120 s limit. */
function opencodeLearningPort(hostModel: OpencodeModelRef): ModelPort {
  return {
    provider: hostModel.providerID,
    modelId: hostModel.modelID,
    // The pass calls `completeStructured`; plain text is only a fallback for other callers.
    complete: async (systemPrompt, userPrompt) =>
      completeViaGeneration(await getOpencodeProfileHost(), hostModel, systemPrompt, userPrompt),
    completeStructured: (systemPrompt, userPrompt, schema) =>
      raceWithTimeout(
        structuredOutput(hostModel, systemPrompt, userPrompt, schema),
        OPENCODE_PROFILE_LEARNING_TIMEOUT_MS,
        "user-profile-learning: timeout"
      ),
  };
}

/** The external API's profile port, loaded on the first call. */
const externalProfilePort: ModelPort = {
  provider: "external",
  modelId: "",
  async complete(systemPrompt, userPrompt) {
    const { selectImportModel } = await import("../../importer/model-selection.js");
    return selectImportModel({}).profile.complete(systemPrompt, userPrompt);
  },
};

/**
 * The model of an OpenCode learning pass (change unify-profile-learning, design D3): the host
 * model, with the external API behind it when that is fully configured. Without a host model
 * the external API is the model. Null when neither exists.
 */
export function createOpencodeLearningModel(
  notify?: (notice: ProfileLearningNotice) => void | Promise<void>
): ModelPort | null {
  const hostModel = resolveOpencodeHostModel(CONFIG);
  const external = isExternalModelReady(CONFIG) ? externalProfilePort : null;
  return withExternalFallback(
    "opencode",
    hostModel ? opencodeLearningPort(hostModel) : null,
    external,
    notify
  );
}

/** Route shared profile calls in this process to OpenCode's host model while one is configured. */
export function registerOpencodeProfileModel(): void {
  registerHostProfileModel(async () => {
    const hostModel = resolveOpencodeHostModel(CONFIG);
    if (!hostModel) return null;
    const host = (await loadOpencodeProvider()).getOpencodeHost();
    if (!host) {
      log(
        "profile model: OpenCode plugin context unavailable, falling back to external API",
        undefined,
        "warn"
      );
      return null;
    }
    return adaptOpencodeProfileModel(host, hostModel);
  });
}
