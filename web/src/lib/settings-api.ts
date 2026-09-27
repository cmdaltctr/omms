export async function settingsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  // The server accepts a change only as JSON, including a body-less DELETE.
  const method = (options.method ?? "GET").toUpperCase();
  const changes = method !== "GET" && method !== "HEAD";
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-omms-token": window.__OMMS_TOKEN__ ?? "",
      ...(changes || options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { error?: string };
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return result as T;
}

type SnapshotListener = (snapshot: unknown) => void;
const snapshotListeners = new Set<SnapshotListener>();

/**
 * Share a freshly loaded settings snapshot with every section. Each section
 * saves with the revision it last saw, so without this a save in one section
 * makes the next save in another look like an outside edit (409).
 */
export function publishSettingsSnapshot(snapshot: unknown): void {
  for (const listener of snapshotListeners) listener(snapshot);
}

export function onSettingsSnapshot(listener: SnapshotListener): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

/** Join a server message and a follow-up note without doubling the full stop. */
export function withNote(message: string, note: string): string {
  return `${message.replace(/\.+$/, "")}. ${note}`;
}
