import { log } from "./logger.js";
import {
  REASONING_KEYS,
  reasoningFamily,
  reasoningFields,
  type ReasoningLevel,
} from "../shared/model-reasoning.js";
import type { RouteResult } from "./chat/chat-routes.js";

const REASONING_PATH = "/api/settings/external-api/reasoning";

const LEVELS = new Set<string>([
  "default",
  "off",
  "on",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const fail = (status: number, error: string): RouteResult => ({ status, body: { error } });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Config edits for one level save. Every older reasoning member goes and the new one is
 * written. The nested writes keep the other members and the file's comments. When nothing
 * is left, the whole `memoryExtraParams` goes.
 */
export function reasoningEdits(
  savedExtraParams: unknown,
  fields: Record<string, unknown>
): Record<string, unknown> {
  if (!isPlainObject(savedExtraParams)) {
    return Object.keys(fields).length > 0 ? { memoryExtraParams: fields } : {};
  }
  const rest = Object.keys(savedExtraParams).filter(
    (key) => !(REASONING_KEYS as readonly string[]).includes(key)
  );
  if (rest.length === 0 && Object.keys(fields).length === 0)
    return { memoryExtraParams: undefined };
  const edits: Record<string, unknown> = {};
  for (const key of REASONING_KEYS) {
    if (key in fields) edits[`memoryExtraParams.${key}`] = fields[key];
    else if (key in savedExtraParams) edits[`memoryExtraParams.${key}`] = undefined;
  }
  return edits;
}

/**
 * The Reasoning level save of the External API card. The field comes from the saved
 * endpoint (URL and provider), never from the page. Returns undefined for other paths.
 */
export async function routeModelReasoning(
  path: string,
  method: string,
  readBody: () => Promise<any>,
  ctx: { cwd: string; configModule: Pick<typeof import("../config.js"), "refreshConfigIfChanged"> }
): Promise<RouteResult | undefined> {
  if (path !== REASONING_PATH || method !== "POST") return undefined;
  const body = await readBody();
  if (typeof body?.revision !== "string") return fail(400, "Revision required");
  if (typeof body.level !== "string" || !LEVELS.has(body.level)) {
    return fail(400, "level must be default, off, on, minimal, low, medium, high, xhigh or max");
  }
  const level = body.level as ReasoningLevel;
  const toggle = body.toggle === true;

  const { writeGlobalConfigKeys, ConfigConflictError } = await import("../config-writer.js");
  let fields: Record<string, unknown> = {};
  let revision: string;
  try {
    ({ revision } = await writeGlobalConfigKeys({}, body.revision, {
      only: new Set(
        REASONING_KEYS.map((key) => `memoryExtraParams.${key}`).concat("memoryExtraParams")
      ),
      derive: (current) => {
        const family = reasoningFamily(
          typeof current.memoryApiUrl === "string" ? current.memoryApiUrl : undefined,
          typeof current.memoryProvider === "string" ? current.memoryProvider : undefined
        );
        const next = reasoningFields(family, level, toggle);
        if (next === undefined) {
          throw new Error(
            "The saved endpoint does not accept this reasoning level. Save the endpoint first."
          );
        }
        fields = next;
        return reasoningEdits(current.memoryExtraParams, next);
      },
    }));
  } catch (error) {
    return fail(
      error instanceof ConfigConflictError ? 409 : 400,
      error instanceof Error ? error.message : "Reasoning level not saved"
    );
  }
  // The file is already saved; a reload problem must not report the save as failed.
  try {
    ctx.configModule.refreshConfigIfChanged(ctx.cwd);
  } catch (error) {
    log(
      "Reasoning level saved, but reloading settings failed",
      { error: error instanceof Error ? error.message : String(error) },
      "error"
    );
  }
  return { status: 200, body: { revision, reasoning: fields } };
}
