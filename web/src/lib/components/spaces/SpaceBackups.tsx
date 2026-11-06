import { PagedList, usePagedList } from "$lib/components/paged-list";
import { Button } from "$lib/components/ui/button";
import { formatBytes, formatDate } from "$lib/format";
import { useI18n } from "$lib/i18n";
import type { BackupRow } from "$lib/spaces-api";
import { LIST_ROW, LIST_ROW_TITLE } from "./list-row";
import { BACKUP_SORTS } from "$lib/spaces-sorts";

/** The backups in the OMMS backups folder, each with Restore as new space. */
export function SpaceBackups({
  backups,
  busy,
  onRestore,
}: {
  backups: BackupRow[];
  busy: boolean;
  onRestore: (backup: BackupRow) => void;
}) {
  const { t } = useI18n();
  const { view, pageItems } = usePagedList({
    storageKey: "omms-list-space-backups",
    items: backups,
    sorts: BACKUP_SORTS,
  });
  if (backups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("spaces-backups-empty")}</p>;
  }
  return (
    <PagedList view={view} totalLabel={t("spaces-backups-total", { count: view.total })}>
      <ul aria-label={t("spaces-backups-list-label")} className="space-y-3">
        {pageItems.map((backup) => (
          <li key={backup.folder} className={LIST_ROW}>
            <h3 id={`backup-${backup.folder}`} className={LIST_ROW_TITLE}>
              <bdi>{backup.spaceName}</bdi>
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("spaces-backup-date", { date: formatDate(backup.createdAt) })}
              {" · "}
              {t("spaces-size", { size: formatBytes(backup.sizeBytes) })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-describedby={`backup-${backup.folder}`}
              onClick={() => onRestore(backup)}
            >
              {t("spaces-restore")}
            </Button>
          </li>
        ))}
      </ul>
    </PagedList>
  );
}
