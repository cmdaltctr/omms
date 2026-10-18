import { useEffect, useState } from "react";
import type { BackfillHost } from "$lib/auto-import-settings";
import { onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useBackfill } from "./use-backfill";
import { hostStatus, cardLine, type HostStatusInput } from "./host-status";
import type { Readiness } from "./import-types";

const formatDate = (milliseconds: number) =>
  new Date(milliseconds).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Each host's state for the Memory pages: backfill rows and runs, plus whether
 * its history source exists on this machine. One call serves the overview and
 * the host views, so they never disagree.
 */
export function useHostStatuses() {
  const backfill = useBackfill();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      void settingsRequest<Readiness>("/api/settings/imports/readiness")
        .then((value) => active && setReadiness(value))
        .catch(() => active && setReadiness(null));
    load();
    const stop = onSettingsSnapshot(load);
    return () => {
      active = false;
      stop();
    };
  }, []);

  const input = (host: BackfillHost): HostStatusInput => ({
    host,
    run: backfill.runs?.[host]?.run ?? null,
    pending: backfill.rows[host]?.counts.pending ?? 0,
    cutoff: backfill.rows[host]?.cutoff ?? null,
    runNowUnavailable: backfill.runs?.[host]?.runNowUnavailable ?? null,
    // Until readiness loads, assume the host exists rather than flash "Not set up".
    setUp: readiness?.defaultSourceFound?.[host] !== false,
    formatDate,
  });
  return {
    backfill,
    readiness,
    input,
    status: (host: BackfillHost) => hostStatus(input(host)),
    line: (host: BackfillHost) => cardLine(input(host)),
  };
}

export type HostStatuses = ReturnType<typeof useHostStatuses>;
