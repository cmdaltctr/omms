/** One row of the server's outcomes list: a host and model with its counts. */
export type OutcomeRow = {
  host: string;
  provider?: string | null;
  model?: string | null;
  total: number;
  saved: number;
  skipped: number;
  failed: number;
};

export type ModelOutcome = Omit<OutcomeRow, "host"> & {
  /** `provider/model`, or null when the attempt stopped before a model was chosen. */
  label: string | null;
};

export type HostOutcome = Omit<OutcomeRow, "provider" | "model"> & { models: ModelOutcome[] };

const HOST_ORDER = ["opencode", "pi", "claude-code"];

function modelLabel(row: OutcomeRow): string | null {
  if (!row.provider && !row.model) return null;
  return `${row.provider ?? ""}/${row.model ?? ""}`;
}

/** Host totals in a fixed order, each with its model rows, largest first. */
export function groupOutcomesByHost(rows: OutcomeRow[]): HostOutcome[] {
  const hosts = new Map<string, HostOutcome>();
  for (const row of rows) {
    const host = hosts.get(row.host) ?? {
      host: row.host,
      total: 0,
      saved: 0,
      skipped: 0,
      failed: 0,
      models: [],
    };
    host.total += row.total;
    host.saved += row.saved;
    host.skipped += row.skipped;
    host.failed += row.failed;
    const label = modelLabel(row);
    const same = host.models.find((model) => model.label === label);
    if (same) {
      same.total += row.total;
      same.saved += row.saved;
      same.skipped += row.skipped;
      same.failed += row.failed;
    } else {
      host.models.push({
        label,
        provider: row.provider,
        model: row.model,
        total: row.total,
        saved: row.saved,
        skipped: row.skipped,
        failed: row.failed,
      });
    }
    hosts.set(row.host, host);
  }
  const rank = (host: string) => {
    const index = HOST_ORDER.indexOf(host);
    return index < 0 ? HOST_ORDER.length : index;
  };
  return [...hosts.values()]
    .map((host) => ({ ...host, models: host.models.sort((a, b) => b.total - a.total) }))
    .sort((a, b) => rank(a.host) - rank(b.host));
}

/** A count's share of its row's total, as a whole percentage. */
export function percentOf(count: number, total: number): number {
  return total > 0 ? Math.round((100 * count) / total) : 0;
}

/** Failure counts summed per host and reason; the server splits them by model too. */
export function groupReasons(
  rows: { host: string; reason: string; count: number }[]
): { host: string; reason: string; count: number }[] {
  const sums = new Map<string, { host: string; reason: string; count: number }>();
  for (const row of rows) {
    const key = `${row.host}\u0000${row.reason}`;
    const sum = sums.get(key) ?? { host: row.host, reason: row.reason, count: 0 };
    sum.count += row.count;
    sums.set(key, sum);
  }
  return [...sums.values()].sort((a, b) => b.count - a.count);
}
