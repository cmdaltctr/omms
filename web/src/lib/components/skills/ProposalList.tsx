import { PagedList, usePagedList } from "$lib/components/paged-list";
import { useSettingsText } from "$lib/i18n/settings";
import type { Proposal } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { PROPOSAL_SORTS } from "$lib/skills-sorts";
import { ProposalCard } from "./ProposalCard";

/** Cards are tall, so the proposal lists start at three to a page. */
export const PROPOSAL_PAGE_SIZE = 3;

/**
 * Saved-view keys of the two proposal lists. They are versioned so a page size
 * saved under the old default of 5 does not hide the default of 3.
 */
export const PENDING_LIST_KEY = "omms-list-pending-v2";
export const RECENT_LIST_KEY = "omms-list-recent-v2";

/** Proposals paged in the browser, newest first by default, three to a page. */
export function ProposalList({
  storageKey,
  proposals,
  onChange,
}: {
  /** localStorage key for this list's page size and sort. */
  storageKey: string;
  proposals: readonly Proposal[];
  onChange: (next: Proposal) => void;
}) {
  const s = useSettingsText();
  const { view, pageItems } = usePagedList({
    storageKey,
    items: proposals,
    sorts: PROPOSAL_SORTS,
    defaultPerPage: PROPOSAL_PAGE_SIZE,
  });
  return (
    <PagedList
      view={view}
      totalLabel={fill(s(view.total === 1 ? "{count} proposal" : "{count} proposals"), {
        count: view.total,
      })}
    >
      <div className="space-y-3">
        {pageItems.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onChange={onChange} />
        ))}
      </div>
    </PagedList>
  );
}
