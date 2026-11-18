import { extractJsonObject } from "../extraction.js";
import type { ModelPort } from "../profile-analysis.js";
import { log } from "../../services/logger.js";
import { HOST_INFO, type MemoryHost } from "../../shared/hosts.js";
import type { ProfileLearningNotice } from "./pass.js";

// A host model with the external API behind it (change unify-profile-learning, design D3).
// OpenCode and Pi wrap their profile model in it, so both show the same words.

/** The notice reason is cut to this many characters. */
const REASON_LIMIT = 100;

function fallbackNotice(host: MemoryHost, error: unknown): ProfileLearningNotice {
  const reason = error instanceof Error ? error.message : String(error);
  const short = reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT)}...` : reason;
  return {
    title: "Using fallback provider",
    message: `${HOST_INFO[host].label} model failed (${short}); using configured fallback.`,
    variant: "warning",
  };
}

/**
 * A model port that calls `primary` and, when that call throws, shows a warning notice and
 * repeats the call through `external`. Pass `external` as null when the external API is not
 * fully configured: the primary error then reaches the pass. With no primary model the
 * external API is the model, with no notice. Null when neither model exists.
 */
export function withExternalFallback(
  host: MemoryHost,
  primary: ModelPort | null,
  external: ModelPort | null,
  notify?: (notice: ProfileLearningNotice) => void | Promise<void>
): ModelPort | null {
  if (!primary) return external;
  if (!external) return primary;
  const fallBack = async (error: unknown): Promise<ModelPort> => {
    log("profile learning: host model failed, using the external API", { host }, "warn");
    await Promise.resolve(notify?.(fallbackNotice(host, error))).catch(() => {});
    return external;
  };
  const port: ModelPort = {
    provider: primary.provider,
    modelId: primary.modelId,
    async complete(systemPrompt, userPrompt) {
      try {
        return await primary.complete(systemPrompt, userPrompt);
      } catch (error) {
        return (await fallBack(error)).complete(systemPrompt, userPrompt);
      }
    },
  };
  const structured = primary.completeStructured?.bind(primary);
  if (structured) {
    port.completeStructured = async (systemPrompt, userPrompt, schema) => {
      try {
        return await structured(systemPrompt, userPrompt, schema);
      } catch (error) {
        const model = await fallBack(error);
        if (model.completeStructured) {
          return model.completeStructured(systemPrompt, userPrompt, schema);
        }
        // `analyzeProfile` checks every reply against the schema, so the parsed JSON is enough.
        return extractJsonObject(await model.complete(systemPrompt, userPrompt)) as never;
      }
    };
  }
  return port;
}
