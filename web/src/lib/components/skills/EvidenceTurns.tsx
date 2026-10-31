import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PagedFooter } from "$lib/components/paged-list";
import { paginate } from "$lib/components/paged-list/paging";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import type { TurnSummary } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { TurnList } from "./TurnList";

/** Turns shown before the reader asks for more. */
export const EVIDENCE_PREVIEW = 3;
/** Turns shown on one page once expanded. A longer list pages 6 to a page. */
export const EVIDENCE_EXPANDED = 6;

/** What to draw: the turns, the page footer numbers, and how many more the button promises. */
export function evidenceView(turns: readonly TurnSummary[], expanded: boolean, page: number) {
  const canExpand = turns.length > EVIDENCE_PREVIEW;
  if (!canExpand || !expanded) {
    return {
      canExpand,
      moreCount: canExpand ? Math.min(turns.length, EVIDENCE_EXPANDED) - EVIDENCE_PREVIEW : 0,
      ...paginate(turns, 1, EVIDENCE_PREVIEW),
    };
  }
  return { canExpand, moreCount: 0, ...paginate(turns, page, EVIDENCE_EXPANDED) };
}

type ViewProps = {
  turns: readonly TurnSummary[];
  expanded: boolean;
  page: number;
  onToggle: () => void;
  onPage: (page: number) => void;
};

export function EvidenceTurnsView({ turns, expanded, page, onToggle, onPage }: ViewProps) {
  const s = useSettingsText();
  const listId = useId();
  const view = evidenceView(turns, expanded, page);
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <div className="space-y-3">
      <div id={listId}>
        <TurnList turns={view.items} />
      </div>
      {view.canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={onToggle}
        >
          <Chevron aria-hidden="true" />
          {expanded ? s("Show less") : fill(s("Show {count} more"), { count: view.moreCount })}
        </Button>
      ) : null}
      {expanded ? <PagedFooter view={{ ...view, setPage: onPage }} /> : null}
    </div>
  );
}

/**
 * The evidence turns of a proposal: 3 at first, up to 6 after Show more, and
 * pages of 6 when there are more. Show less goes back to 3.
 */
export function EvidenceTurns({ turns }: { turns: readonly TurnSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  return (
    <EvidenceTurnsView
      turns={turns}
      expanded={expanded}
      page={page}
      onToggle={() => {
        setExpanded((value) => !value);
        setPage(1);
      }}
      onPage={setPage}
    />
  );
}
