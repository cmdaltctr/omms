import { useEffect, useState } from "react";
import { Loader, Plus, X } from "lucide-react";
import { HuePill } from "$lib/components/skills/HuePill";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import { memorisationApi } from "$lib/memorisation-api";
import { filterSummary, groupsFromLabels, labelsFromGroups } from "$lib/memorisation-query";

type LabelCount = { label: string; count: number };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Builds a label filter with check boxes. A group holds the labels a record may carry (any of
 * them); groups combine with AND. The draft stays here until Apply. Mount it only while it is open.
 */
export function LabelPickerDialog({
  labels,
  onApply,
  onClose,
}: {
  /** The current filter: the picker starts from it. */
  labels: readonly string[];
  onApply: (labels: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<string[][]>(() => groupsFromLabels(labels));
  const [counts, setCounts] = useState<LabelCount[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(null);
    void memorisationApi.labels().then((result) => {
      if (!current) return;
      if (result.success && result.data) setCounts(result.data.labels);
      else setFailed(result.error ?? "");
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  // A label of the filter that no record carries any more stays listed, so it can be unticked.
  const options: LabelCount[] | null =
    counts === null
      ? null
      : [
          ...counts,
          ...groupsFromLabels(labels)
            .flat()
            .filter((label, at, all) => !all.slice(0, at).some((other) => same(other, label)))
            .filter((label) => !counts.some((own) => same(own.label, label)))
            .map((label) => ({ label, count: 0 })),
        ];

  const toggle = (group: number, label: string, on: boolean) =>
    setGroups((own) =>
      own.map((labelsOfGroup, at) => {
        if (at !== group) return labelsOfGroup;
        const rest = labelsOfGroup.filter((other) => !same(other, label));
        return on ? [...rest, label] : rest;
      })
    );

  // FSI and PDI keep a label in its own direction inside the sentence, as <bdi> does in markup.
  const isolated = groups.map((group) => group.map((label) => `\u2068${label}\u2069`));
  const summary = filterSummary(isolated, {
    or: t("memorisation-label-or"),
    and: t("memorisation-label-and"),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("memorisation-picker-title")}</DialogTitle>
          <DialogDescription>{t("memorisation-picker-body")}</DialogDescription>
        </DialogHeader>
        {failed !== null ? (
          <div className="space-y-2">
            <Callout tone="danger">
              {t("memorisation-picker-failed")}
              {failed ? (
                <>
                  {" "}
                  <bdi>{failed}</bdi>
                </>
              ) : null}
            </Callout>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAttempt(attempt + 1)}
            >
              {t("memorisation-picker-retry")}
            </Button>
          </div>
        ) : null}
        {options === null && failed === null ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("memorisation-picker-loading")}
          </p>
        ) : null}
        {options !== null && options.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("memorisation-picker-none")}
          </p>
        ) : null}
        {options !== null && options.length > 0
          ? groups.map((group, at) => (
              <fieldset key={at} className="space-y-2 rounded-md border p-3">
                <legend className="float-start text-sm font-medium">
                  {t("memorisation-picker-group", { n: at + 1 })}
                </legend>
                {groups.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="float-end"
                    aria-label={t("memorisation-picker-remove-group", { n: at + 1 })}
                    onClick={() => setGroups(groups.filter((_, other) => other !== at))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
                <div className="clear-both max-h-48 space-y-1 overflow-y-auto">
                  {options.map((option, index) => {
                    const id = `memorisation-picker-${at}-${index}`;
                    return (
                      <div key={option.label} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={group.some((own) => same(own, option.label))}
                          onCheckedChange={(on) => toggle(at, option.label, on === true)}
                        />
                        <Label htmlFor={id} data-label={option.label} className="min-w-0 flex-1">
                          <bdi>
                            <HuePill label={option.label} />
                          </bdi>
                        </Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {option.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))
          : null}
        {options !== null && options.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setGroups([...groups, []])}
          >
            <Plus aria-hidden="true" />
            {t("memorisation-picker-add-group")}
          </Button>
        ) : null}
        <p role="status" className="text-sm" dir="auto">
          {summary
            ? t("memorisation-picker-summary", { filter: summary })
            : t("memorisation-picker-summary-empty")}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("memorisation-picker-cancel")}
          </Button>
          <Button
            type="button"
            disabled={options === null}
            onClick={() => onApply(labelsFromGroups(groups))}
          >
            {t("memorisation-picker-apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
