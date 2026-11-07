import { useState, type ReactNode } from "react";
import { Loader } from "lucide-react";
import { TransferPreview, type TransferPreviewData } from "./TransferPreview";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { fetchAPI } from "$lib/api";
import { useI18n } from "$lib/i18n";
import type { SpaceResult, SpaceRow } from "$lib/spaces-api";

type TransferMode = "copy" | "move";
type TransferForm = {
  to: string;
  mode: TransferMode;
  since?: string;
  until?: string;
  project?: string;
};
type TransferResult = { ok: boolean; copied: number; skipped: number; removed: number };
type TransferReply = { preview?: TransferPreviewData; result?: TransferResult };
type TransferDone = { mode: TransferMode; count: number; skipped: number };
type TransferDialogProps = {
  /** The space whose card opened the dialog. */
  source: SpaceRow;
  /** Every space of the page, for the target picker. */
  spaces: SpaceRow[];
  /** The page reloads its list after an apply changed a space. */
  onApplied: () => void;
  onClose: () => void;
};

/** One labelled field of the transfer form grid. Exported for the spec's expand list. */
export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** The Transfer dialog of one card: preview first, apply after a confirm, and any filter change clears the preview. */
export function TransferDialog({ source, spaces, onApplied, onClose }: TransferDialogProps) {
  const { t } = useI18n();
  const candidates = spaces.filter((space) => !space.archived && space.id !== source.id);
  const [form, setForm] = useState<TransferForm>({ to: candidates[0]?.id ?? "", mode: "copy" });
  const [preview, setPreview] = useState<TransferPreviewData | null>(null);
  const [cleared, setCleared] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<TransferDone | null>(null);
  const targetName = candidates.find((space) => space.id === form.to)?.name ?? "";
  const canPreview = form.to !== "" && !previewing && !done;
  const canApply = preview !== null && preview.toCopy > 0 && !previewing && !done;

  /** Any filter change invalidates the preview, so Apply waits for a fresh one. */
  function change<K extends keyof TransferForm>(key: K, value: TransferForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setCleared(preview !== null);
    setPreview(null);
    setBusy(false);
  }

  function body(confirm: boolean) {
    return {
      from: source.id,
      to: form.to,
      mode: form.mode,
      ...(form.since ? { since: form.since } : {}),
      ...(form.until ? { until: form.until } : {}),
      ...(form.project?.trim() ? { projects: [form.project.trim()] } : {}),
      ...(confirm ? { confirm: true } : {}),
    };
  }

  async function post<T>(path: string, payload: unknown) {
    return (await fetchAPI<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })) as SpaceResult<T>;
  }

  async function runPreview() {
    if (!canPreview) return;
    setPreviewing(true);
    setError("");
    const reply = await post<TransferReply>("/api/spaces/transfer/preview", body(false));
    setPreviewing(false);
    if (reply.success && reply.data?.preview) {
      setPreview(reply.data.preview);
      setCleared(false);
      setBusy(false);
    } else {
      setError(reply.error ?? "");
    }
  }

  async function apply() {
    setApplying(true);
    setError("");
    const reply = await post<TransferReply>("/api/spaces/transfer", body(true));
    setApplying(false);
    setConfirmOpen(false);
    const result = reply.data?.result;
    if (reply.success && result) {
      // Move reports rows gone from the source; copy reports rows written.
      const count = form.mode === "move" ? result.removed : result.copied;
      setDone({ mode: form.mode, count, skipped: result.skipped });
      onApplied();
      return;
    }
    // The server refused this apply because another one runs. The preview stays, so retry.
    if (reply.code === "transfer-busy") setBusy(true);
    else setError(reply.error ?? "");
  }

  const kind = form.mode;
  return (
    <>
      <Dialog open onOpenChange={(open) => (open || applying ? undefined : onClose())}>
        <DialogContent>
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("spaces-transfer-title")}</DialogTitle>
              </DialogHeader>
              <Callout tone="success">
                <p>
                  {t(`spaces-transfer-result-${done.mode === "move" ? "moved" : "copied"}`, {
                    count: done.count,
                    skipped: done.skipped,
                    source: source.name,
                  })}
                </p>
              </Callout>
              <DialogFooter>
                <Button type="button" onClick={onClose}>
                  {t("spaces-close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void runPreview();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("spaces-transfer-title")}</DialogTitle>
                <DialogDescription>{t("spaces-transfer-intro")}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="space-transfer-source" label={t("spaces-transfer-source")}>
                  <Select id="space-transfer-source" value={source.id} onChange={() => {}} disabled>
                    <option value={source.id}>{source.name}</option>
                  </Select>
                </Field>
                <Field id="space-transfer-target" label={t("spaces-transfer-target")}>
                  <Select
                    id="space-transfer-target"
                    value={form.to}
                    onChange={(event) => change("to", event.target.value)}
                    disabled={previewing}
                  >
                    {candidates.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="space-transfer-mode" label={t("spaces-transfer-mode")}>
                  <Select
                    id="space-transfer-mode"
                    value={form.mode}
                    onChange={(event) => change("mode", event.target.value as TransferMode)}
                    disabled={previewing}
                  >
                    <option value="copy">{t("spaces-transfer-mode-copy")}</option>
                    <option value="move">{t("spaces-transfer-mode-move")}</option>
                  </Select>
                </Field>
                <Field id="space-transfer-project" label={t("spaces-transfer-project")}>
                  <Input
                    id="space-transfer-project"
                    value={form.project ?? ""}
                    disabled={previewing}
                    onChange={(event) => change("project", event.target.value)}
                  />
                </Field>
                <Field id="space-transfer-since" label={t("spaces-transfer-from")}>
                  <Input
                    id="space-transfer-since"
                    type="date"
                    value={form.since ?? ""}
                    disabled={previewing}
                    onChange={(event) => change("since", event.target.value)}
                  />
                </Field>
                <Field id="space-transfer-until" label={t("spaces-transfer-to")}>
                  <Input
                    id="space-transfer-until"
                    type="date"
                    value={form.until ?? ""}
                    disabled={previewing}
                    onChange={(event) => change("until", event.target.value)}
                  />
                </Field>
              </div>
              {busy ? <Callout tone="info">{t("spaces-transfer-busy")}</Callout> : null}
              {error ? <Callout tone="danger">{error}</Callout> : null}
              {previewing ? (
                <p role="status" className="flex items-center gap-2 text-muted-foreground">
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                  {t("spaces-transfer-previewing")}
                </p>
              ) : preview ? (
                <TransferPreview preview={preview} />
              ) : cleared ? (
                <p>{t("spaces-transfer-preview-cleared")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("spaces-transfer-why-disabled")}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={previewing} onClick={onClose}>
                  {t("spaces-cancel")}
                </Button>
                <Button type="submit" disabled={!canPreview}>
                  {t("spaces-transfer-preview")}
                </Button>
                <Button type="button" disabled={!canApply} onClick={() => setConfirmOpen(true)}>
                  {t("spaces-transfer-apply")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {confirmOpen && preview ? (
        <Dialog
          open
          onOpenChange={(open) => (open || applying ? undefined : setConfirmOpen(false))}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <bdi>{t(`spaces-transfer-confirm-${kind}-title`, { count: preview.toCopy })}</bdi>
              </DialogTitle>
              <DialogDescription>
                <bdi>
                  {t(`spaces-transfer-confirm-${kind}-body`, {
                    count: preview.toCopy,
                    source: source.name,
                    target: targetName,
                  })}
                </bdi>
              </DialogDescription>
            </DialogHeader>
            {applying ? (
              <p role="status" className="flex items-center gap-2 text-muted-foreground">
                <Loader className="size-4 animate-spin" aria-hidden="true" />
                {t("spaces-transfer-applying")}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={applying}
                onClick={() => setConfirmOpen(false)}
              >
                {t("spaces-cancel")}
              </Button>
              <Button type="button" disabled={applying} onClick={() => void apply()}>
                {t(`spaces-transfer-confirm-${kind}-button`)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
