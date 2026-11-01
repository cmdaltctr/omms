import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatDate } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import { skillsApi, type FailureGroup, type SkillRow } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { ExplainFailures } from "./ExplainFailures";
import { FailedCallsDialog } from "./FailedCallsDialog";

/** The label of one group: its tool and its error line, or that no error text exists. */
export function groupLabel(s: (message: string) => string, group: FailureGroup): string {
  return `${group.name} — ${group.errorLine ?? s("no error text")}`;
}

/**
 * The Failures section of one skill: the failed calls that count against it
 * by the ranking rule, grouped by tool name and first error line, most calls
 * first. A group opens the failed-call dialog with its latest 5 calls, which
 * the reply carries, so opening one needs no second request.
 */
export function FailureGroups({
  skill,
  reloadKey,
}: {
  skill: Pick<SkillRow, "path" | "name">;
  reloadKey: number;
}) {
  const s = useSettingsText();
  const [groups, setGroups] = useState<FailureGroup[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<FailureGroup | null>(null);

  useEffect(() => {
    let live = true;
    void skillsApi.skillFailures(skill.path, skill.name).then((reply) => {
      if (!live) return;
      if (!reply.ok) return setError(reply.error);
      setError("");
      setGroups(reply.data.groups);
    });
    return () => {
      live = false;
    };
  }, [skill.path, skill.name, reloadKey]);

  return (
    <section className="space-y-3" aria-labelledby="skill-failures-title">
      <h3 id="skill-failures-title" className="text-section-title font-semibold">
        {s("Failures")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {s("Failed calls that count against this skill, grouped by tool and first error line.")}
      </p>
      <ExplainFailures skill={skill} groups={groups} />
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : groups === null ? (
        <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {s("No failed tool calls are recorded for this skill.")}
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={`${group.name}\u0000${group.errorLine ?? ""}`}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpen(group)}
                className="flex w-full cursor-pointer items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-start hover:bg-interactive-hover"
              >
                <ChevronRight
                  className="rtl:-scale-x-100 mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block break-words text-sm" dir="auto">
                    {groupLabel(s, group)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {fill(
                      s(
                        group.calls === 1
                          ? group.turns === 1
                            ? "{calls} call over {turns} turn"
                            : "{calls} call over {turns} turns"
                          : group.turns === 1
                            ? "{calls} calls over {turns} turn"
                            : "{calls} calls over {turns} turns"
                      ),
                      { calls: group.calls, turns: group.turns }
                    )}
                    {" · "}
                    {fill(s("Last seen {date}"), { date: formatDate(group.lastSeenAt) })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <FailedCallsDialog
          title={groupLabel(s, open)}
          calls={open.latest}
          totalCount={open.calls}
          loading={false}
          loadError=""
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
