import {
  cardLine,
  hostStatus,
  type HostStatusInput,
} from "../src/lib/components/memory/host-status";
import type { HostStatuses } from "../src/lib/components/memory/use-host-statuses";

export const hosts = ["pi", "opencode", "claude-code"] as const;

export function fakeStatuses(setUp: Record<(typeof hosts)[number], boolean>): HostStatuses {
  const input = (host: (typeof hosts)[number]): HostStatusInput => ({
    host,
    run: null,
    pending: 0,
    cutoff: null,
    runNowUnavailable: null,
    setUp: setUp[host],
    formatDate: String,
    lastSaved: null,
    formatSaved: String,
  });
  return {
    backfill: {
      snapshot: undefined,
      rows: { pi: null, opencode: null, "claude-code": null },
      runs: undefined,
      lists: {},
      message: "",
      busy: false,
      save: async () => {},
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
