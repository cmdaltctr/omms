import { safeHealthError } from "./safe-health-error.js";

export interface WriteHealthResult {
  ok: boolean;
  /** One short line for the page; null when memories can be saved. */
  reason: string | null;
  checkedAt: number;
}

export interface WriteHealthOptions {
  /** Open the memory store and run a trivial query. */
  openStore: () => Promise<void>;
  /** Embed one fixed test string and return the vector length. */
  embed: () => Promise<number>;
  /** Credentials to remove from any reason. */
  secrets: () => Array<string | undefined>;
  now?: () => number;
}

const CACHE_MS = 30_000;
const MAX_REASON = 140;

function embeddingReason(error: unknown, secrets: Array<string | undefined>): string {
  const message = safeHealthError(error, secrets);
  const status = /\b([45]\d{2})\b/.exec(message)?.[1];
  if (status) return `Embedding server error (${status})`;
  const line = message.replace(/\s+/g, " ").trim();
  const text = `Embedding failed: ${line}`;
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

/**
 * Whether a new memory can be saved right now: the store opens and the
 * embedding service answers. A result is reused for 30 seconds and one probe
 * serves every caller that starts while it runs, so open tabs cause few
 * embedding calls. The probe sends a fixed string, never conversation text.
 */
export function createWriteHealth(options: WriteHealthOptions) {
  const now = options.now ?? Date.now;
  let last: WriteHealthResult | null = null;
  let running: Promise<WriteHealthResult> | null = null;

  async function probe(): Promise<WriteHealthResult> {
    const secrets = options.secrets();
    let reason: string | null = null;
    try {
      await options.openStore();
    } catch {
      reason = "Memory store cannot be opened";
    }
    if (reason === null) {
      try {
        const length = await options.embed();
        if (!length) reason = "Embedding service returned no values";
      } catch (error) {
        reason = embeddingReason(error, secrets);
      }
    }
    return { ok: reason === null, reason, checkedAt: now() };
  }

  return {
    async check(request: { fresh?: boolean } = {}): Promise<WriteHealthResult> {
      if (running) return running;
      if (!request.fresh && last && now() - last.checkedAt < CACHE_MS) return last;
      running = probe()
        .then((result) => (last = result))
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}
