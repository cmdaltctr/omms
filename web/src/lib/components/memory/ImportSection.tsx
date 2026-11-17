import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { mergeListing } from "$lib/import-listing";
import { navigate } from "$lib/router";
import { memoryPath } from "$lib/routes";
import { useWriteHealth } from "$lib/write-health-store";
import { useSkillSettings } from "../skills/use-skill-settings";
import { statusText } from "./host-status";
import { importChecks } from "./import-checks";
import { ImportChecklist, ImportModelLine } from "./ImportChecklist";
import { ImportConfirmDialog } from "./ImportConfirmDialog";
import { ImportCustomise } from "./ImportCustomise";
import { ImportFinish } from "./ImportFinish";
import { progressBarView, reloadAfterFinish } from "./import-finish";
import { loadHostChoice, saveHostChoice } from "./import-host-choice";
import { jobForHost } from "./import-job-view";
import { defaultImportModel, importModelLine, modelBlockedReason } from "./import-model-blocker";
import { ImportProgressBar } from "./ImportProgressBar";
import { importFeedback, ImportResults } from "./ImportResults";
import { nothingToImport } from "./import-estimate";
import {
  applyDraftChange,
  emptySelection,
  groupRequest,
  initialImportDraft,
  membership,
  optionsError,
  previewFingerprint,
  selectableCount,
  selectedCount,
} from "./import-draft";
import {
  IMPORT_HOSTS,
  type HostDraft,
  type ImportDraft,
  type Readiness,
  type SessionPage,
} from "./import-types";
import { useImportJob } from "./use-import-job";
import { hostsWithHistory, listBody, missingFolders, useQuickImport } from "./use-quick-import";
import type { HostStatuses } from "./use-host-statuses";

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

// Reads as no saved choice, so loadHostChoice ticks the hosts it is given.
const NO_SAVED_CHOICE = { getItem: () => null, setItem: () => {} };
const PROFILE_ONLY = { memories: false, profile: true, skills: false, force: true } as const;
const PHASE_TEXT = {
  testing: "Testing the model…",
  listing: "Listing sessions…",
  previewing: "Checking what is new…",
} as const;

/**
 * The import panel: readiness checks, the model line, one primary button, progress and
 * the result, then a closed Customise section with every detailed control. One draft
 * serves both paths. The server owns execution order.
 */
export function ImportSection({
  profilePreset = 0,
  host: onlyHost,
  statuses,
}: { profilePreset?: number; host?: WebHost; statuses?: HostStatuses } = {}) {
  const s = useSettingsText();
  // Whether the overview found a saved host choice; without one, readiness ticks the hosts.
  const savedChoice = useRef(false);
  const [rawDraft, setDraft] = useState<ImportDraft>(() => {
    const fresh = initialImportDraft();
    if (onlyHost) {
      // A host view imports that host only.
      for (const host of IMPORT_HOSTS) fresh.hosts[host].enabled = host === onlyHost;
    }
    // With no hosts to tick, loadHostChoice returns the same draft unless a saved choice applied.
    const restored = onlyHost ? fresh : loadHostChoice(fresh);
    savedChoice.current = restored !== fresh;
    const draft = restored;
    // Re-analyse chat history arrives with the preset already applied.
    return profilePreset ? applyDraftChange(draft, PROFILE_ONLY) : draft;
  });
  // Skill turns count only while recording is on; the tick itself is kept as the user left it.
  const { snapshot: settings } = useSkillSettings();
  const recording = settings?.settings?.skillLearning?.value === true;
  const withRecording = (value: ImportDraft): ImportDraft =>
    recording ? value : { ...value, skills: false };
  const draft = withRecording(rawDraft);
  const [advanced, setAdvanced] = useState(false);
  const [customise, setCustomise] = useState(profilePreset > 0);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const jobs = useImportJob();
  const { job, running, busy, error, setError, mounted, refreshJob, post, cancel } = jobs;
  const { health, recheck } = useWriteHealth();
  const [preview, setPreview] = useState<{ id: string; fingerprint: string } | null>(null);
  const [listing, setListing] = useState<Partial<Record<WebHost, boolean>>>({});
  const listingVersions = useRef<Record<WebHost, number>>({ pi: 0, opencode: 0, "claude-code": 0 });
  const modelDefaulted = useRef(false);
  const fingerprint = previewFingerprint(draft);
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const view = jobForHost(job, onlyHost);
  const primary = onlyHost ? "Import new chats" : "Import all hosts";
  const hosts = IMPORT_HOSTS.filter((host) => draft.hosts[host].enabled);
  // The overview also passes each host with no history, so the checklist names it as left out.
  const panelHosts = onlyHost
    ? [onlyHost]
    : IMPORT_HOSTS.filter(
        (host) => draft.hosts[host].enabled || readiness?.defaultSourceFound?.[host] === false
      );
  const runs = statuses?.backfill.runs;
  const saved = statuses?.backfill.snapshot?.settings;
  const backfill = {
    pi: saved?.piBackfillModel?.globalValue as string | undefined,
    opencode: saved?.opencodeBackfillModel?.globalValue as string | undefined,
  };
  // Only the user's own tick is saved; the profile-only preset clears it for this visit.
  const savedSkills = useRef(rawDraft.skills);
  // The overview saves the hosts only once they are known (a saved choice, or the readiness
  // tick) and the user has changed something, so a default is never stored as a choice.
  const touched = useRef(false);
  useEffect(() => {
    if (onlyHost || !savedChoice.current || !touched.current) return;
    saveHostChoice({ ...rawDraft, skills: savedSkills.current });
  }, [rawDraft, onlyHost]);
  useEffect(() => {
    let active = true;
    const reload = () => {
      setPreview(null);
      void settingsRequest<Readiness>("/api/settings/imports/readiness")
        .then((value) => {
          if (active) setReadiness(value);
        })
        .catch(() => {
          if (active) setReadiness(null);
        });
    };
    reload();
    const stop = watchReadiness(reload);
    return () => {
      active = false;
      stop();
    };
  }, []);
  // A first visit to the overview ticks the hosts whose history exists here, once readiness loads.
  useEffect(() => {
    if (onlyHost || savedChoice.current || !readiness) return;
    savedChoice.current = true;
    const found = IMPORT_HOSTS.filter((host) => readiness.defaultSourceFound?.[host]);
    setDraft((previous) => loadHostChoice(previous, NO_SAVED_CHOICE, found));
  }, [readiness, onlyHost]);
  // Tick each host's import model once, from its backfill model, when both have loaded.
  useEffect(() => {
    if (modelDefaulted.current || !readiness || !saved) return;
    modelDefaulted.current = true;
    setDraft((previous) => {
      const next = { ...previous, hosts: { ...previous.hosts } };
      for (const host of IMPORT_HOSTS) {
        const model = host === "claude-code" ? null : backfill[host];
        next.hosts[host] = {
          ...next.hosts[host],
          modelChoice: defaultImportModel(host, model, readiness),
        };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when both have loaded
  }, [readiness, saved]);

  /** OK on the finish dialog: reload readiness, host status and the job without a page reload. */
  function onFinishOk() {
    void reloadAfterFinish(reloadSettingsSnapshot, refreshJob).then((failure) => {
      if (mounted.current && failure) setError(failure);
    });
  }

  useEffect(() => {
    if (!profilePreset) return;
    setDraft((previous) => applyDraftChange(previous, PROFILE_ONLY));
    setCustomise(true);
    setPreview(null);
  }, [profilePreset]);

  function change(patch: Partial<ImportDraft>) {
    touched.current = true;
    if (patch.skills !== undefined) savedSkills.current = patch.skills;
    setPreview(null);
    setDraft((previous) => applyDraftChange(previous, patch));
  }
  function changeHost(host: WebHost, patch: Partial<HostDraft>) {
    touched.current = true;
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
        body: JSON.stringify(listBody(draft, host, offset, refresh)),
      });
      if (!mounted.current || listingVersions.current[host] !== version) return;
      setDraft((previous) => {
        if (membership(withRecording(previous), host) !== listedWith) return previous;
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

  const apiUrl = settings?.settings?.memoryApiUrl;
  const quick = useQuickImport({
    draft,
    runs,
    jobs,
    // A test result counts only for the model it tested; the key itself never goes in.
    modelKey: JSON.stringify([
      readiness?.external.provider ?? null,
      readiness?.external.model ?? null,
      apiUrl?.value ?? apiUrl?.globalValue ?? null,
    ]),
    button: primary,
    // Keep the quick flow's lists in the draft, unless the user changed the options meanwhile.
    keepLists: (listed, listedHosts) =>
      setDraft((previous) => {
        const next = { ...previous, hosts: { ...previous.hosts } };
        for (const host of listedHosts)
          if (membership(withRecording(previous), host) === listed.hosts[host].listedWith)
            next.hosts[host] = { ...listed.hosts[host], enabled: previous.hosts[host].enabled };
        return next;
      }),
  });
  const checks = importChecks({
    hosts: panelHosts,
    draft,
    readiness,
    writeHealth: health,
    modelTest: quick.modelTest,
  });
  const chosen = hostsWithHistory(panelHosts, draft, readiness);
  // Customise shows the same model state as the checklist.
  const modelRow = checks.rows.find((row) => row.id === "model");
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
  const modelBlocked = modelBlockedReason(hosts, draft, readiness, s);
  const previewReady = Boolean(
    preview &&
    preview.fingerprint === fingerprint &&
    preview.id === job?.id &&
    job.dryRun &&
    job.state === "done" &&
    !job.error &&
    !nothingToImport(job) &&
    !job.hosts?.some(
      (child) =>
        child.error || child.blocker || ["failed", "cancelled", "not-run"].includes(child.state)
    )
  );
  const working = busy || running || quick.phase !== "idle";
  const disabled =
    working ||
    hosts.some((host) => listing[host]) ||
    readerBlocked ||
    Boolean(outputError || selectionBlocked);

  async function previewByHand() {
    if (jobs.submitting.current || disabled) return;
    const startedWith = fingerprint;
    setPreview(null);
    try {
      const response = await post(() => groupRequest(draft, true));
      if (!mounted.current) return;
      if (startedWith === currentFingerprint.current)
        setPreview({ id: response.id, fingerprint: startedWith });
      setError("");
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    }
  }

  function openCustomise(focusModel = false) {
    setCustomise(true);
    // An unticked host (one with no history) has its section hidden, so focus a ticked one.
    const target = onlyHost ?? hosts[0];
    if (!focusModel || !target || typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(() => document.getElementById(`import-model-${target}`)?.focus());
  }

  const bar = progressBarView(view);
  const minutesLeft = bar ? (runs?.[bar.host]?.run?.minutesLeft ?? null) : null;
  const missing = missingFolders(panelHosts, draft, view);
  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Import chat history")}
    >
      <h2 className="text-section-title font-semibold">{s("Import chat history")}</h2>
      <ImportChecklist
        rows={checks.rows}
        testFailed={quick.modelTest.state === "failed"}
        onRecheck={() => void recheck()}
      />
      <ImportModelLine
        line={importModelLine(panelHosts, draft, readiness, backfill)}
        onChange={() => openCustomise(true)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={working || checks.blocked || Boolean(outputError) || chosen.length === 0}
          onClick={() => void quick.start(chosen)}
        >
          {s(primary)}
        </Button>
        {running && (
          <Button
            type="button"
            variant="outline"
            disabled={job?.state === "cancelling"}
            onClick={() => void cancel()}
          >
            {s("Stop after the current step")}
          </Button>
        )}
      </div>
      {!onlyHost && chosen.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {s("Imports chats from {hosts}. It makes model calls and can cost money.").replace(
            "{hosts}",
            chosen.map(hostLabel).join(", ")
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {s("Chats already imported are skipped, so running an import again is safe.")}
      </p>
      {modelRow?.state === "untested" && (
        <p className="text-xs text-muted-foreground">
          {s("Checks the model with one short call first.")}
        </p>
      )}
      {quick.phase !== "idle" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s(PHASE_TEXT[quick.phase])}
        </p>
      )}
      {quick.notice && (
        <p role="status" className="text-sm">
          {s(quick.notice)}
        </p>
      )}
      {error && <p role="alert">{importFeedback(error, s)}</p>}
      {missing.map(({ host, count }) => (
        <p key={host} className="text-sm">
          {!onlyHost && <bdi dir="ltr">{hostLabel(host)}</bdi>}
          {!onlyHost && ": "}
          {count === 1
            ? s("1 session skipped: folder missing.")
            : s("{n} sessions skipped: folder missing.").replace("{n}", String(count))}{" "}
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={() => navigate(`${memoryPath(host)}#directory-maps-${host}`)}
          >
            {s("Resolve")}
          </Button>
        </p>
      ))}
      <ImportProgressBar job={view} minutesLeft={minutesLeft} />
      <ImportFinish
        job={view}
        onReload={onFinishOk}
        onRetry={() => {
          // A host view retries its own host only; the overview retries the job's hosts.
          const failed = onlyHost ? [onlyHost] : (job?.hosts ?? []).map((child) => child.host);
          void quick.start(failed.length ? failed : chosen, true);
        }}
      />
      {view && (
        <details className="min-w-0 rounded-lg border border-border p-3">
          <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
            {s("Details")}
          </summary>
          <div className="mt-3 min-w-0">
            <ImportResults job={view} />
          </div>
        </details>
      )}
      <ImportCustomise
        host={onlyHost}
        open={customise}
        onToggle={setCustomise}
        draft={draft}
        recording={recording}
        readiness={readiness}
        modelState={modelRow ? statusText(s, modelRow.text) : ""}
        advanced={advanced}
        listing={listing}
        blockedReason={running ? null : (selectionBlocked ?? modelBlocked)}
        outputError={outputError}
        previewReady={previewReady || running}
        previewDisabled={disabled}
        startDisabled={disabled || !previewReady || Boolean(modelBlocked)}
        onChange={change}
        onChangeHost={changeHost}
        onAdvanced={() => setAdvanced((value) => !value)}
        onList={(host, offset, refresh) => void list(host, offset, refresh)}
        onPreview={() => void previewByHand()}
        onStart={() => job && previewReady && quick.askAbout(job, draft, hosts)}
      />
      {quick.confirm && (
        <ImportConfirmDialog
          estimate={quick.confirm.estimate}
          hosts={quick.confirm.from}
          force={quick.confirm.draft.force}
          onConfirm={quick.confirmImport}
          onClose={quick.closeConfirm}
        />
      )}
    </section>
  );
}
