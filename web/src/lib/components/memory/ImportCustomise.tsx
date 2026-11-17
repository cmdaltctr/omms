import { Button } from "$lib/components/ui/button";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES } from "$lib/router";
import { HostImportBadges } from "../settings/HostImportBadges";
import { HostSessionSelection } from "./HostSessionSelection";
import { ImportOptions } from "./ImportOptions";
import { IMPORT_HOSTS, type HostDraft, type ImportDraft, type Readiness } from "./import-types";

const LINKS = [
  ["Project memories", ROUTES.project],
  ["User profile", ROUTES.profile],
  ["Profile identity in Settings", `${ROUTES.settings}#settings-section-profiles`],
] as const;

/**
 * The detailed import controls, closed by default: hosts (overview only), outputs,
 * scope, advanced options, each host's session list and import model, and the
 * manual Preview and Start import buttons. Start import opens the confirm dialog.
 */
export function ImportCustomise({
  host: onlyHost,
  open,
  onToggle,
  draft,
  recording,
  readiness,
  modelState,
  advanced,
  listing,
  blockedReason,
  outputError,
  previewReady,
  previewDisabled,
  startDisabled,
  onChange,
  onChangeHost,
  onAdvanced,
  onList,
  onPreview,
  onStart,
}: {
  host?: WebHost;
  open: boolean;
  onToggle: (open: boolean) => void;
  draft: ImportDraft;
  recording: boolean;
  readiness: Readiness | null;
  /** The checklist's Model row in words, so both places say the same. */
  modelState: string;
  advanced: boolean;
  listing: Partial<Record<WebHost, boolean>>;
  /** Why Preview or Start import is not available, as text, or null. */
  blockedReason: string | null;
  outputError: string | null;
  previewReady: boolean;
  previewDisabled: boolean;
  startDisabled: boolean;
  onChange: (patch: Partial<ImportDraft>) => void;
  onChangeHost: (host: WebHost, patch: Partial<HostDraft>) => void;
  onAdvanced: () => void;
  onList: (host: WebHost, offset: number, refresh: boolean) => void;
  onPreview: () => void;
  onStart: () => void;
}) {
  const s = useSettingsText();
  const shownHosts = onlyHost ? [onlyHost] : IMPORT_HOSTS;
  const ticked = IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled).length;
  return (
    <details
      className="min-w-0 rounded-lg border border-border p-3"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {s("Customise")}
      </summary>
      <div className="mt-3 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">
          {s("Choose hosts, sessions, outputs and the model by hand.")}
        </p>
        {!onlyHost && (
          <>
            <p className="text-sm text-muted-foreground">
              {s(
                "Conversations populate project facts. User prompts populate personal preferences, recurring patterns, and workflow steps."
              )}
            </p>
            <p className="flex flex-wrap gap-3 text-sm">
              {LINKS.map(([label, href]) => (
                <a
                  key={href}
                  className="underline"
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(href);
                  }}
                >
                  {s(label)}
                </a>
              ))}
            </p>
            <p className="text-xs text-muted-foreground">
              {s(
                "Hosts keep their existing user identities. All hosts does not merge profiles with different identities."
              )}
            </p>
            <HostImportBadges />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {IMPORT_HOSTS.map((host) => (
                <label key={host}>
                  <input
                    type="checkbox"
                    aria-label={hostLabel(host)}
                    checked={draft.hosts[host].enabled}
                    onChange={(event) => onChangeHost(host, { enabled: event.target.checked })}
                  />{" "}
                  {hostLabel(host)}
                </label>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    hosts: Object.fromEntries(
                      IMPORT_HOSTS.map((host) => [host, { ...draft.hosts[host], enabled: true }])
                    ) as ImportDraft["hosts"],
                  })
                }
              >
                {s("All hosts")}
              </Button>
              <span role="status">
                {s("Selected hosts")}: {ticked}
              </span>
            </div>
          </>
        )}
        <ImportOptions
          draft={draft}
          skillRecording={recording}
          advanced={advanced}
          onChange={onChange}
          onAdvanced={onAdvanced}
        />
        {shownHosts.map((host) => (
          <HostSessionSelection
            key={host}
            host={host}
            draft={draft}
            readiness={readiness}
            modelState={modelState}
            advanced={advanced}
            listing={Boolean(listing[host])}
            onChange={(patch) => onChangeHost(host, patch)}
            onList={(offset, refresh) => onList(host, offset, refresh)}
          />
        ))}
        {outputError && <p role="alert">{s(outputError)}</p>}
        {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
        {!previewReady && (
          <p className="text-xs text-muted-foreground">
            {s("Preview the current selection before starting an import.")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={previewDisabled} onClick={onPreview}>
            {s("Preview (dry run)")}
          </Button>
          <Button type="button" variant="outline" disabled={startDisabled} onClick={onStart}>
            {s("Start import")}
          </Button>
        </div>
      </div>
    </details>
  );
}
