import { Pause, Play, Power, RotateCw, ExternalLink } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import type { ModelBackfillHost } from "$lib/auto-import-settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useHostLooks } from "$lib/host-looks";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";
import { HostAvatar } from "./HostAvatar";
import { HostRunDetails } from "./HostRunDetails";
import { TurnOnAction } from "./TurnOnAction";
import { statusText, type HostState } from "./host-status";
import type { HostStatuses } from "./use-host-statuses";

const SETUP_GUIDES: Record<WebHost, string> = {
  pi: "https://github.com/cmdaltctr/omms/blob/main/docs/pi-adapter.md",
  opencode: "https://github.com/cmdaltctr/omms/blob/main/docs/opencode-adapter.md",
  "claude-code": "https://github.com/cmdaltctr/omms/blob/main/docs/claude-code-adapter.md",
};

const STATE_LABEL: Record<HostState, string> = {
  "not-set-up": "Not set up",
  running: "Running",
  off: "Off",
  paused: "Paused",
  failed: "Failed",
  stopped: "Stopped",
};

/** The host's state, its one main action, and the sentence that explains both. */
export function HostStatusHeader({ host, statuses }: { host: WebHost; statuses: HostStatuses }) {
  const s = useSettingsText();
  const { looks } = useHostLooks();
  const { backfill } = statuses;
  const status = statuses.status(host);
  const facts = statuses.input(host);
  const row = backfill.rows[host];
  const run = backfill.runs?.[host]?.run ?? null;
  const act = () => {
    const kind = status.action.kind;
    if (kind === "pause") void backfill.control(host, "pause");
    else if (kind === "resume") void backfill.control(host, "resume");
    else if (kind === "retry") void backfill.control(host, "run");
  };
  const label: Record<typeof status.action.kind, string> = {
    setup: s("How to set up"),
    pause: s("Pause"),
    resume: s("Resume"),
    retry: s("Retry"),
    "turn-on": s("Turn on"),
  };
  const Icon = {
    pause: Pause,
    resume: Play,
    retry: RotateCw,
    setup: ExternalLink,
    "turn-on": Power,
  }[status.action.kind];
  // Each part drops out when it is unknown, as the status line spec says.
  const line = [
    facts.cutoff === null
      ? null
      : s("History imported up to {date}").replace("{date}", facts.formatDate(facts.cutoff)),
    row ? s("{n} chat exchanges waiting").replace("{n}", String(row.counts.pending)) : null,
    s(facts.autoImport ? "Automatic import on" : "Automatic import off"),
  ]
    .filter(Boolean)
    .join(" · ");
  const difference =
    facts.cutoff === null
      ? s(
          "Automatic import brings in older chats by itself. Import new chats brings in every chat not yet imported, newer ones included."
        )
      : s(
          "Automatic import brings in chats up to {date} by itself. Import new chats brings in every chat not yet imported, newer ones included."
        ).replace("{date}", facts.formatDate(facts.cutoff));
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={hostLabel(host)}
    >
      <div className="flex items-center gap-3">
        <HostAvatar host={host} look={looks[host]} />
        <div className="min-w-0">
          <h2 className="text-page-title font-semibold">{hostLabel(host)}</h2>
          <p
            className={cn(
              "text-sm",
              status.state === "failed" ? "text-destructive-label" : "text-muted-foreground"
            )}
          >
            {s("State")}: {s(STATE_LABEL[status.state])}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {status.action.kind === "setup" ? (
          <Button asChild variant="outline">
            <a href={SETUP_GUIDES[host]} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              {label.setup}
            </a>
          </Button>
        ) : status.action.kind === "turn-on" ? (
          <TurnOnAction
            disabled={backfill.busy || !status.action.enabled}
            onConfirm={() => backfill.save({ autoBackfill: true })}
          />
        ) : (
          <Button type="button" disabled={backfill.busy || !status.action.enabled} onClick={act}>
            <Icon aria-hidden="true" />
            {label[status.action.kind]}
          </Button>
        )}
        {status.action.kind === "turn-on" && (
          <span className="text-sm text-muted-foreground">
            {s("Turning this on applies to every host.")}
          </span>
        )}
        {status.offerExternal && (
          <Button
            type="button"
            variant="outline"
            disabled={backfill.busy}
            onClick={() => backfill.saveModel(host as ModelBackfillHost, "external")}
          >
            {s("Use external API")}
          </Button>
        )}
      </div>
      <p className="break-words text-sm text-muted-foreground" role="status">
        {statusText(s, status.sentence)}
      </p>
      {status.state !== "not-set-up" && (
        <>
          <p className="break-words text-sm">{line}</p>
          <p className="break-words text-sm text-muted-foreground">{difference}</p>
        </>
      )}
      {status.state !== "not-set-up" && <HostRunDetails host={host} run={run} row={row} />}
      {backfill.message && (
        <p role="status" className="text-sm">
          {backfill.message}
        </p>
      )}
      {status.action.kind !== "setup" && (
        <p className="text-xs text-muted-foreground">
          {s("Importing makes model calls and can cost money.")}
        </p>
      )}
    </section>
  );
}
