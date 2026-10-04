import { useEffect, useState } from "react";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { mapsToSave, type MapDecision, type PathMap } from "$lib/external-api-settings";
import { useSettingsText } from "$lib/i18n/settings";
import { applySuggestions, selectWithTargets, clearSelection } from "$lib/directory-maps";
import { DirectoryMapHost } from "./DirectoryMapHost";

type Snapshot = { revision: string };
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
  const [resolveNotes, setResolveNotes] = useState<
    Partial<Record<Host, { filled: number; alreadySelected: number; notFilled: number }>>
  >({});
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
    const result = applySuggestions(rows, decisions);
    setDecisions(result.decisions);
    setResolveNotes((notes) => ({
      ...notes,
      [host]: {
        filled: result.filled,
        alreadySelected: result.alreadySelected,
        notFilled: result.notFilled,
      },
    }));
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

  return (
    <section
      id="directory-maps"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Directory maps")}
    >
      <h2 className="text-lg font-medium">{s("Directory maps")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Map a directory that was moved or deleted to the project it belongs to. A change applies to the next import or backfill run."
        )}
      </p>
      <h3 className="font-medium">{s("Saved maps")}</h3>
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
            busy={busy}
            note={resolveNotes[host]}
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
        disabled={busy || !snapshot || !view}
        onClick={() => void save()}
      >
        {s("Save maps")}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
