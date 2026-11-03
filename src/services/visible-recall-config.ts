/**
 * The `visibleRecall` setting (change add-opencode-v2-visible-recall), kept out
 * of `src/config.ts` to save its lines. Pure on purpose: callers pass the file
 * config and a log function, and the loaded `CONFIG` is never imported here,
 * because many tests stub `src/config.js`.
 *
 * Read the effective value from `CONFIG.visibleRecall`. It is on by default,
 * and only an explicit `false` turns it off.
 */

/**
 * The key as it appears in a config file. `OmmsConfig` in `src/config.ts` has
 * no field for it, to save lines, so the functions take `FileConfigWithKey`,
 * which any config object satisfies. A hand-edited file can hold any value,
 * which is why they compare with `=== false`.
 */
export interface VisibleRecallFileKey {
  /** Draw a row in the OpenCode TUI for each memory recall. Default true. A project can only turn it off. */
  visibleRecall?: boolean;
}

type FileConfigWithKey = VisibleRecallFileKey & object;

/** Read the setting from a merged file config. Unset means on. */
export function visibleRecallFromFile(fileConfig: FileConfigWithKey): {
  visibleRecall: boolean;
} {
  return { visibleRecall: fileConfig.visibleRecall !== false };
}

/**
 * Apply the project rule to `overrides`, the copy of the project config that
 * is merged over the global one. A project may turn the rows off, so a value
 * of `false` stays. Any other project value is dropped, so the global value
 * decides. A project value of `true` is also reported through `log`.
 */
export function applyProjectVisibleRecall(
  project: FileConfigWithKey,
  overrides: FileConfigWithKey,
  directory: string,
  log: (message: string, data: { directory: string }) => void
): void {
  if (project.visibleRecall === false) return;
  delete overrides.visibleRecall;
  if (project.visibleRecall === true) {
    log("Project config cannot turn on visibleRecall; the value was ignored", { directory });
  }
}
