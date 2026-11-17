import { useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { useCardText } from "$lib/i18n/settings-cards";
import { settingsRequest } from "$lib/settings-api";
import { saveSettingEdits } from "$lib/settings-save";
import { SettingRow } from "./SettingRow";

type Setting = { value?: unknown; source?: string; globalValue?: unknown };
type Snapshot = {
  revision: string;
  readOnly?: boolean;
  /** True when the file sets the retired `autoCleanupEnabled` and not `autoDeleteOldMemories`. */
  legacyCleanupKey?: boolean;
  settings: Record<string, Setting | undefined>;
  /** Problems of the last config load: a rejected value can turn deletion off for this load. */
  problems?: { key?: string; off?: string }[];
};

const SWITCH = "autoDeleteOldMemories";
const DAYS = "autoCleanupRetentionDays";
const DEFAULT_DAYS = 30;

/** The number of days as the form holds it, or null when it is not a whole number of 1 or more. */
function parseDays(text: string): number | null {
  const value = Number(text);
  return text.trim() !== "" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/**
 * The only place a user turns automatic deletion on. The switch writes `autoDeleteOldMemories`
 * and never the retired `autoCleanupEnabled`. Turning it on, or lowering the days while it is on,
 * first shows how many memories the deletion would remove now. When that count cannot be read,
 * the dialog refuses the save.
 */
export function MemoryCleanupSection() {
  const t = useCardText();
  const { snapshot, error: loadError } = useSettingsSnapshot<Snapshot>();
  const { ask, dialog } = useSettingsConfirm();
  const [on, setOn] = useState<boolean>();
  const [daysText, setDaysText] = useState<string>();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // A rejected value (such as the days as text) keeps deletion off for this load.
  const heldOff = snapshot?.problems?.some((problem) => problem.off === SWITCH) === true;
  const daysRejected = snapshot?.problems?.some((problem) => problem.key === DAYS) === true;
  const savedOn = snapshot?.settings[SWITCH]?.globalValue === true && !heldOff;
  const savedDays = Number(snapshot?.settings[DAYS]?.globalValue ?? DEFAULT_DAYS);
  const nextOn = on ?? savedOn;
  const text = daysText ?? String(savedDays);
  const days = parseDays(text);
  const dayProblem = days === null;
  const readOnly = snapshot?.readOnly === true;

  const edits: Record<string, unknown> = {};
  if (nextOn !== savedOn) edits[SWITCH] = nextOn;
  if (days !== null && days !== savedDays) edits[DAYS] = days;
  const changed = Object.keys(edits).length > 0;
  // A save then also writes the days, so the rejected value in the file is replaced.
  if (changed && daysRejected && days !== null) edits[DAYS] = days;
  // Deletion that reaches more memories than the saved setting does needs a count first.
  const needsCount = nextOn && days !== null && (!savedOn || days < savedDays);

  async function commit(): Promise<{ success: boolean; error?: string }> {
    const result = await saveSettingEdits(snapshot!.revision, edits);
    setFailed(!result.success);
    if (result.success) {
      setOn(undefined);
      setDaysText(undefined);
      setMessage(t("Saved."));
    }
    return result;
  }

  async function save() {
    if (!snapshot || !changed || days === null) return;
    setMessage("");
    if (!needsCount) {
      setBusy(true);
      const result = await commit();
      setBusy(false);
      if (!result.success) setMessage(result.error ?? "");
      return;
    }
    setBusy(true);
    let count: number | null;
    try {
      const reply = await settingsRequest<{ count?: unknown }>(
        `/api/settings/auto-cleanup/preview?days=${days}`
      );
      count = typeof reply.count === "number" && reply.count >= 0 ? reply.count : null;
    } catch {
      count = null;
    }
    setBusy(false);
    const sentence =
      count === null
        ? ""
        : count === 0
          ? t(
              "No memory is that old yet, so the next daily check deletes nothing. From then on a memory is deleted when it reaches {days} days without a change.",
              { days }
            )
          : count === 1
            ? t(
                "1 memory has not changed for {days} days. OMMS deletes it at its next daily check.",
                { days }
              )
            : t(
                "{count} memories have not changed for {days} days. OMMS deletes them at its next daily check.",
                { count: count.toLocaleString("en-US"), days }
              );
    ask({
      title: t(savedOn ? "Delete memories after fewer days?" : "Turn on automatic deletion?"),
      body: (
        <>
          {sentence ? <p>{sentence}</p> : null}
          <p>
            {t(
              "Pinned memories and memorisations stay. OMMS checks once a day. A deleted memory cannot be restored."
            )}
          </p>
        </>
      ),
      confirmLabel: t(savedOn ? "Delete memories sooner" : "Turn on deletion"),
      busyLabel: t("Saving…"),
      destructive: true,
      // Cancel puts the switch back to its saved state, so nobody thinks deletion is on.
      onCancel: () => setOn(undefined),
      blocked:
        count === null
          ? t(
              "OMMS could not count the memories this would delete, so it will not turn deletion on. Try again in a moment. If it fails again, the Log card on this page shows why."
            )
          : undefined,
      run: commit,
    });
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={t("Memory cleanup")}
    >
      <h2 className="text-section-title font-semibold">{t("Memory cleanup")}</h2>
      <Callout tone="warning">
        <p>
          {t(
            "Turning this on deletes memories. It removes memories that are not pinned and have not changed for the number of days below, in every project. A deleted memory cannot be restored. OpenCode, Pi and Claude Code all follow this switch."
          )}
        </p>
        <p>{t("A project file cannot change these settings.")}</p>
      </Callout>
      {snapshot?.legacyCleanupKey && !savedOn ? (
        <Callout tone="info">
          <p>
            {t(
              "An older setting, autoCleanupEnabled, is still in your config file. It no longer deletes anything. The switch on this card turns deletion on. OMMS does not change your file by itself."
            )}
          </p>
        </Callout>
      ) : null}
      {heldOff ? (
        <p className="text-sm text-status-warning">
          {t(
            "Deletion is off for now, because a value in your config file cannot be used. The message at the top of the page says which one."
          )}
        </p>
      ) : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      <div className="space-y-4">
        <SettingRow setting={SWITCH} controlId={`cleanup-${SWITCH}`}>
          <Checkbox
            id={`cleanup-${SWITCH}`}
            checked={nextOn}
            disabled={busy || !snapshot}
            onCheckedChange={(checked) => {
              setOn(checked === true);
              setMessage("");
            }}
          />
        </SettingRow>
        <SettingRow setting={DAYS} controlId={`cleanup-${DAYS}`}>
          <Input
            id={`cleanup-${DAYS}`}
            type="number"
            min={1}
            inputMode="numeric"
            value={text}
            disabled={busy || !snapshot}
            aria-invalid={dayProblem}
            aria-describedby={dayProblem ? `cleanup-${DAYS}-problem` : undefined}
            onChange={(event) => {
              setDaysText(event.target.value);
              setMessage("");
            }}
          />
          {dayProblem ? (
            <p id={`cleanup-${DAYS}-problem`} className="mt-1 text-xs text-destructive-label">
              {t("Use a whole number of 1 or more.")}
            </p>
          ) : null}
        </SettingRow>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || !snapshot || readOnly || !changed || dayProblem}
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {t("Saving is turned off until the file is fixed.")}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t(needsCount ? "Counting…" : "Saving…")}
          </p>
        ) : null}
        {message ? (
          <p role={failed ? "alert" : "status"} className="text-sm">
            {message}
          </p>
        ) : null}
      </div>
      {dialog}
    </section>
  );
}
