import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchAPI } from "$lib/api";
import { t } from "$lib/i18n";

export interface LabelOption {
  labelId: string;
  definition: string;
}

export interface PendingLabelAssignment {
  id: number;
  createdAt: number;
  section: string;
  observationText: string;
  suggestedLabel: string | null;
  source: string;
  labelOptions: LabelOption[];
}

/**
 * Review queue state for label assignments (spec: label-assignment-review).
 * A case leaves the queue only through an explicit reviewer outcome; the
 * `uncertain` outcome keeps it pending by design. Loads are sequenced so a
 * slow earlier response can never restore cards a newer load already removed,
 * and resolutions are tracked per id so concurrent cards stay disabled while
 * their own request is in flight.
 */
export function useLabelReview() {
  const [assignments, setAssignments] = useState<PendingLabelAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<number>>(new Set());
  const loadSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const result = await fetchAPI<{ assignments: PendingLabelAssignment[] }>(
      "/api/label-assignments?status=pending"
    );
    if (sequence !== loadSequence.current) return;
    if (!mounted.current) return;
    if (result.success && result.data) {
      setAssignments(result.data.assignments);
      setError(null);
    } else {
      setError(result.error || t("label-review-load-failed"));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (
      id: number,
      outcome: { kind: "label"; labelId: string } | { kind: "none_fit" } | { kind: "uncertain" }
    ) => {
      setResolvingIds((current) => new Set(current).add(id));
      const result = await fetchAPI<{ resolved: boolean; pending: boolean }>(
        `/api/label-assignments/${id}/resolve`,
        { method: "POST", body: JSON.stringify({ outcome }) }
      );
      setResolvingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (!result.success) {
        toast.error(result.error || t("label-review-resolve-failed"));
        return;
      }
      if (result.data?.pending) {
        toast.info(t("label-review-kept-pending"));
      } else {
        toast.success(t("label-review-resolved"));
      }
      await load();
    },
    [load]
  );

  return { assignments, loading, error, resolvingIds, reload: load, resolve };
}
