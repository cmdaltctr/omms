import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";
import {
  readPowerStatus,
  sendPowerAction,
  STATUS_POLL_MS,
  waitForWebApp,
  type PowerAction,
} from "$lib/power";
import { cn } from "$lib/utils";

type Phase = "idle" | "working" | "restarting" | "stopped";

/** The command that starts the web app again. */
const START_COMMAND = "om-memory-system web";

export function PowerButton() {
  const { t } = useI18n();
  const [canControl, setCanControl] = useState(false);
  // Green while the last status call worked, grey when it failed.
  const [ok, setOk] = useState(true);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void readPowerStatus().then((status) => {
        if (cancelled) return;
        setOk(status !== null);
        if (status) setCanControl(status.canControl);
      });
    load();
    const timer = setInterval(load, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    if (await waitForWebApp()) {
      window.location.reload();
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
        className="inline-flex items-center self-stretch border-s border-sidebar-border px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
              <h2 className="text-lg">{t("power-stopped-title")}</h2>
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
