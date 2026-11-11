/**
 * Structured output through the OpenCode V2 plugin context.
 *
 * OpenCode owns the user's provider sign-in, token refresh and routing, so OMMS asks it
 * for one sessionless text generation (`ctx.generate.text`) per call. The generation
 * has no session, agent or tools, so it cannot touch the user's session list or files.
 * The reply must be one JSON object; OMMS parses it and validates it with the caller's
 * schema. A hard timeout fails closed.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { latestOpencodeSessionModel, type OpencodeHost } from "./opencode-host.js";

export { getOpencodeHost } from "./opencode-host.js";

/** Error texts for a reply that holds no usable JSON; capture diagnostics classify them. */
export const OPENCODE_EMPTY_REPLY = "omms: opencode returned an empty reply";
export const OPENCODE_NO_JSON_REPLY = "omms: the model did not return a JSON object";

/** Hard ceiling for a single internal structured-output request. */
export const STRUCTURED_OUTPUT_TIMEOUT_MS = 90_000;

let _structuredOutputTimeoutMs = STRUCTURED_OUTPUT_TIMEOUT_MS;

/** Test helper: override the structured-output timeout. Pass undefined to reset. */
export function setStructuredOutputTimeoutMsForTests(ms: number | undefined): void {
  _structuredOutputTimeoutMs = ms ?? STRUCTURED_OUTPUT_TIMEOUT_MS;
}

let _connectedProviders: Set<string> = new Set();

export function setConnectedProviders(providers: string[]): void {
  _connectedProviders = new Set(providers);
}

export function isProviderConnected(providerName: string): boolean {
  return _connectedProviders.has(providerName);
}

export interface StructuredOutputOptions<T> {
  host: Pick<OpencodeHost, "generate">;
  providerID: string;
  modelID: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  /** Called with the parsed reply before it is validated, for capture diagnostics. */
  onReply?: (reply: StructuredOutputReply) => void;
}

export interface StructuredOutputReply {
  finish?: string;
  partTypes: string[];
  structuredOutput: unknown;
}

/**
 * Resolve `opencodeModel: "inherit"` to a concrete provider/model.
 *
 * Prefer an explicit prompt-recorded model (auto-capture path), then the latest
 * model request this plugin saw, then OpenCode's recent model list, so
 * profile-learning / conflict / dedup paths don't send the literal model id
 * "inherit" (ProviderModelNotFoundError).
 */
export function resolveOpencodeModelRef(opts: {
  providerID: string;
  modelID: string;
  prompt?: { providerId?: string | null; modelId?: string | null };
}): { providerID: string; modelID: string } {
  if (opts.modelID !== "inherit") {
    return { providerID: opts.providerID, modelID: opts.modelID };
  }

  if (opts.prompt?.providerId && opts.prompt?.modelId) {
    return { providerID: opts.prompt.providerId, modelID: opts.prompt.modelId };
  }

  // The latest request's model is the session model; headless OpenCode has no model.json.
  const latest = latestOpencodeSessionModel();
  if (latest) return latest;

  const recent = readRecentOpencodeModel(opts.providerID);
  if (recent) return recent;

  throw new Error(
    "omms: opencodeModel is 'inherit' but no session model was recorded and no recent OpenCode model is available"
  );
}

function readRecentOpencodeModel(
  preferredProvider?: string
): { providerID: string; modelID: string } | undefined {
  try {
    // OpenCode state path mirrors `opencode debug paths` → state.
    const stateDir = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    const modelPath = join(stateDir, "opencode", "model.json");
    if (!existsSync(modelPath)) return undefined;
    const raw = JSON.parse(readFileSync(modelPath, "utf8")) as {
      recent?: Array<{ providerID?: string; modelID?: string }>;
    };
    const recent = Array.isArray(raw.recent) ? raw.recent : [];
    const match =
      (preferredProvider
        ? recent.find((r) => r.providerID === preferredProvider && r.modelID)
        : undefined) ?? recent.find((r) => r.providerID && r.modelID);
    if (!match?.providerID || !match.modelID) return undefined;
    return { providerID: match.providerID, modelID: match.modelID };
  } catch {
    return undefined;
  }
}

function structuredPrompt(
  systemPrompt: string,
  userPrompt: string,
  jsonSchema: Record<string, unknown>
): string {
  return [
    systemPrompt,
    userPrompt,
    [
      "Return only one JSON object matching this JSON Schema.",
      "Do not wrap the JSON in Markdown.",
      JSON.stringify(jsonSchema),
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The JSON object in a model reply: the whole reply, a fenced block, or the outer braces. */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // The parser's own message can quote the reply, which must not reach the log.
      }
    }
    throw new Error(OPENCODE_NO_JSON_REPLY);
  }
}

async function withStructuredOutputTimeout<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = _structuredOutputTimeoutMs;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`omms: structured-output timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    // On a timeout the pending generation's result is dropped.
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Generate one structured-output reply with one sessionless `ctx.generate.text` request.
 * Throws on a failed request, a reply with no JSON object, a timeout, or a schema mismatch.
 */
export async function generateStructuredOutput<T>(opts: StructuredOutputOptions<T>): Promise<T> {
  const { providerID, modelID } = resolveOpencodeModelRef({
    providerID: opts.providerID,
    modelID: opts.modelID,
  });
  const jsonSchema =
    (
      opts.schema as unknown as {
        toJSONSchema?: () => Record<string, unknown>;
      }
    ).toJSONSchema?.() ?? (await import("zod")).z.toJSONSchema(opts.schema);

  const generated = await withStructuredOutputTimeout(() =>
    opts.host.generate.text({
      prompt: structuredPrompt(opts.systemPrompt, opts.userPrompt, jsonSchema),
      model: { providerID, id: modelID } as never,
    })
  );
  const text = generated?.text ?? "";
  if (!text.trim()) throw new Error(OPENCODE_EMPTY_REPLY);
  const structuredOutput = parseJsonReply(text);
  try {
    opts.onReply?.({ partTypes: ["text"], structuredOutput });
  } catch {
    // Diagnostics must never change the call's result.
  }
  return opts.schema.parse(structuredOutput);
}
