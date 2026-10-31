import { useEffect, useState } from "react";
import { PagedList, serverWindow, usePaging } from "$lib/components/paged-list";
import { useSettingsText } from "$lib/i18n/settings";
import { skillsApi, type SkillRow, type TurnSummary } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { oldestFirst, TIME_SORTS } from "$lib/skills-sorts";
import { TurnList } from "./TurnList";

/**
 * Recent turns of one skill, one server page at a time. An older server
 * without `turnTotal` sends one list; it shows on one page.
 */
export function SkillTurns({
  skill,
  reloadKey,
}: {
  skill: Pick<SkillRow, "path" | "name">;
  reloadKey: number;
}) {
  const s = useSettingsText();
  const [total, setTotal] = useState(0);
  const [turns, setTurns] = useState<TurnSummary[] | null>(null);
  const [error, setError] = useState("");
  const view = usePaging({ storageKey: "omms-list-skill-turns", total, sorts: TIME_SORTS });
  const reverse = oldestFirst(view);
  const { offset, limit } = serverWindow(view.page, view.perPage, total, reverse);

  useEffect(() => {
    let live = true;
    void skillsApi.skill(skill.path, skill.name, { limit, offset }).then((reply) => {
      if (!live) return;
      if (!reply.ok) return setError(reply.error);
      const rows = (reply.data.recentTurns ?? []).slice(0, limit);
      setError("");
      setTotal(reply.data.turnTotal ?? rows.length);
      setTurns(reverse ? rows.reverse() : rows);
    });
    return () => {
      live = false;
    };
  }, [skill.path, skill.name, limit, offset, reverse, reloadKey]);

  return (
    <section className="space-y-3" aria-labelledby="skill-turns-title">
      <h3 id="skill-turns-title" className="text-section-title font-semibold">
        {s("Recent turns")}
      </h3>
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : turns === null ? (
        <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
      ) : total === 0 ? (
        <TurnList turns={[]} />
      ) : (
        <PagedList
          view={view}
          totalLabel={fill(s(total === 1 ? "{count} turn" : "{count} turns"), { count: total })}
        >
          <TurnList turns={turns} />
        </PagedList>
      )}
    </section>
  );
}
