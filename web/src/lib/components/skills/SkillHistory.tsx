import { useEffect, useState } from "react";
import { PagedList, serverWindow, usePaging, type PagingView } from "$lib/components/paged-list";
import { useSettingsText } from "$lib/i18n/settings";
import { normaliseHistory } from "$lib/skill-activity";
import { skillsApi, type HistoryEntry, type SkillRow } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { oldestFirst, TIME_SORTS, type TimeSort } from "$lib/skills-sorts";
import { HistoryEntryItem } from "./HistoryEntry";
import { UndoStopped } from "./ProposalCard";

export type RevertNotice =
  { tone: "done" } | { tone: "error"; text: string; savedContent?: string | null };

type ViewProps = {
  view: PagingView<TimeSort>;
  entries: HistoryEntry[];
  /** null while the first page loads. */
  loaded: boolean;
  /** A new page is loading; the entries on screen belong to the previous range. */
  refreshing?: boolean;
  error: string;
  confirmId: string | null;
  workingId: string | null;
  notice: RevertNotice | null;
  onAsk: (entry: HistoryEntry) => void;
  onConfirm: (entry: HistoryEntry) => void;
  onCancel: () => void;
};

/** The History timeline as markup: one entry per change, newest first, paged. */
export function SkillHistoryView(props: ViewProps) {
  const s = useSettingsText();
  const { view, entries, loaded, error, notice, refreshing = false } = props;
  return (
    <section className="space-y-3" aria-labelledby="skill-history-title">
      <h3 id="skill-history-title" className="text-section-title font-semibold">
        {s("History")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {s(
          "Each proposal, apply, reject and undo of this skill. Revert an applied change to restore SKILL.md as it was before it."
        )}
      </p>
      {notice?.tone === "done" ? (
        <p role="status" className="text-sm text-status-success">
          {s("Reverted. SKILL.md is back to the version before that change.")}
        </p>
      ) : null}
      {notice?.tone === "error" ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive-label">
            {notice.text}
          </p>
          {notice.savedContent !== undefined ? (
            <UndoStopped savedContent={notice.savedContent} />
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : !loaded ? (
        <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
      ) : view.total === 0 ? (
        <p className="text-sm text-muted-foreground">{s("No history yet.")}</p>
      ) : (
        <PagedList
          view={view}
          totalLabel={fill(s(view.total === 1 ? "{count} entry" : "{count} entries"), {
            count: view.total,
          })}
        >
          <ol
            aria-busy={refreshing}
            className={`ms-1.5 space-y-4 border-s border-border ps-4 transition-opacity ${refreshing ? "opacity-60" : ""}`}
          >
            {entries.map((entry) => (
              <HistoryEntryItem
                key={entry.id}
                entry={entry}
                confirming={props.confirmId === entry.id}
                working={props.workingId === entry.id}
                locked={props.workingId !== null || refreshing}
                onAsk={() => props.onAsk(entry)}
                onConfirm={() => props.onConfirm(entry)}
                onCancel={props.onCancel}
              />
            ))}
          </ol>
        </PagedList>
      )}
    </section>
  );
}

/** Loads one page of history at a time from the server. A revert reloads the page. */
export function SkillHistory({
  skill,
  reloadKey,
  onChanged,
}: {
  skill: Pick<SkillRow, "path" | "name">;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [total, setTotal] = useState(0);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The range the entries on screen were loaded for. Until it matches the
  // range asked for, the entries are the previous page and cannot be reverted.
  const [shownKey, setShownKey] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RevertNotice | null>(null);
  const view = usePaging({ storageKey: "omms-list-skill-history", total, sorts: TIME_SORTS });
  const reverse = oldestFirst(view);
  const { offset, limit } = serverWindow(view.page, view.perPage, total, reverse);
  const wantedKey = `${skill.path}|${skill.name}|${limit}|${offset}|${reverse}|${reloadKey}`;

  useEffect(() => {
    let live = true;
    void skillsApi.history(skill.path, skill.name, { limit, offset }).then((reply) => {
      if (!live) return;
      setLoaded(true);
      if (!reply.ok) return setError(reply.error);
      const page = normaliseHistory(reply.data);
      setError("");
      setTotal(page.total);
      const rows = page.entries.slice(0, limit);
      setEntries(reverse ? rows.reverse() : rows);
      setShownKey(wantedKey);
    });
    return () => {
      live = false;
    };
  }, [skill.path, skill.name, limit, offset, reverse, reloadKey, wantedKey]);

  async function revert(entry: HistoryEntry) {
    setConfirmId(null);
    setWorkingId(entry.id);
    setNotice(null);
    const reply = await skillsApi.undo(entry.proposalId);
    setWorkingId(null);
    if (reply.ok) {
      setNotice({ tone: "done" });
      onChanged();
      return;
    }
    setNotice({
      tone: "error",
      text: reply.error,
      ...(reply.code === "changed" ? { savedContent: reply.savedContent ?? null } : {}),
    });
  }

  return (
    <SkillHistoryView
      {...{ view, entries, loaded, error, confirmId, workingId, notice }}
      refreshing={loaded && shownKey !== wantedKey}
      onAsk={(entry) => {
        setNotice(null);
        setConfirmId(entry.id);
      }}
      onConfirm={(entry) => void revert(entry)}
      onCancel={() => setConfirmId(null)}
    />
  );
}
