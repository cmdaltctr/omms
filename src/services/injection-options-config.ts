/**
 * The memory injection settings (change align-recall-host-parity): the opening
 * context and subagent memory, on OpenCode V2, Pi and Claude Code. Kept out of
 * `src/config.ts` to save its lines. Pure on purpose, like
 * `visible-recall-config.ts`: callers pass the file config and a log function,
 * and the loaded `CONFIG` is never imported here, because many tests stub
 * `src/config.js`.
 *
 * Read the effective values from `CONFIG.openingContext`,
 * `CONFIG.openingContextQuery` and `CONFIG.subagentMemory`.
 */

/** The opening context search query when the config file sets none. */
export const DEFAULT_OPENING_CONTEXT_QUERY =
  "project architecture, setup, conventions and key decisions";

/** Most characters of `openingContextQuery`, after trimming. */
export const OPENING_CONTEXT_QUERY_MAX_LENGTH = 500;

/**
 * The keys as they appear in a config file. `OmmsConfig` in `src/config.ts` has
 * no fields for them, to save lines, so the functions take `FileConfigWithKeys`,
 * which any config object satisfies. A hand-edited file can hold any value,
 * which is why each key is checked for its type.
 */
export interface InjectionOptionsFileKeys {
  /** Search memory with `openingContextQuery` on the first message of a new session. Default false. A project can only turn it off. */
  openingContext?: boolean;
  /** The opening context search query. Global only. Trimmed, 500 characters at most. Empty means no search. */
  openingContextQuery?: string;
  /** Give subagent sessions the memories that match their task. Default true. A project can only turn it off. */
  subagentMemory?: boolean;
}

type FileConfigWithKeys = InjectionOptionsFileKeys & object;

/**
 * Read the settings from a merged file config. A value of the wrong type reads
 * as the default. A query over the limit is cut, and `log` gets its length,
 * never its text.
 */
export function injectionOptionsFromFile(
  fileConfig: FileConfigWithKeys,
  log?: (message: string, data: { length: number }) => void
): { openingContext: boolean; openingContextQuery: string; subagentMemory: boolean } {
  const raw = fileConfig.openingContextQuery;
  let query = typeof raw === "string" ? raw.trim() : DEFAULT_OPENING_CONTEXT_QUERY;
  if (query.length > OPENING_CONTEXT_QUERY_MAX_LENGTH) {
    log?.("openingContextQuery is longer than 500 characters; only the first 500 are used", {
      length: query.length,
    });
    query = query.slice(0, OPENING_CONTEXT_QUERY_MAX_LENGTH);
  }
  return {
    openingContext: fileConfig.openingContext === true,
    openingContextQuery: query,
    subagentMemory: fileConfig.subagentMemory !== false,
  };
}

/**
 * Apply the project rules to `overrides`, the copy of the project config that
 * is merged over the global one. A project may turn either switch off, so a
 * value of `false` stays. Any other value is dropped, and a value of `true` is
 * reported through `log`. The query is global only, so a project query is
 * always dropped and reported.
 */
export function applyProjectInjectionOptions(
  project: FileConfigWithKeys,
  overrides: FileConfigWithKeys,
  directory: string,
  log: (message: string, data: { directory: string }) => void
): void {
  for (const key of ["openingContext", "subagentMemory"] as const) {
    if (project[key] === false) continue;
    delete overrides[key];
    if (project[key] === true) {
      log(`Project config cannot turn on ${key}; the value was ignored`, { directory });
    }
  }
  delete overrides.openingContextQuery;
  if (Object.hasOwn(project, "openingContextQuery")) {
    log("Project config cannot set openingContextQuery; the value was ignored", { directory });
  }
}
