import { useState } from "react";
import { Power } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";
import { sendPowerAction, waitForWebApp, type PowerAction } from "$lib/power";
import { useWebStatus } from "$lib/web-status";
import { cn } from "$lib/utils";

type Phase = "idle" | "working" | "restarting" | "stopped";

/** The command that starts the web app again. */
const START_COMMAND = "om-memory-system web";

/** Sidebar power button. It renders only for a local caller that may stop or restart the web app. */
export function PowerButton() {
  const { t } = useI18n();
  // Green while the last status call worked, grey when it failed.
  const { ok, status } = useWebStatus();
  const canControl = status?.canControl ?? false;
  // The process that served the last status call; Restart waits for another one.
  const instance = status?.instance ?? null;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  async function choose(action: PowerAction) {
    if (phase !== "idle") return;
    setPhase("working");
    setMessage("");
    if (!(await sendPowerAction(action))) {
      setPhase("idle");
      setMessage("power-request-failed");
      return;
    }
    setOpen(false);
    if (action === "stop") {
      setPhase("stopped");
      return;
    }
    setPhase("restarting");
    const outcome = await waitForWebApp(instance);
    if (outcome === "restarted") {
      window.location.reload();
      return;
    }
    if (outcome === "unchanged") {
      // The copy failed and the old web app serves again: say so, and stay usable.
      setMessage("power-restart-failed");
      setPhase("idle");
      setOpen(true);
      return;
    }
    setMessage("power-restart-timeout");
    setPhase("stopped");
  }

  if (!canControl && phase === "idle") return null;

  return (
    <>
      <button
        type="button"
        data-power={ok ? "on" : "off"}
        className="inline-flex min-h-11 min-w-11 md:min-h-8 md:min-w-7 items-center justify-center self-stretch border-s border-sidebar-border px-1.5 text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        aria-label={t("power-button")}
        title={t("power-button")}
      >
        <Power className={cn("size-4", ok && "text-emerald-500")} />
      </button>
      <Dialog open={open} onOpenChange={(next) => phase === "idle" && setOpen(next)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("power-dialog-title")}</DialogTitle>
          </DialogHeader>
          <p>{t("power-dialog-body")}</p>
          <p className="text-xs text-muted-foreground">{t("power-note")}</p>
          {message ? (
            <p role="alert" className="text-sm text-destructive">
              {t(message)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={phase !== "idle"} onClick={() => setOpen(false)}>
              {t("power-cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={phase !== "idle"}
              onClick={() => void choose("stop")}
            >
              {t("power-stop")}
            </Button>
            <Button autoFocus disabled={phase !== "idle"} onClick={() => void choose("restart")}>
              {t("power-restart")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {phase === "restarting" || phase === "stopped" ? (
        <div
          role="alert"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background p-6 text-center"
        >
          {phase === "restarting" ? (
            <p>{t("power-restarting")}</p>
          ) : (
            <>
              <h2 className="text-section-title font-semibold">{t("power-stopped-title")}</h2>
              {message ? <p>{t(message)}</p> : null}
              <p>{t("power-stopped-command")}</p>
              <code className="rounded-md bg-muted px-2 py-1">{START_COMMAND}</code>
              <p className="max-w-md text-xs text-muted-foreground">{t("power-note")}</p>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
