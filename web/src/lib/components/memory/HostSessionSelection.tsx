import { Select } from "$lib/components/ui/select";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { ImportSourcePicker } from "../settings/ImportSourcePicker";
import {
  emptySelection,
  membership,
  selectableCount,
  selectedCount,
  toggleSession,
} from "./import-draft";
import { importButton, importField } from "./ImportOptions";
import type { HostDraft, ImportDraft, Readiness, SessionRow } from "./import-types";

export function HostSessionSelection({
  host,
  draft,
  readiness,
  advanced,
  listing,
  onChange,
  onList,
  onUnresolved,
}: {
  host: WebHost;
  draft: ImportDraft;
  readiness: Readiness | null;
  advanced: boolean;
  listing: boolean;
  onChange: (patch: Partial<HostDraft>) => void;
  onList: (offset: number, refresh: boolean) => void;
  onUnresolved: () => void;
}) {
  const s = useSettingsText();
  const child = draft.hosts[host];
  const page = child.page;
  const outdated = page && child.listedWith !== membership(draft, host);
  const total = selectableCount(draft, host);
  const selected = (row: SessionRow) =>
    child.selection.mode === "all"
      ? !child.selection.excluded.has(row.key)
      : child.selection.picked.has(row.key);
  const via = {
    recorded: s("recorded"),
    mapped: s("mapped"),
    worktree: s("project root"),
    unresolved: s("missing"),
  };
  const piBlocked = host === "pi" && readiness?.piReader.available === false;
  return (
    <section
      hidden={!child.enabled}
      aria-label={hostLabel(host)}
      className="space-y-3 rounded-lg border border-border p-3 min-w-0"
    >
      <h3 className="text-subsection-title font-semibold">{hostLabel(host)}</h3>
      <p className="text-xs text-muted-foreground">
        {s("Source")}:{" "}
        <bdi dir="ltr" className="break-all">
          {child.source?.displayPath ?? page?.source.displayPath ?? s("default location")}
        </bdi>
      </p>
      {piBlocked && (
        <p role="alert">
          {s(
            readiness?.piReader.reason ??
              "Pi session reader is unavailable. Fix the reader or deselect Pi."
          )}
        </p>
      )}
      {host === "claude-code" && readiness?.claudeCode && (
        <p className="text-xs text-muted-foreground">
          {s("Claude Code transcripts")}:{" "}
          <bdi dir="ltr" className="font-mono break-all">
            {readiness.claudeCode.defaultRoot}
          </bdi>{" "}
          ({s(readiness.claudeCode.defaultRootFound ? "found" : "not found")}).{" "}
          {s("Claude Code imports always use the external API.")}
        </p>
      )}
      <div hidden={!advanced}>
        <ImportSourcePicker host={host} onChoose={(source) => onChange({ source })} />
      </div>
      <button
        type="button"
        className={importButton}
        disabled={listing || piBlocked}
        onClick={() => onList(0, true)}
      >
        {s(page ? "Refresh list" : "List sessions")}
      </button>
      {outdated && (
        <p role="status" className="text-sm">
          {s("Options changed. Refresh the session list first.")}
        </p>
      )}
      {page && draft.scope === "current-project" && page.unresolvedCount > 0 && (
        <p className="text-sm">
          {s("Sessions with directories that no longer exist")}: {page.unresolvedCount}.{" "}
          <button type="button" className="underline" onClick={onUnresolved}>
            {s("Show them and add a directory map")}
          </button>
        </p>
      )}
      {page && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status">
              {s("Selected")}: {selectedCount(draft, host)} / {total}
            </span>
            <button
              type="button"
              className={importButton}
              disabled={total === 0}
              onClick={() => onChange({ selection: { mode: "all", excluded: new Set() } })}
            >
              {s("Select all matching")} ({total})
            </button>
            <button
              type="button"
              className={importButton}
              onClick={() => onChange({ selection: emptySelection() })}
            >
              {s("Clear selection")}
            </button>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  {["Select", "Created", "Session", "Project directory", "Resolved by"].map(
                    (label) => (
                      <th key={label} className="p-1">
                        {s(label)}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="p-1">
                      <input
                        type="checkbox"
                        aria-label={`${hostLabel(host)}: ${s("Select")} ${row.sessionId ?? row.key}`}
                        checked={row.selectable && selected(row)}
                        disabled={!row.selectable}
                        onChange={() =>
                          onChange({ selection: toggleSession(child.selection, row) })
                        }
                      />
                    </td>
                    <td className="p-1 whitespace-nowrap">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="p-1 font-mono text-xs">
                      <bdi dir="ltr">{row.sessionId ?? row.key}</bdi>
                    </td>
                    <td className="p-1 font-mono text-xs break-all">
                      <bdi dir="ltr">{row.directory ?? row.recordedDirectory ?? "—"}</bdi>
                    </td>
                    <td className="p-1">{via[row.via]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {page.total === 0 && <p className="text-sm">{s("No sessions match.")}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className={importButton}
              disabled={listing || page.offset === 0}
              onClick={() => onList(Math.max(0, page.offset - 50), false)}
            >
              {s("Previous")}
            </button>
            <span>
              {page.total ? page.offset + 1 : 0}–{Math.min(page.offset + 50, page.total)} /{" "}
              {page.total}
            </span>
            <button
              type="button"
              className={importButton}
              disabled={listing || page.offset + 50 >= page.total}
              onClick={() => onList(page.offset + 50, false)}
            >
              {s("Next")}
            </button>
          </div>
        </div>
      )}
      <label className="block text-sm">
        {s("Import model")}
        <div dir="ltr">
          <Select
            aria-label={s("Import model")}
            className={importField}
            value={child.modelChoice}
            onChange={(event) => onChange({ modelChoice: event.target.value })}
          >
            <option value="">{s("None")}</option>
            {host !== "claude-code" &&
              readiness?.opencode.models.map((model) => (
                <option
                  key={`${model.provider}/${model.model}`}
                  value={`${model.provider}/${model.model}`}
                >
                  {model.name} ({model.provider}/{model.model})
                </option>
              ))}
            <option value="external">
              {s("Saved external API")}
              {readiness && readiness.external.state !== "ready" ? ` (${s("not ready")})` : ""}
            </option>
          </Select>
        </div>
      </label>
      {host !== "claude-code" && readiness && !readiness.opencode.available && (
        <p className="text-xs text-muted-foreground">
          {s(
            "An import with an OpenCode signed-in model runs from the terminal or with /import in OpenCode."
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{s("Configured, not tested.")}</p>
    </section>
  );
}
