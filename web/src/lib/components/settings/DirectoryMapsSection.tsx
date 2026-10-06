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
  confirmedEdits,
  groupSavedMaps,
  reviewDirectoryMaps,
  type DirectoryMapReview,
  type SuggestedDirectory,
} from "$lib/directory-maps";
import { DirectoryMapHost } from "./DirectoryMapHost";
import { DirectoryMapReviewDialog } from "./DirectoryMapReviewDialog";
import { Button } from "$lib/components/ui/button";

type Snapshot = {
  revision: string;
  settings?: { importPathMaps?: { globalValue?: PathMap[] } };
};
type Host = "pi" | "opencode" | "claude-code";
type Suggested = SuggestedDirectory;
type View = {
  saved: PathMap[];
  ignored?: string[];
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

  function decide(row: Suggested, target: string) {
    setDecisions((previous) => ({
      ...previous,
      [row.directory]: { directory: row.directory, target },
    }));
  }

  const savedMaps = () => snapshot?.settings?.importPathMaps?.globalValue ?? view?.saved ?? [];
  // The server's list holds resolved paths, the same form as the rows and
  // Restore use; the raw file may hold "~/x" or a trailing separator.
  const ignoredList = () => view?.ignored ?? [];

  /** Save removals, Ignore, and Restore: one immediate save, then a fresh list. */
  async function saveNow(
    edits: Record<string, unknown>,
    done: string,
    failed: string
  ): Promise<boolean> {
    if (!snapshot || !view || saving.current || refreshNeeded) return false;
    saving.current = true;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
    } catch (error) {
      const conflict = error instanceof SettingsRequestError && error.status === 409;
      try {
        if (!conflict) {
          setMessage(failed);
          await reloadSettingsSnapshot<Snapshot>();
          return false;
        }
        setMessage("Settings changed elsewhere. Check the list and try again.");
        // The next save builds on the server's list, so it must be the newer one.
        try {
          await refreshReview();
        } catch {
          setRefreshNeeded("conflict");
          setMessage(
            "Settings changed elsewhere and could not be refreshed. Refresh the list, then try again."
          );
        }
        return false;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    }
    setMessage(done);
    try {
      await refreshReview();
    } catch {
      setRefreshNeeded("saved");
      setMessage(
        "Saved, but the list could not be refreshed. Refresh the list without saving again."
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
    return true;
  }

  function saveRemovals() {
    void saveNow(
      { importPathMaps: mapsToSave(savedMaps(), removed) },
      "Saved. Removed maps stop applying at the next import or backfill run.",
      "Removals could not be saved. Try again."
    ).then((saved) => {
      if (saved) setRemoved(new Set());
    });
  }

  function ignore(row: Suggested) {
    void saveNow(
      { importIgnoredDirectories: [...new Set([...ignoredList(), row.directory])] },
      "Ignored. The directory stays unimported.",
      "The directory could not be ignored. Try again."
    );
  }

  function restore(directory: string) {
    void saveNow(
      { importIgnoredDirectories: ignoredList().filter((item) => item !== directory) },
      "Restored. The directory shows again in each host list that reported it.",
      "The directory could not be restored. Try again."
    );
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

  async function confirm(ticked: Set<string>) {
    if (!snapshot || !view || !pending || saving.current || refreshNeeded) return;
    const edits = confirmedEdits(savedMaps(), ignoredList(), pending.review, ticked);
    if (!edits.importPathMaps && !edits.importIgnoredDirectories) return;
    saving.current = true;
    setBusy(true);
    setReviewError("");
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
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
    const sources = new Set(ticked);
    setDecisions((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([source]) => !sources.has(source)))
    );
    setRemoved((previous) => new Set([...previous].filter((source) => !sources.has(source))));
    setView((previous) =>
      previous
        ? {
            ...previous,
            saved: edits.importPathMaps ?? previous.saved,
            ignored: edits.importIgnoredDirectories ?? previous.ignored,
          }
        : previous
    );
    setPending(undefined);
    const mapCount = pending.review.maps.filter((map) => ticked.has(map.from)).length;
    const ignoreCount = pending.review.ignores.filter((item) => ticked.has(item.directory)).length;
    setMessage(
      `${s("Saved maps")}: ${mapCount} · ${s("Ignored directories")}: ${ignoreCount}. ${s(
        "They apply to the next import or backfill run. No sessions were imported."
      )}`
    );
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
      <details className="min-w-0 rounded-lg border border-border p-3">
        <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
          <h3 className="inline text-subsection-title font-semibold">{s("Saved maps")}</h3> ·{" "}
          {view?.saved.length ?? 0}
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {s("Saved maps apply to every host.")}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {s(
              "Keep a map after its sessions import. Every import checks the map before it skips a session, so removing a map makes its sessions unresolved again on the next run."
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !!refreshNeeded || !snapshot || !view || removed.size === 0}
            onClick={saveRemovals}
          >
            {s("Save removals")}
          </Button>
          {!view?.saved.length && <p className="text-sm text-muted-foreground">{s("none")}</p>}
          {groupSavedMaps(view?.saved ?? []).map((group) => (
            <details key={group.target} className="min-w-0 border-t border-border pt-2">
              <summary className="cursor-pointer rounded text-sm focus-visible:outline-2 focus-visible:outline-ring">
                <code dir="ltr" className="break-all">
                  {group.target}
                </code>{" "}
                · {group.maps.length}
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {group.maps.map((map) => (
                  <li key={map.from} className="flex min-w-0 items-start gap-2">
                    <code
                      dir="ltr"
                      className={`min-w-0 flex-1 break-all ${removed.has(map.from) ? "line-through" : ""}`}
                    >
                      {map.from}
                    </code>
                    <button
                      type="button"
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs"
                      aria-label={`${removed.has(map.from) ? s("Keep") : s("Remove")} ${map.from}`}
                      disabled={busy}
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
            </details>
          ))}
        </div>
      </details>
      <details className="min-w-0 rounded-lg border border-border p-3">
        <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
          <h3 className="inline text-subsection-title font-semibold">{s("Ignored directories")}</h3>{" "}
          · {view?.ignored?.length ?? 0}
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {s("Ignored directories stay unimported and leave the unresolved counts.")}
          </span>
        </summary>
        <ul className="mt-3 space-y-1 text-sm">
          {!view?.ignored?.length && <li className="text-muted-foreground">{s("none")}</li>}
          {view?.ignored?.map((directory) => (
            <li key={directory} className="flex min-w-0 items-start gap-2">
              <code dir="ltr" className="min-w-0 flex-1 break-all">
                {directory}
              </code>
              <button
                type="button"
                className="shrink-0 rounded border border-border px-2 py-0.5 text-xs"
                aria-label={`${s("Restore")} ${directory}`}
                disabled={busy || !!refreshNeeded || !snapshot}
                onClick={() => restore(directory)}
              >
                {s("Restore")}
              </button>
            </li>
          ))}
        </ul>
      </details>
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
            onIgnore={ignore}
          />
        );
      })}
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
          onConfirm={(ticked) => void confirm(ticked)}
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
