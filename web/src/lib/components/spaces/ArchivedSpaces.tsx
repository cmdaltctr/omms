import { ArchiveRestore, DatabaseBackup, Trash2 } from "lucide-react";
import { LIST_ROW, LIST_ROW_TITLE } from "./list-row";
import { SpaceActionButton } from "./SpaceActionButton";
import { SpaceChip } from "./SpaceChip";
import { PagedList, usePagedList } from "$lib/components/paged-list";
import { formatBytes, formatDate, formatDateOnly } from "$lib/format";
import { useI18n } from "$lib/i18n";
import { whyKey, type SpaceRow } from "$lib/spaces-api";
import { ARCHIVE_SORTS } from "$lib/spaces-sorts";

export type ArchivedActions = {
  onRestore: (space: SpaceRow) => void;
  onBackUp: (space: SpaceRow) => void;
  onDelete: (space: SpaceRow) => void;
};

/**
 * The archived spaces, in the style of the Backups list: the paged-list toolbar, then one
 * bordered card for each space with its avatar and name, one line of details, and the actions.
 */
export function ArchivedSpaces({
  spaces,
  busy,
  actions,
}: {
  spaces: SpaceRow[];
  busy: boolean;
  actions: ArchivedActions;
}) {
  const { t } = useI18n();
  const { view, pageItems } = usePagedList({
    storageKey: "omms-list-archived-spaces",
    items: spaces,
    sorts: ARCHIVE_SORTS,
  });
  if (spaces.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("spaces-archive-empty")}</p>;
  }
  return (
    <PagedList view={view} totalLabel={t("spaces-archive-total", { count: view.total })}>
      <ul aria-label={t("spaces-archive-list-label")} className="space-y-3">
        {pageItems.map((space) => {
          const nameId = `archived-${space.id}-name`;
          const deleteReason = space.disabled.delete
            ? t(whyKey("delete", space.disabled.delete))
            : undefined;
          return (
            <li key={space.id} className={LIST_ROW}>
              <div className="flex min-w-0 items-center gap-3">
                <SpaceChip name={space.name} look={space.look} />
                <h3 id={nameId} className={LIST_ROW_TITLE}>
                  <bdi>{space.name}</bdi>
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {space.archivedAt
                  ? t("spaces-archived-at", { date: formatDate(space.archivedAt) })
                  : t("spaces-archived-none")}
                {" · "}
                {space.createdAt
                  ? t("spaces-created", { date: formatDateOnly(space.createdAt) })
                  : t("spaces-created-none")}
                {" · "}
                {t("spaces-size", { size: formatBytes(space.sizeBytes) })}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <SpaceActionButton
                  reasonId={`archived-${space.id}-why-restore`}
                  busy={busy}
                  variant="outline"
                  label={t("spaces-action-restore")}
                  icon={ArchiveRestore}
                  onClick={() => actions.onRestore(space)}
                />
                <SpaceActionButton
                  reasonId={`archived-${space.id}-why-backup`}
                  busy={busy}
                  iconOnly
                  variant="outline"
                  label={t("spaces-action-backup")}
                  icon={DatabaseBackup}
                  onClick={() => actions.onBackUp(space)}
                />
                <SpaceActionButton
                  reason={deleteReason}
                  reasonId={`archived-${space.id}-why-delete`}
                  busy={busy}
                  iconOnly
                  variant="destructive"
                  label={t("spaces-action-delete")}
                  icon={Trash2}
                  onClick={() => actions.onDelete(space)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </PagedList>
  );
}
