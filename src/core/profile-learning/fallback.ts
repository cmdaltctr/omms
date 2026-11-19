import { extractJsonObject } from "../extraction.js";
import type { ModelPort } from "../profile-analysis.js";
import { log } from "../../services/logger.js";
import { HOST_INFO, type MemoryHost } from "../../shared/hosts.js";
import type { ProfileLearningNotice } from "./pass.js";

// A host model with the external API behind it (change unify-profile-learning, design D3).
// OpenCode and Pi wrap their profile model in it, so both show the same words.

/** The notice reason is cut to this many characters. */
const REASON_LIMIT = 100;

/** The limit on each attempt: the host model call, then the external API call. */
export const PROFILE_ATTEMPT_TIMEOUT_MS = 120_000;

export interface FallbackOptions {
  /** The limit on each attempt. Tests pass a short one. */
  attemptTimeoutMs?: number;
}

/** Rejects with a `timeout` error when `promise` takes longer than `ms`. */
function limit<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("profile learning: timeout")), ms);
    timer?.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

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
 *
 * With both models, each attempt gets its own limit (120 s by default), so a host model that
 * hangs still reaches the external API, and the external call gets a fresh limit. The port
 * says so with `limitsOwnCalls`, and `analyzeProfile` then adds no overall limit.
 */
export function withExternalFallback(
  host: MemoryHost,
  primary: ModelPort | null,
  external: ModelPort | null,
  notify?: (notice: ProfileLearningNotice) => void | Promise<void>,
  options: FallbackOptions = {}
): ModelPort | null {
  if (!primary) return external;
  if (!external) return primary;
  const ms = options.attemptTimeoutMs ?? PROFILE_ATTEMPT_TIMEOUT_MS;
  const fallBack = async (error: unknown): Promise<ModelPort> => {
    log("profile learning: host model failed, using the external API", { host }, "warn");
    // A notice can throw at once (a replaced Pi session); the external attempt still runs.
    try {
      await notify?.(fallbackNotice(host, error));
    } catch {
      // A failed notice does not stop the fallback.
    }
    return external;
  };
  const port: ModelPort = {
    provider: primary.provider,
    modelId: primary.modelId,
    limitsOwnCalls: true,
    async complete(systemPrompt, userPrompt) {
      try {
        return await limit(primary.complete(systemPrompt, userPrompt), ms);
      } catch (error) {
        return limit((await fallBack(error)).complete(systemPrompt, userPrompt), ms);
      }
    },
  };
  const structured = primary.completeStructured?.bind(primary);
  if (structured) {
    port.completeStructured = async (systemPrompt, userPrompt, schema) => {
      try {
        return await limit(structured(systemPrompt, userPrompt, schema), ms);
      } catch (error) {
        const model = await fallBack(error);
        if (model.completeStructured) {
          return limit(model.completeStructured(systemPrompt, userPrompt, schema), ms);
        }
        // `analyzeProfile` checks every reply against the schema, so the parsed JSON is enough.
        return extractJsonObject(
          await limit(model.complete(systemPrompt, userPrompt), ms)
        ) as never;
      }
    };
  }
  return port;
}
