import { useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import { onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { localDayEnd, localDayStart } from "$lib/import-dates";
import { mergeListing } from "$lib/import-listing";
import type { WebHost } from "$lib/host-label";
import { ImportSourcePicker, type ChosenSource } from "./ImportSourcePicker";

type Host = WebHost;
type Job = {
  id: string;
  host: string;
  dryRun: boolean;
  state: string;
  sessions: number;
  processed: number;
  total: number;
  report?: string;
  error?: string;
};
type Row = {
  key: string;
  sessionId: string | null;
  createdAt: number | null;
  recordedDirectory: string | null;
  directory: string | null;
  via: "mapped" | "recorded" | "worktree" | "unresolved";
  selectable: boolean;
};
type SessionPage = {
  source: ChosenSource;
  total: number;
  offset: number;
  rows: Row[];
  unresolvedCount: number;
  revision: string;
  listedAt: number;
};
type Readiness = {
  external: { state: string; provider: string; model: string | null };
  opencode: {
    available: boolean;
    models: Array<{ provider: string; model: string; name: string }>;
  };
  piReader: { available: boolean; reason?: string };
  claudeCode?: { available: boolean; defaultRoot: string; defaultRootFound: boolean };
};
type Selection =
  { mode: "ids"; picked: Map<string, string> } | { mode: "all"; excluded: Set<string> };

const PAGE_SIZE = 50;
const MAX_PICKED = 1000;
const EXTERNAL_REASONS: Record<string, string> = {
  "missing-model": "The external API has no memoryModel in the global config",
  "missing-url": "The external API has no memoryApiUrl in the global config",
  "missing-key":
    "The external API key is missing in the OpenCode process; check memoryApiKey and its env:// or file:// source",
  "unsupported-provider": "The memoryProvider in the global config is not supported for imports",
};
const emptySelection = (): Selection => ({ mode: "ids", picked: new Map() });

function parseMaps(text: string, message: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index < 1 || index === line.length - 1) throw new Error(message);
      return { from: line.slice(0, index), to: line.slice(index + 1) };
    });
}

/** Reload import readiness after every settings save on the page. */
export function watchReadiness(reload: () => void): () => void {
  return onSettingsSnapshot(() => reload());
}

/** The saved external API option, without its model name, which a save can change. */
export function externalOptionLabel(
  readiness: { external: { state: string } } | null,
  s: (message: string) => string
): string {
  const notReady = readiness && readiness.external.state !== "ready";
  return `${s("Saved external API")}${notReady ? ` — ${s("not ready")}` : ""}`;
}

export function ImportSection() {
  const s = useSettingsText();
  const [host, setHost] = useState<Host>("pi");
  const [source, setSource] = useState<ChosenSource | null>(null);
  const [scope, setScope] = useState<"current-project" | "all-projects">("current-project");
  const [project, setProject] = useState("");
  const [maps, setMaps] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [profileBatch, setProfileBatch] = useState("");
  const [force, setForce] = useState(false);
  const [skipMemories, setSkipMemories] = useState(false);
  const [skipProfile, setSkipProfile] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState<SessionPage | null>(null);
  const [listedWith, setListedWith] = useState("");
  const [stale, setStale] = useState(false);
  const [listing, setListing] = useState(false);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [chosenModel, setModel] = useState("");
  // Claude Code imports have no session model: only the external API applies.
  const model = host === "claude-code" && chosenModel !== "external" ? "" : chosenModel;
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void settingsRequest<Readiness>("/api/settings/imports/readiness")
      .then((value) => {
        setReadiness(value);
        const first = value.opencode.models[0];
        setModel(
          first
            ? `${first.provider}/${first.model}`
            : value.external.state === "ready"
              ? "external"
              : ""
        );
      })
      .catch(() => setReadiness(null));
    void settingsRequest<{ job: Job | null }>("/api/settings/imports/current")
      .then((value) => setJob(value.job))
      .catch(() => {});
    // A save elsewhere on the page can change the external API; keep the user's model choice.
    return watchReadiness(() => {
      void settingsRequest<Readiness>("/api/settings/imports/readiness")
        .then(setReadiness)
        .catch(() => setReadiness(null));
    });
  }, []);

  useEffect(() => {
    if (job?.state !== "running" && job?.state !== "cancelling") return;
    const timer = setInterval(() => {
      void settingsRequest<{ job: Job | null }>("/api/settings/imports/current")
        .then((value) => setJob(value.job))
        .catch((cause: Error) => setError(cause.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.state]);

  // The options that decide which sessions match; changing any makes the list stale.
  const membership = JSON.stringify([host, source?.sourceToken, scope, project, maps]);
  const outdated = Boolean(page) && (stale || membership !== listedWith);

  function matchBody() {
    const pathMaps = parseMaps(maps, s("Directory maps must be old=new, one per line"));
    return {
      host,
      ...(source ? { source: source.sourceToken } : {}),
      scope,
      ...(scope === "current-project" && project ? { project } : {}),
      pathMaps,
    };
  }

  async function list(offset: number, refresh: boolean) {
    setListing(true);
    try {
      const result = await settingsRequest<SessionPage>("/api/settings/imports/sessions", {
        method: "POST",
        body: JSON.stringify({ ...matchBody(), offset, limit: PAGE_SIZE, refresh }),
      });
      const merged = mergeListing(page, result, refresh);
      if (!merged.sameListing) setSelection(emptySelection());
      setPage(merged.page);
      setListedWith(membership);
      setStale(false);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setListing(false);
    }
  }

  const selectableTotal = page
    ? page.total - (scope === "all-projects" ? page.unresolvedCount : 0)
    : 0;
  const selectedCount =
    selection.mode === "all" ? selectableTotal - selection.excluded.size : selection.picked.size;
  const isSelected = (row: Row) =>
    selection.mode === "all" ? !selection.excluded.has(row.key) : selection.picked.has(row.key);

  function toggle(row: Row) {
    if (!row.selectable || !row.directory) return;
    if (selection.mode === "all") {
      const excluded = new Set(selection.excluded);
      if (excluded.has(row.key)) excluded.delete(row.key);
      else excluded.add(row.key);
      setSelection({ mode: "all", excluded });
    } else {
      const picked = new Map(selection.picked);
      if (picked.has(row.key)) picked.delete(row.key);
      else picked.set(row.key, row.directory);
      setSelection({ mode: "ids", picked });
    }
  }

  const needsModel = !skipMemories || !skipProfile;
  const piBlocked = host === "pi" && readiness?.piReader.available === false;
  const modelBlocked = !needsModel
    ? null
    : !readiness
      ? s("Model readiness is unknown. Reload the page.")
      : !model
        ? host === "claude-code"
          ? s("Claude Code imports use the external API. Complete the external API settings.")
          : s(
              "No import model is ready. Connect a model in OpenCode or complete the external API settings."
            )
        : model === "external" && readiness.external.state !== "ready"
          ? s(EXTERNAL_REASONS[readiness.external.state] ?? "The external API is not ready")
          : null;
  const selectionBlocked = !page
    ? s("List sessions first.")
    : outdated
      ? s("Options changed. Refresh the session list first.")
      : selectedCount === 0
        ? s("Select at least one session.")
        : selection.mode === "ids" && selection.picked.size > MAX_PICKED
          ? s("Select at most 1000 sessions one by one, or use Select all matching.")
          : null;
  const running = job?.state === "running" || job?.state === "cancelling";

  async function start(dryRun: boolean) {
    if (!page) return;
    try {
      const sinceMs = since ? localDayStart(since) : undefined;
      const untilMs = until ? localDayEnd(until) : undefined;
      const body = {
        host,
        source: page.source.sourceToken,
        selection:
          selection.mode === "all"
            ? {
                mode: "all",
                excludedKeys: [...selection.excluded],
                revision: page.revision,
                listedAt: page.listedAt,
              }
            : {
                mode: "ids",
                sessions: [...selection.picked].map(([key, directory]) => ({ key, directory })),
                listedAt: page.listedAt,
              },
        options: {
          dryRun,
          force,
          skipMemories,
          skipProfile,
          scope,
          ...(scope === "current-project" && project ? { project } : {}),
          ...(sinceMs !== undefined ? { since: sinceMs } : {}),
          ...(untilMs !== undefined ? { until: untilMs } : {}),
          ...(profileBatch ? { profileBatch: Number(profileBatch) } : {}),
          pathMaps: parseMaps(maps, s("Directory maps must be old=new, one per line")),
        },
        ...(model ? { modelChoice: model } : {}),
      };
      const response = await settingsRequest<Job>("/api/settings/imports", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setJob(response);
      setError("");
    } catch (cause) {
      const message = (cause as Error).message;
      if (/out of date|changed|no longer/i.test(message)) setStale(true);
      setError(message);
    }
  }

  async function cancel() {
    try {
      const response = await settingsRequest<{ job: Job }>("/api/settings/imports/current/cancel", {
        method: "POST",
        body: "{}",
      });
      setJob(response.job);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function showUnresolved() {
    setScope("all-projects");
    setAdvanced(true);
  }

  const viaLabel: Record<Row["via"], string> = {
    recorded: s("recorded"),
    mapped: s("mapped"),
    worktree: s("project root"),
    unresolved: s("missing"),
  };
  const field = "mt-1 block w-full rounded border border-border bg-background p-2";
  const button = "rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Import and backfill")}
    >
      <h2 className="text-lg font-medium">{s("Import and backfill")}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          {s("History host")}
          <Select
            aria-label={s("History host")}
            className={field}
            value={host}
            onChange={(event) => {
              const next = event.target.value as Host;
              setHost(next);
              if (next === "claude-code" && readiness?.external.state === "ready") {
                setModel("external");
              }
              setSource(null);
              setPage(null);
              setSelection(emptySelection());
            }}
          >
            <option value="pi">Pi</option>
            <option value="opencode">OpenCode</option>
            <option value="claude-code">Claude Code</option>
          </Select>
        </label>
        <button
          type="button"
          className={button}
          disabled={listing}
          onClick={() => void list(0, true)}
        >
          {page ? s("Refresh list") : s("List sessions")}
        </button>
        <button type="button" className={button} onClick={() => setAdvanced(!advanced)}>
          {advanced ? s("Hide advanced options") : s("Advanced options")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {s("Source")}: {source?.displayPath ?? page?.source.displayPath ?? s("default location")}
        {" · "}
        {scope === "current-project" ? s("Current project") : s("All projects")}
      </p>
      {piBlocked && <p role="alert">{readiness?.piReader.reason}</p>}
      {host === "claude-code" && readiness?.claudeCode && (
        <p className="text-xs text-muted-foreground">
          {s("Claude Code transcripts")}:{" "}
          <span className="font-mono break-all">{readiness.claudeCode.defaultRoot}</span> (
          {readiness.claudeCode.defaultRootFound ? s("found") : s("not found")}).{" "}
          {s("Claude Code imports always use the external API.")}
        </p>
      )}

      {advanced && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <ImportSourcePicker host={host} onChoose={setSource} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {s("Scope")}
              <Select
                aria-label={s("Scope")}
                className={field}
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="current-project">{s("Current project")}</option>
                <option value="all-projects">{s("All projects")}</option>
              </Select>
            </label>
            {scope === "current-project" && (
              <label className="text-sm">
                {s("Project directory")}
                <input
                  className={field}
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  placeholder={s("Current directory")}
                />
              </label>
            )}
            <label className="text-sm">
              {s("Prompt date from")}
              <input
                type="date"
                className={field}
                value={since}
                onChange={(event) => setSince(event.target.value)}
              />
            </label>
            <label className="text-sm">
              {s("Prompt date to")}
              <input
                type="date"
                className={field}
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </label>
            <label className="text-sm">
              {s("Profile batch size")}
              <input
                inputMode="numeric"
                className={field}
                value={profileBatch}
                onChange={(event) => setProfileBatch(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {s(
              "Prompt dates are inclusive, use your time zone, and filter the turns inside each session, not the list. Empty dates include every turn."
            )}
          </p>
          <label className="block text-sm">
            {s("Directory maps (old=new, one per line)")}
            <textarea
              className={field}
              rows={2}
              value={maps}
              onChange={(event) => setMaps(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ["Force reimport", force, setForce],
                ["Skip memories", skipMemories, setSkipMemories],
                ["Skip profile", skipProfile, setSkipProfile],
              ] as const
            ).map(([label, checked, set]) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => set(event.target.checked)}
                />{" "}
                {s(label)}
              </label>
            ))}
          </div>
        </div>
      )}

      {outdated && page && (
        <p role="status" className="text-sm text-amber-600">
          {s("Options changed. Refresh the session list first.")}
        </p>
      )}
      {page && scope === "current-project" && page.unresolvedCount > 0 && (
        <p className="text-sm">
          {s("Sessions with directories that no longer exist")}: {page.unresolvedCount}.{" "}
          <button type="button" className="underline" onClick={showUnresolved}>
            {s("Show them and add a directory map")}
          </button>
        </p>
      )}

      {page && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status">
              {s("Selected")}: {selectedCount} / {selectableTotal}
            </span>
            <button
              type="button"
              className={button}
              disabled={selectableTotal === 0}
              onClick={() => setSelection({ mode: "all", excluded: new Set() })}
            >
              {s("Select all matching")} ({selectableTotal})
            </button>
            <button type="button" className={button} onClick={() => setSelection(emptySelection())}>
              {s("Clear selection")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-1">
                    <span className="sr-only">{s("Select")}</span>
                  </th>
                  <th className="p-1">{s("Created")}</th>
                  <th className="p-1">{s("Session")}</th>
                  <th className="p-1">{s("Project directory")}</th>
                  <th className="p-1">{s("Resolved by")}</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="p-1">
                      <input
                        type="checkbox"
                        aria-label={`${s("Select")} ${row.sessionId ?? row.key}`}
                        checked={row.selectable && isSelected(row)}
                        disabled={!row.selectable}
                        onChange={() => toggle(row)}
                      />
                    </td>
                    <td className="p-1 whitespace-nowrap">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="p-1 font-mono text-xs">{row.sessionId ?? row.key}</td>
                    <td className="p-1 font-mono text-xs break-all">
                      {row.directory ?? row.recordedDirectory ?? "—"}
                    </td>
                    <td className="p-1">{viaLabel[row.via]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {page.total === 0 && <p className="text-sm">{s("No sessions match.")}</p>}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              className={button}
              disabled={listing || page.offset === 0}
              onClick={() => void list(Math.max(0, page.offset - PAGE_SIZE), false)}
            >
              {s("Previous")}
            </button>
            <span>
              {page.total ? page.offset + 1 : 0}–{Math.min(page.offset + PAGE_SIZE, page.total)} /{" "}
              {page.total}
            </span>
            <button
              type="button"
              className={button}
              disabled={listing || page.offset + PAGE_SIZE >= page.total}
              onClick={() => void list(page.offset + PAGE_SIZE, false)}
            >
              {s("Next")}
            </button>
          </div>
        </div>
      )}

      <label className="block text-sm">
        {s("Import model")}
        <Select
          aria-label={s("Import model")}
          className={field}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">{s("None")}</option>
          {host !== "claude-code" &&
            readiness?.opencode.models.map((item) => (
              <option
                key={`${item.provider}/${item.model}`}
                value={`${item.provider}/${item.model}`}
              >
                {item.name} ({item.provider}/{item.model})
              </option>
            ))}
          <option value="external">{externalOptionLabel(readiness, s)}</option>
        </Select>
      </label>
      {host !== "claude-code" && readiness && !readiness.opencode.available && (
        <p className="text-xs text-muted-foreground">
          {s(
            "An import with an OpenCode signed-in model runs from the terminal or with /import in OpenCode."
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {s("Configured, not tested.")}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => document.getElementById("settings-health")?.scrollIntoView()}
        >
          {s("Test models in Health")}
        </button>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={running || piBlocked || Boolean(selectionBlocked)}
          onClick={() => void start(true)}
        >
          {s("Preview (dry run)")}
        </button>
        <button
          type="button"
          className={button}
          disabled={running || piBlocked || Boolean(selectionBlocked) || Boolean(modelBlocked)}
          onClick={() => void start(false)}
        >
          {s("Start import")}
        </button>
        {running && (
          <button
            type="button"
            className={button}
            disabled={job?.state === "cancelling"}
            onClick={() => void cancel()}
          >
            {s("Cancel after current unit")}
          </button>
        )}
      </div>
      {(selectionBlocked || modelBlocked) && !running && (
        <p className="text-xs text-muted-foreground">{selectionBlocked ?? modelBlocked}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {job && (
        <div role="status" className="text-sm">
          {job.host} · {job.dryRun ? s("Preview (dry run)") : s("Import")} · {s(job.state)} ·{" "}
          {job.sessions} {s("sessions")} · {job.processed}/{job.total} {s("units")}
          {job.error && <p role="alert">{job.error}</p>}
          {job.report && (
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">
              {job.report}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
