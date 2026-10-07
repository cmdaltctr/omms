import { useState } from "react";
import { CircleArrowUp, Copy } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";
import { sendUpdate, waitForUpdate } from "$lib/power";
import { useWebStatus } from "$lib/web-status";
import { cn } from "$lib/utils";

/** The update command for each host, in the order the dialog lists them. */
export const UPDATE_COMMANDS = [
  { label: "update-host-claude", command: "claude plugin update omms@omms" },
  { label: "update-host-opencode", command: "opencode plugin update om-memory-system" },
  { label: "update-host-pi", command: "pi update npm:om-memory-system" },
  {
    label: "update-host-global",
    command: "npm i -g om-memory-system@latest && om-memory-system web install",
  },
] as const;

/**
 * How the button shows: the word in its own row (phone drawer), the word in the
 * footer row (open desktop sidebar), or an icon (collapsed desktop sidebar).
 */
export type UpdateButtonVariant = "row" | "inline" | "icon";

const VARIANT_CLASSES: Record<UpdateButtonVariant, string> = {
  row: "mb-2 flex min-h-11 w-full rounded-lg border border-sidebar-border/80 bg-card/70 px-2",
  inline: "inline-flex min-h-8 self-stretch border-s border-sidebar-border px-2",
  icon: "inline-flex min-h-8 min-w-7 self-stretch px-1.5 py-1.5",
};

/** The update available on npm, or null when this caller may not update or none exists. */
function useAvailableUpdate() {
  const { status } = useWebStatus();
  const update = status?.update;
  if (!status?.canControl || !update?.available) return null;
  return { status, update, available: update.available };
}

/** Opens the update dialog. It renders only for a local caller while npm has a newer release. */
export function UpdateTrigger({
  variant = "row",
  className,
  onOpen,
}: {
  variant?: UpdateButtonVariant;
  className?: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const found = useAvailableUpdate();
  if (!found) return null;
  return (
    <button
      type="button"
      data-update={found.available}
      data-variant={variant}
      className={cn(
        "items-center justify-center text-xs font-medium text-brand-label transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        VARIANT_CLASSES[variant],
        className
      )}
      onClick={onOpen}
      aria-label={t("update-button", { version: found.available })}
      title={t("update-button", { version: found.available })}
    >
      {variant === "icon" ? <CircleArrowUp className="size-4" /> : t("update-label")}
    </button>
  );
}

/**
 * The one update dialog for the page. Every trigger opens this dialog, so its
 * progress survives a change between the phone and desktop layouts.
 */
export function UpdateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const found = useAvailableUpdate();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  if (!found) return null;
  const { status, update, available } = found;
  // A failure found by the status poll shows even when this page did not start the update.
  const failedCode = update.state === "failed" ? update.code : null;
  const busy = working || update.state === "installing" || update.state === "restarting";

  async function install() {
    if (busy) return;
    setWorking(true);
    setMessage("");
    if (!(await sendUpdate())) {
      setWorking(false);
      setMessage(t("update-request-failed"));
      return;
    }
    const outcome = await waitForUpdate(status?.instance ?? null);
    if (outcome.kind === "restarted") {
      window.location.reload();
      return;
    }
    setWorking(false);
    setMessage(
      outcome.kind === "failed" ? t("update-failed", { code: outcome.code }) : t("update-timeout")
    );
  }

  function copy(command: string) {
    void navigator.clipboard?.writeText(command);
    setCopied(command);
  }

  const shownMessage = message || (failedCode ? t("update-failed", { code: failedCode }) : "");

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("update-dialog-title")}</DialogTitle>
          </DialogHeader>
          <p>{t("update-versions", { running: status.version, available })}</p>
          <p className="text-sm">{t("update-hosts-intro")}</p>
          <ul className="flex flex-col gap-2">
            {UPDATE_COMMANDS.map(({ label, command }) => (
              <li key={command} className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t(label)}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1 text-xs">
                    {command}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(command)}
                    aria-label={`${t("update-copy")}: ${command}`}
                  >
                    <Copy className="size-3.5" />
                    {copied === command ? t("update-copied") : t("update-copy")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("update-hosts-note")}</p>
          <p className="text-xs text-muted-foreground">
            {update.canInstall ? t("update-install-note") : t("update-cannot-install")}
          </p>
          {busy ? (
            <p role="status" className="text-sm">
              {t("update-installing")}
            </p>
          ) : null}
          {shownMessage && !busy ? (
            <p role="alert" className="text-sm text-destructive">
              {shownMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("update-close")}
            </Button>
            <Button autoFocus disabled={busy || !update.canInstall} onClick={() => void install()}>
              {t("update-install")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
