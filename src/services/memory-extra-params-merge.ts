/**
 * How a project config's `memoryExtraParams` meets the global one. The project object
 * replaces the global object as a whole, except for the members that follow the global
 * endpoint: `provider` (OpenRouter routing) and the reasoning field. Pure on purpose:
 * `CONFIG` is never imported here, because many tests stub `src/config.js`.
 */
import { REASONING_KEYS } from "../shared/model-reasoning.js";
import { keepGlobalProvider } from "./openrouter-routing-config.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Keep the global `reasoning`, `reasoning_effort` and `thinking` when a project file sets
 * `memoryExtraParams` without any of the three. A project that sets one of them wins, and
 * no global reasoning member is copied beside it.
 */
export function keepGlobalReasoning(
  globalConfig: { memoryExtraParams?: unknown },
  projectOverrides: { memoryExtraParams?: unknown }
): void {
  if (!("memoryExtraParams" in projectOverrides)) return;
  const own = isPlainObject(projectOverrides.memoryExtraParams)
    ? projectOverrides.memoryExtraParams
    : {};
  if (REASONING_KEYS.some((key) => key in own)) return;
  const saved = isPlainObject(globalConfig.memoryExtraParams) ? globalConfig.memoryExtraParams : {};
  const kept = Object.fromEntries(
    REASONING_KEYS.filter((key) => key in saved).map((key) => [key, saved[key]])
  );
  if (Object.keys(kept).length === 0) return;
  projectOverrides.memoryExtraParams = { ...own, ...kept };
}

/** The global members a project `memoryExtraParams` never drops: routing, then reasoning. */
export function keepGlobalExtraParams(
  globalConfig: { memoryExtraParams?: unknown },
  projectOverrides: { memoryExtraParams?: unknown },
  log?: (message: string) => void
): void {
  keepGlobalProvider(globalConfig, projectOverrides, log);
  keepGlobalReasoning(globalConfig, projectOverrides);
}
