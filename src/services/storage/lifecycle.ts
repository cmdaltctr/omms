import { closeTursoAndInvalidateCaches } from "../turso/lifecycle.js";

/**
 * Closes every open store connection and resets the managers that cache store state, so
 * the next call opens the store again from the active storage folder. Callers load this
 * module on demand: the engine lifecycle pulls in the prompt, profile and session managers.
 */
export function closeStoresAndInvalidateCaches(): Promise<void> {
  return closeTursoAndInvalidateCaches();
}
