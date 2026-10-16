import { Alert } from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import { useCategoryCleanupStatus } from "@/hooks/useCategoryCleanupStatus";
import { useI18n } from "$lib/i18n";
import { bannerView } from "$lib/category-cleanup-status";

type Props = {
  /** True while the review dialog is open: it shows the same progress, so the banner hides. */
  paused: boolean;
  onOpen: () => void;
};

/** Shows the state of a category cleanup preview on the Profile page. It only reads the job. */
export function CategoryCleanupBanner({ paused, onOpen }: Props) {
  const { t } = useI18n();
  const view = bannerView(useCategoryCleanupStatus(paused));
  if (paused || !view) return null;

  const failed = view.kind === "failed";
  return (
    <Alert variant={failed ? "destructive" : "default"} role={failed ? "alert" : "status"}>
      <div className="col-start-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words">
          {view.kind === "grouping" && t("label-category-cleanup-loading")}
          {view.kind === "checking" &&
            t("label-category-cleanup-progress", { done: view.done, total: view.total })}
          {view.kind === "ready" &&
            t("label-category-cleanup-banner-ready", { groups: view.groups })}
          {view.kind === "failed" && (
            <>
              {t("label-category-cleanup-banner-failed")} <bdi>{view.error}</bdi>
            </>
          )}
        </span>
        <Button variant="outline" size="xs" onClick={onOpen}>
          {t("btn-category-cleanup-banner-open")}
        </Button>
      </div>
    </Alert>
  );
}
