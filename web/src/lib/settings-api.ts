/** An HTTP failure, with its status available for revision-conflict handling. */
export class SettingsRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SettingsRequestError";
    this.status = status;
  }
}

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
    throw new SettingsRequestError(
      error.error ?? `Request failed (${response.status})`,
      response.status
    );
  }
  return result as T;
}

type SnapshotListener = (snapshot: unknown) => void;
const snapshotListeners = new Set<SnapshotListener>();
let snapshotGeneration = 0;

/**
 * Share a freshly loaded settings snapshot with every section. Each section
 * saves with the revision it last saw, so without this a save in one section
 * makes the next save in another look like an outside edit (409).
 */
export function publishSettingsSnapshot(snapshot: unknown): void {
  snapshotGeneration++;
  for (const listener of snapshotListeners) listener(snapshot);
}

/**
 * Start a settings read. `isCurrent()` is false once a newer snapshot was
 * published meanwhile, so a slow read never replaces a newer revision.
 */
export function beginSettingsRead(): { isCurrent: () => boolean } {
  const started = snapshotGeneration;
  return { isCurrent: () => snapshotGeneration === started };
}

/**
 * Load and publish the current settings; `null` when the load fails. A failure
 * leaves every section on its old revision, so the next save would be a 409
 * conflict. The warning says so here, once, for every section.
 */
export async function reloadSettingsSnapshot<T>(): Promise<T | null> {
  try {
    const snapshot = await settingsRequest<T>("/api/settings");
    publishSettingsSnapshot(snapshot);
    return snapshot;
  } catch {
    // Loaded here, not at the top: sonner and the i18n module touch the page on import,
    // and many tests load this file without one.
    const [{ toast }, { getLanguage }, { translateSettings }] = await Promise.all([
      import("sonner"),
      import("./i18n"),
      import("./i18n/settings"),
    ]);
    toast.warning(translateSettings(RELOAD_FAILED, getLanguage()));
    return null;
  }
}

const RELOAD_FAILED = "Could not load the latest settings. Reload the page before you save again.";

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

/**
 * Lets only the newest of several overlapping requests write its result:
 * `begin()` returns a check that is true only while no newer request began.
 */
export function createLatestGate(): { begin: () => () => boolean } {
  let latest = 0;
  return {
    begin() {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}

/** Run `work` with the busy flag on, and turn it off even when `work` throws. */
export async function withBusy<T>(
  setBusy: (busy: boolean) => void,
  work: () => Promise<T>
): Promise<T> {
  setBusy(true);
  try {
    return await work();
  } finally {
    setBusy(false);
  }
}
