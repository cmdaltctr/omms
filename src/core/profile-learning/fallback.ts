import type { z } from "zod";
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
  const fallBack = (error: unknown): ModelPort => {
    log("profile learning: host model failed, using the external API", { host }, "warn");
    // The notice is not awaited: one that never settles must not hold the external attempt.
    // A notice can also throw at once (a replaced Pi session); the external attempt still runs.
    try {
      Promise.resolve(notify?.(fallbackNotice(host, error))).catch(() => {});
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
        return limit(fallBack(error).complete(systemPrompt, userPrompt), ms);
      }
    },
  };
  // Always structured, so bad JSON from a text-only host model (Pi) counts as a failed call and
  // falls back, as OpenCode's structured call does when it throws.
  const structured = primary.completeStructured?.bind(primary);
  const hostReply = <T>(systemPrompt: string, userPrompt: string, schema: z.ZodType<T>) =>
    structured
      ? structured(systemPrompt, userPrompt, schema)
      : primary.complete(systemPrompt, userPrompt).then((text) => {
          const checked = schema.safeParse(extractJsonObject(text));
          if (!checked.success) throw new Error("host model reply is not valid profile JSON");
          return checked.data;
        });
  port.completeStructured = async (systemPrompt, userPrompt, schema) => {
    try {
      return await limit(hostReply(systemPrompt, userPrompt, schema), ms);
    } catch (error) {
      const model = fallBack(error);
      if (model.completeStructured) {
        return limit(model.completeStructured(systemPrompt, userPrompt, schema), ms);
      }
      // `analyzeProfile` checks every reply against the schema, so the parsed JSON is enough.
      return extractJsonObject(await limit(model.complete(systemPrompt, userPrompt), ms)) as never;
    }
  };
  return port;
}
