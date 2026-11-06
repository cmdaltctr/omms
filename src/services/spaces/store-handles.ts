/**
 * Store handles that must be reset when the storage folder changes (ADR-041, design D4).
 *
 * A long-lived store object (a connection pool, a manager that caches its database path)
 * registers here once, on the line that creates it. `config.ts` calls `resetStoreHandles()`
 * when a config reload changes `storagePath`, which happens when the active memory space
 * changes. This module imports nothing, so config can use it without an import cycle.
 */

type ResetResult = void | Promise<unknown>;

const resets = new Map<string, () => ResetResult>();

/**
 * Registers `target` for a reset on a storage change and returns it, so the call can wrap
 * the line that creates a singleton. `reset` defaults to `target.reset()`.
 */
export function resettable<T>(
  name: string,
  target: T,
  reset: (target: T) => ResetResult = (item) => (item as { reset(): ResetResult }).reset()
): T {
  resets.set(name, () => reset(target));
  return target;
}

/** The names of the registered store handles. A test uses it to see that none is missing. */
export function registeredStoreResets(): string[] {
  return [...resets.keys()];
}

/**
 * Resets every registered handle. The synchronous part of each reset runs before this returns,
 * so a store call made right after sees a fresh handle. The promise ends when every connection
 * to the old folder is closed. A new connection waits for the close (see TursoConnectionManager).
 */
export function resetStoreHandles(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const reset of resets.values()) {
    try {
      const result = reset();
      if (result) pending.push(result);
    } catch (error) {
      pending.push(Promise.reject(error));
    }
  }
  return Promise.allSettled(pending).then(() => undefined);
}
