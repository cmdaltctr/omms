import * as configModule from "../config.js";
import type { LinkedOwner } from "./linked-search.js";

/**
 * Reads the active space the way partial test stubs allow: a `config.js` stub may
 * leave out `getActiveSpace`, and a missing one means the Default space.
 */
export function activeOwner(): LinkedOwner {
  return configModule.getActiveSpace?.() ?? { id: "default", customStoragePath: false };
}
