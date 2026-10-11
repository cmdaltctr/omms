import { useState } from "react";
import { BadgeCheck, Ban, CircleHelp, RefreshCw } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { useI18n } from "$lib/i18n";
import type { PendingLabelAssignment } from "@/hooks/useLabelReview";

type Outcome = { kind: "label"; labelId: string } | { kind: "none_fit" } | { kind: "uncertain" };

type Props = {
  assignments: PendingLabelAssignment[];
  loading: boolean;
  error: string | null;
  resolvingIds: Set<number>;
  onResolve: (id: number, outcome: Outcome) => void;
  onReload: () => void;
};

/**
 * Review queue for first-assignment labels (spec: label-assignment-review).
 * Confirming the suggestion, naming another label, `none_fit` and `uncertain`
 * are the only outcomes; `uncertain` keeps the case pending by design. When
 * the producer supplied candidate labels, their definitions render beside the
 * suggestion so competing labels can be compared, as the proposal requires.
 */
export function LabelReviewList({
  assignments,
  loading,
  error,
  resolvingIds,
  onResolve,
  onReload,
}: Props) {
  const { t } = useI18n();
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("label-review-loading")}
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="secondary" size="sm" onClick={onReload}>
          <RefreshCw className="h-4 w-4" /> {t("label-retry")}
        </Button>
      </section>
    );
  }
  if (assignments.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("label-review-empty")}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-section-title font-semibold text-muted-foreground">
        {t("label-review-title")} ({assignments.length})
      </h2>
      <div className="space-y-3">
        {assignments.map((assignment) => {
          const override = overrides[assignment.id] ?? "";
          const chosen = override.trim() || assignment.suggestedLabel || "";
          const busy = resolvingIds.has(assignment.id);
          return (
            <div
              key={assignment.id}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">{assignment.section}</span>
                <span aria-hidden>·</span>
                <span>{new Date(assignment.createdAt).toLocaleString()}</span>
                <span aria-hidden>·</span>
                <span>{assignment.source}</span>
              </div>
              <p className="text-sm">{assignment.observationText}</p>
              {assignment.suggestedLabel ? (
                <p className="text-xs text-muted-foreground">
                  {t("label-review-suggested")}:{" "}
                  <span className="font-medium">{assignment.suggestedLabel}</span>
                </p>
              ) : null}
              {assignment.labelOptions.length > 0 ? (
                <div className="space-y-1">
                  {assignment.labelOptions.map((option) => (
                    <button
                      key={option.labelId}
                      type="button"
                      className="block w-full rounded-md border border-border px-2 py-1 text-left text-xs hover:border-primary"
                      onClick={() =>
                        setOverrides((current) => ({
                          ...current,
                          [assignment.id]: option.labelId,
                        }))
                      }
                    >
                      <span className="font-medium">{option.labelId}</span>
                      <span className="text-muted-foreground"> — {option.definition}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder={t("label-review-other-label")}
                  value={override}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      [assignment.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  size="sm"
                  disabled={busy || !chosen.trim()}
                  onClick={() =>
                    onResolve(assignment.id, { kind: "label", labelId: chosen.trim() })
                  }
                >
                  <BadgeCheck className="h-4 w-4" />
                  {assignment.suggestedLabel && chosen === assignment.suggestedLabel
                    ? t("label-review-confirm")
                    : t("label-review-assign")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onResolve(assignment.id, { kind: "none_fit" })}
                >
                  <Ban className="h-4 w-4" /> {t("label-review-none-fit")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onResolve(assignment.id, { kind: "uncertain" })}
                >
                  <CircleHelp className="h-4 w-4" /> {t("label-review-uncertain")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
