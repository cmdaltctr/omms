import { useEffect, useState, type FormEvent } from "react";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";

/** A name to ask for: a new folder, a folder rename, or a chat rename. */
export type NameRequest = {
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  /** Saves the name. Returns an error message to show, or null when it saved. */
  submit: (name: string) => Promise<string | null>;
};

type Props = { request: NameRequest | null; onClose: () => void };

export function FolderDialog({ request, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(request?.initial ?? "");
    setError(null);
  }, [request]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!request || !name.trim()) return;
    setBusy(true);
    const failure = await request.submit(name.trim());
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="chat-name-input">{request?.label}</Label>
            <Input
              id="chat-name-input"
              value={name}
              maxLength={80}
              autoFocus
              aria-invalid={error ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? <p className="text-xs text-destructive-label">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("chat-cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {request?.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
