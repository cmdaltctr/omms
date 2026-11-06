import { useState, type ReactNode } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
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
import { avatarPng, checkAvatarFile } from "$lib/avatar-image";
import type { AvatarChange, AvatarLook } from "$lib/avatar-look";
import { HOST_ICONS, HOST_ICON_NAMES } from "$lib/host-icons";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";

type Pending = { look: AvatarLook; png?: string } | { reset: true };

/**
 * The dialog that changes an avatar: upload an image, choose an icon, or go back to the default
 * look. Hosts and spaces share it. The owner draws the avatar, saves the change, and may add
 * fields of its own (a space has a name). `onSave` throws an Error to keep the dialog open and
 * show the message.
 */
export function AvatarEditorDialog({
  title,
  look,
  renderAvatar,
  extra,
  extraChanged = false,
  onSave,
  onClose,
}: {
  title: string;
  /** The look that is saved now. */
  look: AvatarLook;
  renderAvatar: (look: AvatarLook) => ReactNode;
  /** Fields above the avatar, such as a name. */
  extra?: ReactNode;
  /** The extra fields changed, so Save is allowed even when the avatar did not change. */
  extraChanged?: boolean;
  /** Saves. The change is null when only the extra fields changed. */
  onSave: (change: AvatarChange | null) => Promise<void>;
  onClose: () => void;
}) {
  const s = useSettingsText();
  const [pending, setPending] = useState<Pending | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown: AvatarLook =
    pending === null ? look : "reset" in pending ? { kind: "default" } : pending.look;
  const names = HOST_ICON_NAMES.filter((name) => name.includes(query.trim().toLowerCase()));

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    const problem = await checkAvatarFile(file);
    if (problem) {
      setError(
        problem === "size"
          ? s("The image is larger than 20 MB.")
          : s("Only PNG, JPEG, WebP and GIF images are accepted.")
      );
      return;
    }
    try {
      const png = await avatarPng(file);
      setPending({ look: { kind: "image", image: `data:image/png;base64,${png}` }, png });
    } catch {
      setError(s("This browser could not read the image."));
    }
  }

  function change(): AvatarChange | null {
    if (pending === null) return null;
    if ("reset" in pending) return { kind: "reset" };
    if (pending.look.kind === "icon") return { kind: "icon", icon: pending.look.icon };
    return pending.png ? { kind: "image", png: pending.png } : null;
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(change());
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {s("Every avatar is shown at the same size. Images are cropped to a square.")}
          </DialogDescription>
        </DialogHeader>
        {extra}
        <div className="flex items-center gap-3">
          {renderAvatar(shown)}
          <label className="inline-flex">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only peer"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border px-3 text-ui font-medium hover:bg-interactive-hover peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
              <ImagePlus className="size-4" aria-hidden="true" />
              {s("Upload image")}
            </span>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPending({ reset: true })}
          >
            <RotateCcw aria-hidden="true" />
            {s("Reset to default")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{s("PNG, JPEG, WebP or GIF, up to 20 MB.")}</p>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={s("Search icons")}
          placeholder={s("Search icons")}
        />
        <div
          role="group"
          aria-label={s("Choose icon")}
          className="grid max-h-48 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8"
        >
          {names.map((name) => {
            const Icon = HOST_ICONS[name]!;
            const active = shown.kind === "icon" && shown.icon === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={active}
                onClick={() => setPending({ look: { kind: "icon", icon: name } })}
                className={cn(
                  "grid size-10 cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted-foreground hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring",
                  active && "border-primary bg-primary/10 text-primary-label"
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
              </button>
            );
          })}
          {names.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground">{s("No icon matches.")}</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive-label">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {s("Cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy || (pending === null && !extraChanged)}
          >
            {s("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
