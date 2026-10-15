import { useEffect, useRef, useState } from "react";
import { Loader, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { fetchAPI } from "$lib/api";
import { keywordHue } from "./KeywordBadge";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { useI18n } from "$lib/i18n";

type CleanupGroup = {
  id: string;
  name: string;
  checked: boolean;
  labels: { label: string; count: number }[];
};

type CleanupPreview = {
  before: number;
  after: number;
  groups: CleanupGroup[];
};

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApplied?: () => void;
};

type CleanupJob = {
  id: string;
  status:
    | { state: "grouping" }
    | { state: "checking"; done: number; total: number }
    | { state: "done"; preview: CleanupPreview }
    | { state: "failed"; error: string };
};

/** The preview runs as a background job on the server; the dialog polls its state. */
const POLL_MS = 3000;

function CategoryPill({ label, count }: { label: string; count: number }) {
  return (
    <Badge
      variant="outline"
      className="bg-transparent border-current [color:oklch(0.42_0.13_var(--category-hue))] dark:[color:oklch(0.8_0.13_var(--category-hue))]"
      style={{ ["--category-hue" as string]: String(keywordHue(label)) }}
    >
      <bdi>{label}</bdi>
      <span className="ms-1 font-mono opacity-70">{count}</span>
    </Badge>
  );
}

export function CategoryCleanupDialog({ open = false, onOpenChange, onApplied }: Props) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const wasOpen = useRef(false);
  // Each load gets a number; a closed dialog or a newer load stops an older poll.
  const loadId = useRef(0);

  useEffect(() => {
    if (open && !wasOpen.current) void load(false);
    if (!open) loadId.current++;
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only load on dialog open edge
  }, [open]);

  function show(next: CleanupPreview) {
    setPreview(next);
    setAccepted(new Set(next.groups.map((_, index) => index)));
    setNames(next.groups.map((group) => group.name));
  }

  /** Shows a finished job, follows a running one, or starts a new one. */
  async function load(fresh: boolean) {
    const id = ++loadId.current;
    setPreview(null);
    setProgress(null);
    setFailed(null);
    let job: CleanupJob | null = null;
    if (!fresh) {
      const current = await fetchAPI<CleanupJob | null>("/api/user-profile/category-cleanup");
      job = current.success ? (current.data ?? null) : null;
    }
    if (!job || job.status.state === "failed") {
      const started = await fetchAPI<CleanupJob>("/api/user-profile/category-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!started.success || !started.data) {
        setFailed(started.error || t("toast-category-cleanup-failed"));
        return;
      }
      job = started.data;
    }
    while (id === loadId.current) {
      const status = job!.status;
      if (status.state === "done") return show(status.preview);
      if (status.state === "failed") return setFailed(status.error);
      setProgress(status.state === "checking" ? { done: status.done, total: status.total } : null);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const next = await fetchAPI<CleanupJob | null>("/api/user-profile/category-cleanup");
      if (!next.success || !next.data)
        return setFailed(next.error || t("toast-category-cleanup-failed"));
      job = next.data;
    }
  }

  function toggle(index: number) {
    setAccepted((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const after = preview
    ? preview.before -
      preview.groups.reduce(
        (sum, group, index) => sum + (accepted.has(index) ? group.labels.length - 1 : 0),
        0
      )
    : 0;
  const ready = [...accepted].every((index) => (names[index] ?? "").trim().length > 0);

  async function apply() {
    if (!preview || accepted.size === 0 || !ready) return;
    setBusy(true);
    const groups = [...accepted].map((index) => ({
      labels: preview.groups[index]!.labels.map((entry) => entry.label),
      name: names[index]!.trim(),
    }));
    const result = await fetchAPI<{ renamed: number }>("/api/user-profile/category-cleanup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    });
    setBusy(false);
    if (!result.success || !result.data) {
      toast.error(result.error || t("toast-category-cleanup-failed"));
      return;
    }
    toast.success(t("toast-category-cleanup-applied", { count: result.data.renamed }));
    onOpenChange?.(false);
    onApplied?.();
  }

  async function undo() {
    setBusy(true);
    const result = await fetchAPI<{ restored: number; notFound: number }>(
      "/api/user-profile/category-cleanup/undo",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
    );
    setBusy(false);
    if (!result.success || !result.data) {
      toast.info(result.error || t("toast-category-cleanup-failed"));
      return;
    }
    toast.success(t("toast-category-cleanup-undone", result.data));
    onOpenChange?.(false);
    onApplied?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid! sm:max-w-2xl max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden gap-4">
        <DialogHeader>
          <DialogTitle>{t("label-category-cleanup-title")}</DialogTitle>
        </DialogHeader>

        {failed ? (
          <div className="flex flex-col items-center gap-3 py-10 text-sm">
            <span className="text-destructive">{failed}</span>
            <Button variant="secondary" size="sm" onClick={() => void load(true)}>
              {t("btn-category-cleanup-rebuild")}
            </Button>
          </div>
        ) : !preview ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
            <Loader className="size-6 animate-spin" />
            <span className="text-sm">
              {progress
                ? t("label-category-cleanup-progress", progress)
                : t("label-category-cleanup-loading")}
            </span>
            <span className="text-xs">{t("label-category-cleanup-background")}</span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {t("label-category-cleanup-counts", { before: preview.before, after })}
              </p>
              <Button variant="link" size="xs" onClick={() => void load(true)}>
                {t("btn-category-cleanup-rebuild")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("label-category-cleanup-note")}</p>
            {preview.groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("label-category-cleanup-empty")}
              </p>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">
                  {t("label-category-cleanup-selected", {
                    selected: accepted.size,
                    total: preview.groups.length,
                  })}
                </span>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
                  {preview.groups.map((group, index) => (
                    <div key={group.id} className="rounded-xl border border-border p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={accepted.has(index)}
                          onCheckedChange={() => toggle(index)}
                          aria-label={t("label-category-cleanup-accept")}
                        />
                        <Input
                          dir="auto"
                          className="h-8 min-w-0 flex-1 sm:max-w-64"
                          value={names[index] ?? ""}
                          aria-label={t("label-category-cleanup-name")}
                          disabled={!accepted.has(index)}
                          onChange={(event) =>
                            setNames((previous) =>
                              previous.map((name, position) =>
                                position === index ? event.target.value : name
                              )
                            )
                          }
                        />
                        {!group.checked ? (
                          <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                            {t("label-category-cleanup-unchecked")}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.labels.map((entry) => (
                          <CategoryPill key={entry.label} label={entry.label} count={entry.count} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void undo()}>
            <Undo2 className="size-3.5" />
            {t("btn-category-cleanup-undo")}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange?.(false)}>
              {t("btn-cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || !preview || accepted.size === 0 || !ready}
              onClick={() => void apply()}
            >
              {t("btn-category-cleanup-apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
