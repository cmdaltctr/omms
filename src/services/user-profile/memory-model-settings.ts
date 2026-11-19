import type { CONFIG } from "../../config.js";

/**
 * The external model settings that profile cleanup sends requests with. Callers pass
 * `CONFIG` at call time; nothing in profile cleanup keeps it.
 */
export type MemoryModelSettings = Pick<
  typeof CONFIG,
  "memoryModel" | "memoryApiUrl" | "memoryApiKey" | "memoryExtraParams"
>;
