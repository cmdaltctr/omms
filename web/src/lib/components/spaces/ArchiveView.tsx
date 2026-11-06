import { useEffect } from "react";
import { Loader } from "lucide-react";
import { ArchivedSpaces } from "./ArchivedSpaces";
import { useSpaceActions } from "@/hooks/useSpaceActions";
import { Callout } from "$lib/components/skills/Callout";
import { useI18n } from "$lib/i18n";

/**
 * The Archive page: the archived spaces in the style of the Backups list. Restore returns a
 * space to the sidebar tree and the Spaces page. The page title is the H1 in `App.tsx`.
 */
export function ArchiveView() {
  const { t } = useI18n();
  const { spaces, ask, askDelete, dialogs, feedbackFor } = useSpaceActions();
  const { load } = spaces;
  const archived = (spaces.snapshot?.spaces ?? []).filter((space) => space.archived);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("spaces-archive-intro")}</p>
      {spaces.busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {spaces.busy}
        </p>
      ) : null}
      {feedbackFor("spaces")}
      {spaces.loading && !spaces.snapshot ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {t("spaces-loading")}
        </p>
      ) : null}
      {!spaces.snapshot && spaces.loadError ? (
        <Callout tone="danger">
          <p>{t("spaces-load-failed")}</p>
          <p>{spaces.loadError}</p>
        </Callout>
      ) : null}
      {spaces.snapshot ? (
        <ArchivedSpaces
          spaces={archived}
          busy={spaces.busy !== null}
          actions={{ onRestore: ask("restore"), onBackUp: ask("backup"), onDelete: askDelete }}
        />
      ) : null}
      {dialogs}
    </div>
  );
}
