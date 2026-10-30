import { useEffect, useState } from "react";
import { relativeDay } from "$lib/date-format";
import { formatDay, formatTime } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import type { BackfillHost } from "$lib/auto-import-settings";
import { onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useBackfill } from "./use-backfill";
import { hostStatus, cardLine, type HostStatusInput } from "./host-status";
import type { Readiness } from "./import-types";

type LastSaved = Record<BackfillHost, number | null>;
const SAVED_POLL_MS = 60_000;

/**
 * Each host's state for the Memory pages: backfill rows and runs, plus whether
 * its history source exists on this machine. One call serves the overview and
 * the host views, so they never disagree.
 */
export function useHostStatuses() {
  const backfill = useBackfill();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [lastSaved, setLastSaved] = useState<LastSaved | null>(null);
  const s = useSettingsText();
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

  // Live capture saves all day, so the card reads the time again every minute.
  useEffect(() => {
    let active = true;
    const load = () =>
      void settingsRequest<{ hosts: LastSaved }>("/api/settings/last-saved")
        .then((value) => active && setLastSaved(value.hosts))
        .catch(() => undefined);
    load();
    const stop = onSettingsSnapshot(load);
    const timer = setInterval(load, SAVED_POLL_MS);
    return () => {
      active = false;
      stop();
      clearInterval(timer);
    };
  }, []);

  const formatSaved = (milliseconds: number) => {
    const day = relativeDay(new Date(milliseconds), new Date());
    const time = formatTime(milliseconds);
    if (day === "earlier") return `${formatDay(milliseconds)} ${time}`;
    return s(day === "today" ? "today {time}" : "yesterday {time}").replaceAll("{time}", time);
  };

  const input = (host: BackfillHost): HostStatusInput => ({
    host,
    run: backfill.runs?.[host]?.run ?? null,
    pending: backfill.rows[host]?.counts.pending ?? 0,
    cutoff: backfill.rows[host]?.cutoff ?? null,
    runNowUnavailable: backfill.runs?.[host]?.runNowUnavailable ?? null,
    // Until readiness loads, assume the host exists rather than flash "Not set up".
    setUp: readiness?.defaultSourceFound?.[host] !== false,
    formatDate: formatDay,
    lastSaved: lastSaved?.[host] ?? null,
    formatSaved,
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
