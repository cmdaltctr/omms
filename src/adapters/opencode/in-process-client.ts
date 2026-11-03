/**
 * Marks a host client that talks to OpenCode in-process. The V2 legacy client
 * is one: it calls the plugin context directly, so it has no HTTP transport
 * and no fetch to borrow. The transport setup skips its "no host fetch"
 * warning for it.
 */
const IN_PROCESS_CLIENT = Symbol.for("omms.opencode.inProcessClient");

export function markInProcessClient<T extends object>(client: T): T {
  Object.defineProperty(client, IN_PROCESS_CLIENT, { value: true });
  return client;
}

export function isInProcessClient(client: unknown): boolean {
  return (
    typeof client === "object" &&
    client !== null &&
    (client as Record<symbol, unknown>)[IN_PROCESS_CLIENT] === true
  );
}
