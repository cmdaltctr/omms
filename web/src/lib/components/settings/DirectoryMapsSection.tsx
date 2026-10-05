import { useEffect, useRef, useState } from "react";
import {
  onSettingsSnapshot,
  publishSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  SettingsRequestError,
} from "$lib/settings-api";
import { mapsToSave, type MapDecision, type PathMap } from "$lib/external-api-settings";
import { useSettingsText } from "$lib/i18n/settings";
import {
  reviewDirectoryMaps,
  confirmedMapsToSave,
  selectWithTargets,
  clearSelection,
  type DirectoryMapReview,
} from "$lib/directory-maps";
import { DirectoryMapHost } from "./DirectoryMapHost";
import { DirectoryMapReviewDialog } from "./DirectoryMapReviewDialog";

type Snapshot = {
  revision: string;
  settings?: { importPathMaps?: { globalValue?: PathMap[] } };
};
type Host = "pi" | "opencode" | "claude-code";
type Suggested = { directory: string; sessions: number; suggestion: string | null };
type View = {
  saved: PathMap[];
  pi: Suggested[];
  opencode: Suggested[];
  "claude-code"?: Suggested[];
};

export function DirectoryMapsSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState<View>();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, MapDecision>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ host: Host; review: DirectoryMapReview }>();
  const [reviewError, setReviewError] = useState("");
  const [refreshNeeded, setRefreshNeeded] = useState<"saved" | "conflict">();
  const saving = useRef(false);
  const load = () =>
    settingsRequest<View>("/api/settings/import-maps")
      .then((value) => {
        setView(value);
        setRemoved(new Set());
        setDecisions({});
      })
      .catch((error: Error) => setMessage(error.message));
  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void load();
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function smartResolve(host: Host, rows: Suggested[]) {
    if (saving.current || refreshNeeded) return;
    setReviewError("");
    setPending({ host, review: reviewDirectoryMaps(rows, decisions) });
  }

  function decide(row: Suggested, change: Partial<MapDecision>) {
    setDecisions((previous) => {
      const current = previous[row.directory] ?? {
        directory: row.directory,
        target: row.suggestion ?? "",
        accepted: false,
      };
      return { ...previous, [row.directory]: { ...current, ...change } };
    });
  }

  async function save() {
    if (!snapshot || !view) return;
    const importPathMaps = mapsToSave(view.saved, removed, Object.values(decisions));
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: { importPathMaps }, revision: snapshot.revision }),
      });
      setMessage(s("Saved. Maps apply to the next import or backfill run."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    await load();
    setBusy(false);
  }

  async function refreshReview() {
    const [nextSnapshot, nextView] = await Promise.all([
      settingsRequest<Snapshot>("/api/settings"),
      settingsRequest<View>("/api/settings/import-maps"),
    ]);
    publishSettingsSnapshot(nextSnapshot);
    setView(nextView);
    setRefreshNeeded(undefined);
  }

  async function recoverRefresh() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    const wasSaved = refreshNeeded === "saved";
    try {
      await refreshReview();
      if (wasSaved) setMessage("Saved. Maps apply to the next import or backfill run.");
      else if (pending)
        setReviewError("Settings changed elsewhere. Review these maps and confirm again.");
      else setMessage("Settings refreshed. No maps were saved.");
    } catch {
      if (wasSaved)
        setMessage(
          "Maps were saved, but the list could not be refreshed. Refresh the list without saving again."
        );
      else if (pending)
        setReviewError(
          "Settings changed elsewhere and could not be refreshed. Refresh the list before confirming again."
        );
      else setMessage("Settings could not be refreshed. Try Refresh list again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function confirm() {
    if (!snapshot || !view || !pending?.review.maps.length || saving.current || refreshNeeded)
      return;
    saving.current = true;
    setBusy(true);
    setReviewError("");
    const reviewed = pending.review.maps;
    const importPathMaps = confirmedMapsToSave(
      snapshot.settings?.importPathMaps?.globalValue ?? view.saved,
      reviewed
    );
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: { importPathMaps }, revision: snapshot.revision }),
      });
    } catch (error) {
      const conflict = error instanceof SettingsRequestError && error.status === 409;
      setReviewError(
        conflict
          ? "Settings changed elsewhere. Review these maps and confirm again."
          : "Maps could not be saved. Review the targets and confirm again."
      );
      if (conflict) {
        try {
          await refreshReview();
        } catch {
          setRefreshNeeded("conflict");
          setReviewError(
            "Settings changed elsewhere and could not be refreshed. Refresh the list before confirming again."
          );
        }
      }
      saving.current = false;
      setBusy(false);
      return;
    }
    // Retire global source decisions only after persistence succeeds.
    const sources = new Set(reviewed.map((map) => map.from));
    setDecisions((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([source]) => !sources.has(source)))
    );
    setRemoved((previous) => new Set([...previous].filter((source) => !sources.has(source))));
    setView((previous) => (previous ? { ...previous, saved: importPathMaps } : previous));
    setPending(undefined);
    setMessage("Saved. Maps apply to the next import or backfill run.");
    try {
      await refreshReview();
    } catch {
      setRefreshNeeded("saved");
      setMessage(
        "Maps were saved, but the list could not be refreshed. Refresh the list without saving again."
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      id="directory-maps"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Directory maps")}
    >
      <h2 className="text-section-title font-semibold">{s("Directory maps")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Map a directory that was moved or deleted to the project it belongs to. A change applies to the next import or backfill run."
        )}
      </p>
      <h3 className="text-subsection-title font-semibold">{s("Saved maps")}</h3>
      <p className="text-xs text-muted-foreground">{s("Saved maps apply to every host.")}</p>
      {!view?.saved.length && <p className="text-sm text-muted-foreground">{s("none")}</p>}
      <ul className="space-y-1 text-sm">
        {view?.saved.map((map) => (
          <li key={map.from} className="flex flex-wrap items-center gap-2">
            <span className={removed.has(map.from) ? "line-through" : ""}>
              <code dir="ltr" className="break-all">
                {map.from}
              </code>{" "}
              →{" "}
              <code dir="ltr" className="break-all">
                {map.to}
              </code>
            </span>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-xs"
              onClick={() =>
                setRemoved((previous) => {
                  const next = new Set(previous);
                  if (next.has(map.from)) next.delete(map.from);
                  else next.add(map.from);
                  return next;
                })
              }
            >
              {removed.has(map.from) ? s("Keep") : s("Remove")}
            </button>
          </li>
        ))}
      </ul>
      {(["pi", "opencode", "claude-code"] as const).map((host) => {
        const rows = view?.[host] ?? [];
        return (
          <DirectoryMapHost
            key={host}
            host={host}
            rows={rows}
            decisions={decisions}
            busy={busy || !!refreshNeeded || !snapshot || !view}
            onDecide={decide}
            onResolve={() => smartResolve(host, rows)}
            onSelect={() => setDecisions((previous) => selectWithTargets(rows, previous))}
            onClear={() => setDecisions((previous) => clearSelection(rows, previous))}
          />
        );
      })}
      <button
        type="button"
        className="rounded border border-border px-3 py-1.5 text-sm"
        disabled={busy || !!refreshNeeded || !snapshot || !view}
        onClick={() => void save()}
      >
        {s("Save maps")}
      </button>
      {pending && (
        <DirectoryMapReviewDialog
          host={pending.host}
          review={pending.review}
          busy={busy}
          canConfirm={!refreshNeeded}
          error={s(reviewError)}
          onRefresh={() => void recoverRefresh()}
          onClose={() => {
            if (!saving.current) setPending(undefined);
          }}
          onConfirm={() => void confirm()}
        />
      )}
      {refreshNeeded && !pending && (
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={() => void recoverRefresh()}
        >
          {s("Refresh list")}
        </button>
      )}
      {message && (
        <p role="status" className="text-sm">
          {s(message)}
        </p>
      )}
    </section>
  );
}
