import type { ReactNode } from "react";
import { PagedFooter } from "./PagedFooter";
import { PagedListControls } from "./PagedListControls";
import type { PagingView } from "./use-paging";

/**
 * A paged list laid out like the receipt scanner inbox: the toolbar above,
 * the rows of one page, and the footer below. Get `view` from `usePagedList`
 * (rows in the browser) or `usePaging` (rows from the server).
 */
export function PagedList<S extends string>({
  view,
  totalLabel,
  children,
}: {
  view: PagingView<S>;
  totalLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <PagedListControls view={view} totalLabel={totalLabel} />
      {children}
      <PagedFooter view={view} />
    </div>
  );
}
