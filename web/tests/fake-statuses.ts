import {
  cardLine,
  hostStatus,
  type HostStatusInput,
} from "../src/lib/components/memory/host-status";
import type { HostStatuses } from "../src/lib/components/memory/use-host-statuses";

export const hosts = ["pi", "opencode", "claude-code"] as const;

type FakeOptions = {
  autoImport?: boolean;
  /** Backfill cutoff in milliseconds and exchanges waiting, for every host. */
  cutoff?: number;
  pending?: number;
  save?: (edits: Record<string, unknown>) => Promise<void>;
};

export function fakeStatuses(
  setUp: Record<(typeof hosts)[number], boolean>,
  options: FakeOptions = {}
): HostStatuses {
  const known = options.cutoff !== undefined;
  const input = (host: (typeof hosts)[number]): HostStatusInput => ({
    host,
    run: null,
    pending: options.pending ?? 0,
    cutoff: options.cutoff ?? null,
    runNowUnavailable: null,
    setUp: setUp[host],
    autoImport: options.autoImport ?? true,
    formatDate: String,
    lastSaved: null,
    formatSaved: String,
  });
  return {
    backfill: {
      snapshot: undefined,
      rows: Object.fromEntries(
        hosts.map((host) => [
          host,
          known
            ? {
                state: "done",
                model: null,
                cutoff: options.cutoff,
                counts: {
                  imported: 0,
                  skipped: 0,
                  failed: 0,
                  pending: options.pending ?? 0,
                  unresolved: 0,
                },
                error: null,
              }
            : null,
        ])
      ),
      runs: undefined,
      lists: {},
      message: "",
      busy: false,
      save: options.save ?? (async () => {}),
      control: async () => {},
      saveModel: () => {},
      setMessage: () => {},
    },
    readiness: null,
    input,
    status: (host) => hostStatus(input(host)),
    line: (host) => cardLine(input(host)),
  } as unknown as HostStatuses;
}
export const allSetUp = { pi: true, opencode: true, "claude-code": true };
