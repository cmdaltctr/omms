import { useEffect, useRef, useState } from "react";
import { createLatestGate, onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { mergeListing } from "$lib/import-listing";
import { navigate, ROUTES } from "$lib/router";
import { HostImportBadges } from "../settings/HostImportBadges";
import { HostSessionSelection } from "./HostSessionSelection";
import { ImportOptions, importButton } from "./ImportOptions";
import { importFeedback, ImportResults, workCounts } from "./ImportResults";
import {
  emptySelection,
  groupRequest,
  initialImportDraft,
  membership,
  optionsError,
  parseMaps,
  previewFingerprint,
  selectableCount,
  selectedCount,
} from "./import-draft";
import {
  IMPORT_HOSTS,
  type HostDraft,
  type ImportDraft,
  type ImportJob,
  type Readiness,
  type SessionPage,
} from "./import-types";

/** Reload readiness on the existing shared revision channel. */
export function watchReadiness(reload: () => void): () => void {
  return onSettingsSnapshot(() => reload());
}
export function externalOptionLabel(
  readiness: { external: { state: string } } | null,
  s: (message: string) => string
): string {
  return `${s("Saved external API")}${readiness && readiness.external.state !== "ready" ? ` — ${s("not ready")}` : ""}`;
}

const EXTERNAL_REASONS: Record<string, string> = {
  "missing-model": "The external API has no memoryModel in the global config",
  "missing-url": "The external API has no memoryApiUrl in the global config",
  "missing-key":
    "The external API key is missing in the OpenCode process; check memoryApiKey and its env:// or file:// source",
  "unsupported-provider": "The memoryProvider in the global config is not supported for imports",
};

/** One draft owns every host and shared option. The server owns execution order. */
export function ImportSection({ profilePreset = 0 }: { profilePreset?: number } = {}) {
  const s = useSettingsText();
  const [draft, setDraft] = useState<ImportDraft>(initialImportDraft);
  const [advanced, setAdvanced] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [preview, setPreview] = useState<{ id: string; fingerprint: string } | null>(null);
  const [listing, setListing] = useState<Partial<Record<WebHost, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const listingVersions = useRef<Record<WebHost, number>>({ pi: 0, opencode: 0, "claude-code": 0 });
  const mounted = useRef(true);
  const jobReplies = useRef(createLatestGate());
  const fingerprint = previewFingerprint(draft);
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const hosts = IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled);
  const running =
    job?.state === "running" ||
    job?.state === "cancelling" ||
    job?.state === "preparing" ||
    job?.state === "queued";

  function refreshJob() {
    const isCurrent = jobReplies.current.begin();
    return settingsRequest<{ job: ImportJob | null }>("/api/settings/imports/current").then(
      (value) => {
        if (mounted.current && isCurrent()) setJob(value.job);
      }
    );
  }

  useEffect(() => {
    mounted.current = true;
    const reload = () => {
      setPreview(null);
      void settingsRequest<Readiness>("/api/settings/imports/readiness")
        .then((value) => {
          if (mounted.current) setReadiness(value);
        })
        .catch(() => {
          if (mounted.current) setReadiness(null);
        });
    };
    reload();
    void refreshJob().catch(() => {});
    const stop = watchReadiness(reload);
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (submitting.current) return;
      void refreshJob().catch((cause: Error) => {
        if (mounted.current) setError(cause.message);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!profilePreset) return;
    setDraft((previous) => ({ ...previous, memories: false, profile: true, force: true }));
    setPreview(null);
  }, [profilePreset]);

  function change(patch: Partial<ImportDraft>) {
    setPreview(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  }
  function changeHost(host: WebHost, patch: Partial<HostDraft>) {
    setPreview(null);
    setDraft((previous) => ({
      ...previous,
      hosts: { ...previous.hosts, [host]: { ...previous.hosts[host], ...patch } },
    }));
  }

  async function list(host: WebHost, offset: number, refresh: boolean) {
    const version = ++listingVersions.current[host];
    const listedWith = membership(draft, host);
    setPreview(null);
    setListing((previous) => ({ ...previous, [host]: true }));
    try {
      const result = await settingsRequest<SessionPage>("/api/settings/imports/sessions", {
        method: "POST",
        body: JSON.stringify({
          host,
          ...(draft.hosts[host].source ? { source: draft.hosts[host].source!.sourceToken } : {}),
          scope: draft.scope,
          ...(draft.scope === "current-project" && draft.project ? { project: draft.project } : {}),
          pathMaps: parseMaps(draft.maps),
          offset,
          limit: 50,
          refresh,
        }),
      });
      if (!mounted.current || listingVersions.current[host] !== version) return;
      setDraft((previous) => {
        if (membership(previous, host) !== listedWith) return previous;
        const child = previous.hosts[host];
        const merged = mergeListing(child.page, result, refresh);
        return {
          ...previous,
          hosts: {
            ...previous.hosts,
            [host]: {
              ...child,
              page: merged.page,
              listedWith,
              selection: merged.sameListing ? child.selection : emptySelection(),
            },
          },
        };
      });
      setError("");
    } catch (cause) {
      if (mounted.current && listingVersions.current[host] === version)
        setError((cause as Error).message);
    } finally {
      if (mounted.current && listingVersions.current[host] === version)
        setListing((previous) => ({ ...previous, [host]: false }));
    }
  }

  const outputError = optionsError(draft);
  const readerBlocked = hosts.some(
    (host) => host === "pi" && readiness?.piReader.available === false
  );
  const selectionBlocked = hosts
    .map((host) => {
      const child = draft.hosts[host];
      if (!child.page) return `${hostLabel(host)}: ${s("List sessions first.")}`;
      if (child.listedWith !== membership(draft, host))
        return `${hostLabel(host)}: ${s("Options changed. Refresh the session list first.")}`;
      if (selectableCount(draft, host) > 0 && selectedCount(draft, host) === 0)
        return `${hostLabel(host)}: ${s("Select at least one session.")}`;
      if (child.selection.mode === "ids" && child.selection.picked.size > 1000)
        return `${hostLabel(host)}: ${s("Select at most 1000 sessions one by one, or use Select all matching.")}`;
      return null;
    })
    .find(Boolean);
  const modelBlocked = hosts
    .map((host) => {
      const model = draft.hosts[host].modelChoice;
      let reason: string | null = null;
      if (!readiness) reason = "Model readiness is unknown. Reload the page.";
      else if (!model)
        reason =
          "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
      else if (model === "external" && readiness.external.state !== "ready")
        reason = EXTERNAL_REASONS[readiness.external.state] ?? "The external API is not ready";
      else if (host === "claude-code" && model !== "external")
        reason = "Claude Code imports use the external API. Complete the external API settings.";
      else if (
        model !== "external" &&
        !readiness.opencode.models.some((item) => `${item.provider}/${item.model}` === model)
      )
        reason =
          "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
      return reason ? `${hostLabel(host)}: ${s(reason)}` : null;
    })
    .find(Boolean);
  const previewReady = Boolean(
    preview &&
    preview.fingerprint === fingerprint &&
    preview.id === job?.id &&
    job.dryRun &&
    job.state === "done" &&
    !job.error &&
    !job.hosts?.some(
      (child) =>
        child.error || child.blocker || ["failed", "cancelled", "not-run"].includes(child.state)
    )
  );
  const disabled =
    busy ||
    running ||
    hosts.some((host) => listing[host]) ||
    readerBlocked ||
    Boolean(outputError || selectionBlocked);

  async function start(dryRun: boolean) {
    if (submitting.current || disabled || (!dryRun && (!previewReady || modelBlocked))) return;
    if (!dryRun) {
      const outputs = [draft.memories && s("Project memories"), draft.profile && s("User profile")]
        .filter(Boolean)
        .join(" · ");
      const models = hosts
        .map(
          (host) =>
            `${hostLabel(host)}: ${draft.hosts[host].modelChoice === "external" ? `${s("Saved external API")} (${readiness?.external.provider}/${readiness?.external.model})` : draft.hosts[host].modelChoice}`
        )
        .join("\n");
      if (
        !window.confirm(
          [
            s("This import makes model calls. Continue?"),
            hosts.map(hostLabel).join(" · "),
            s(draft.scope === "current-project" ? "Current project" : "All projects"),
            draft.project,
            outputs,
            models,
            workCounts(job ?? {}, s),
            ...(job?.hosts ?? []).map(
              (child) => `${hostLabel(child.host)}: ${workCounts(child, s)}`
            ),
          ]
            .filter(Boolean)
            .join("\n")
        )
      )
        return;
    }
    submitting.current = true;
    jobReplies.current.begin();
    setBusy(true);
    const startedWith = fingerprint;
    setPreview(null);
    try {
      const response = await settingsRequest<ImportJob>("/api/settings/imports", {
        method: "POST",
        body: JSON.stringify(groupRequest(draft, dryRun)),
      });
      if (!mounted.current) return;
      setJob(response);
      if (dryRun && startedWith === currentFingerprint.current)
        setPreview({ id: response.id, fingerprint: startedWith });
      setError("");
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
      // A competing job stays server-owned. Reconnect instead of retrying the request.
      void refreshJob().catch(() => {});
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function cancel() {
    if (submitting.current) return;
    submitting.current = true;
    jobReplies.current.begin();
    try {
      const response = await settingsRequest<{ job: ImportJob }>(
        "/api/settings/imports/current/cancel",
        { method: "POST", body: "{}" }
      );
      if (mounted.current) setJob(response.job);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4 min-w-0"
      aria-label={s("Import chat history")}
    >
      <h2 className="text-section-title font-semibold">{s("Import chat history")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Conversations populate project facts. User prompts populate personal preferences, recurring patterns, and workflow steps."
        )}
      </p>
      <p className="flex flex-wrap gap-3 text-sm">
        <a
          className="underline"
          href={ROUTES.project}
          onClick={(event) => {
            event.preventDefault();
            navigate(ROUTES.project);
          }}
        >
          {s("Project memories")}
        </a>
        <a
          className="underline"
          href={ROUTES.profile}
          onClick={(event) => {
            event.preventDefault();
            navigate(ROUTES.profile);
          }}
        >
          {s("User profile")}
        </a>
        <a
          className="underline"
          href={`${ROUTES.settings}#settings-section-profiles`}
          onClick={(event) => {
            event.preventDefault();
            navigate(`${ROUTES.settings}#settings-section-profiles`);
          }}
        >
          {s("Profile identity in Settings")}
        </a>
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
              onChange={(event) => changeHost(host, { enabled: event.target.checked })}
            />{" "}
            {hostLabel(host)}
          </label>
        ))}
        <button
          type="button"
          className={importButton}
          onClick={() =>
            change({
              hosts: {
                pi: { ...draft.hosts.pi, enabled: true },
                opencode: { ...draft.hosts.opencode, enabled: true },
                "claude-code": { ...draft.hosts["claude-code"], enabled: true },
              },
            })
          }
        >
          {s("All hosts")}
        </button>
        <span role="status">
          {s("Selected hosts")}: {hosts.length}
        </span>
      </div>
      <ImportOptions
        draft={draft}
        advanced={advanced}
        onChange={change}
        onAdvanced={() => setAdvanced((value) => !value)}
      />
      {IMPORT_HOSTS.map((host) => (
        <HostSessionSelection
          key={host}
          host={host}
          draft={draft}
          readiness={readiness}
          advanced={advanced}
          listing={Boolean(listing[host])}
          onChange={(patch) => changeHost(host, patch)}
          onList={(offset, refresh) => list(host, offset, refresh)}
          onUnresolved={() => {
            change({ scope: "all-projects" });
            setAdvanced(true);
          }}
        />
      ))}
      {outputError && <p role="alert">{s(outputError)}</p>}
      {!running && (selectionBlocked || modelBlocked) && (
        <p className="text-xs text-muted-foreground">{selectionBlocked ?? modelBlocked}</p>
      )}
      {!previewReady && !running && (
        <p className="text-xs text-muted-foreground">
          {s("Preview the current selection before starting an import.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={importButton}
          disabled={disabled}
          onClick={() => start(true)}
        >
          {s("Preview (dry run)")}
        </button>
        <button
          type="button"
          className={importButton}
          disabled={disabled || !previewReady || Boolean(modelBlocked)}
          onClick={() => start(false)}
        >
          {s("Start import")}
        </button>
        {running && (
          <button
            type="button"
            className={importButton}
            disabled={job?.state === "cancelling"}
            onClick={() => cancel()}
          >
            {s("Cancel after current unit")}
          </button>
        )}
      </div>
      {error && <p role="alert">{importFeedback(error, s)}</p>}
      <ImportResults job={job} />
    </section>
  );
}
