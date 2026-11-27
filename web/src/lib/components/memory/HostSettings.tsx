import { useState } from "react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Select } from "$lib/components/ui/select";
import { Switch } from "$lib/components/ui/switch";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import {
  backfillModelEdit,
  manualModelFieldVisible,
  type ModelBackfillHost,
} from "$lib/auto-import-settings";
import { externalMissing } from "$lib/external-api-settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { TurnOnDialog } from "./TurnOnAction";
import type { Backfill } from "./use-backfill";
import { ReadOnlyNote, useSettingsReadOnly } from "../settings/ReadOnlyNote";

/** One host's own settings: its backfill model, and the global automatic-import switch. */
export function HostSettings({ host, backfill }: { host: WebHost; backfill: Backfill }) {
  const s = useSettingsText();
  const readOnly = useSettingsReadOnly();
  const { snapshot, lists, busy } = backfill;
  const { ask, dialog } = useSettingsConfirm();
  const { changes } = useSettingsChanges();
  const [choice, setChoice] = useState<string>();
  const [typedMode, setTypedMode] = useState<boolean>();
  // Turning automatic import on costs money on every host, so it keeps its own Turn on dialog.
  const [asking, setAsking] = useState(false);
  /** The switch while the turn-off dialog asks. Cancel puts the saved value back. */
  const [pendingAuto, setPendingAuto] = useState<boolean>();
  const settings = snapshot?.settings ?? {};
  const savedAuto = Boolean(settings.autoBackfill?.globalValue);
  const saved = String(settings[`${host}BackfillModel`]?.globalValue ?? "inherit");
  const current = choice ?? saved;
  const options = lists[host]?.models ?? [];
  const known =
    current === "inherit" ||
    current === "external" ||
    options.some((item) => `${item.provider}/${item.model}` === current);
  const typed = manualModelFieldVisible(typedMode, known);
  const missing = externalMissing({
    memoryProvider: settings.memoryProvider?.globalValue as string | undefined,
    memoryModel: settings.memoryModel?.globalValue as string | undefined,
    memoryApiUrl: settings.memoryApiUrl?.globalValue as string | undefined,
    keySet: Boolean(snapshot?.secrets?.memoryApiKey?.set),
  });
  const modelName = (value: unknown) =>
    value === "inherit"
      ? s("Same as live capture")
      : value === "external"
        ? s("External API")
        : String(value);

  /** A bad manual model shows its message on the page and opens no dialog. */
  function askModel() {
    let edits: Record<string, string>;
    try {
      edits = backfillModelEdit(host as ModelBackfillHost, current.trim());
    } catch (error) {
      backfill.setMessage(s((error as Error).message));
      return;
    }
    const key = `${host}BackfillModel`;
    const rows = changes({ [key]: saved }, edits, [
      { key, label: s("Backfill model"), print: modelName },
    ]);
    ask({
      title: s("Save the backfill model?"),
      body: <SettingsChangeList changes={rows} />,
      confirmLabel: s("Save model"),
      busyLabel: s("Saving…"),
      run: () => backfill.save(edits),
    });
  }

  /** Asks before automatic import turns off. The box shows the cleared state meanwhile. */
  function askTurnOff() {
    const edits = { autoBackfill: false };
    setPendingAuto(false);
    ask({
      title: s("Turn automatic import off?"),
      body: (
        <SettingsChangeList
          changes={changes({ autoBackfill: savedAuto }, edits, [
            { key: "autoBackfill", label: s("Import past chats automatically") },
          ])}
        />
      ),
      confirmLabel: s("Turn off"),
      busyLabel: s("Saving…"),
      onCancel: () => setPendingAuto(undefined),
      run: async () => {
        const result = await backfill.save(edits);
        // The reloaded snapshot shows the saved value, so the picked one can go.
        if (result.success) setPendingAuto(undefined);
        return result;
      },
    });
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={`${hostLabel(host)} ${s("settings")}`}
    >
      <h2 className="text-section-title font-semibold">{`${hostLabel(host)} ${s("settings")}`}</h2>
      {host === "claude-code" ? (
        <p className="text-sm text-muted-foreground">
          {s(
            "Claude Code backfill always uses the external API. It has no backfill model setting."
          )}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <label className="block">
            {s("Backfill model")}
            <div dir="ltr">
              <Select
                aria-label={`${hostLabel(host)} ${s("Backfill model")}`}
                className="mt-1 block w-full"
                value={typed ? "typed" : current}
                onChange={(event) => {
                  setTypedMode(event.target.value === "typed");
                  setChoice(event.target.value);
                }}
              >
                <option value="inherit">{s("Same as live capture")}</option>
                <option value="external" disabled={missing.length > 0}>
                  {s("External API")}
                </option>
                {options.map((item) => (
                  <option
                    key={`${item.provider}/${item.model}`}
                    value={`${item.provider}/${item.model}`}
                  >
                    {item.name} ({item.provider}/{item.model})
                  </option>
                ))}
                <option value="typed">{s("Manual provider/model")}</option>
              </Select>
            </div>
          </label>
          {typed && (
            <Input
              aria-label={`${hostLabel(host)} ${s("Manual provider/model")}`}
              dir="ltr"
              placeholder="provider/model"
              value={current === "typed" ? "" : current}
              onChange={(event) => setChoice(event.target.value)}
            />
          )}
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {s("External API needs")}: {missing.join(", ")}
            </p>
          )}
          {lists[host]?.available === false && (
            <p className="text-xs text-muted-foreground">
              {lists[host]!.reason
                ? s(lists[host]!.reason!)
                : s("Model list unavailable. Enter provider/model manually.")}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || readOnly || !snapshot}
            onClick={askModel}
          >
            {s("Save model")}
          </Button>
        </div>
      )}
      <label id="memory-section-auto-import" className="flex items-center gap-2 text-sm">
        <Switch
          checked={pendingAuto ?? savedAuto}
          disabled={busy || readOnly || !snapshot}
          onCheckedChange={(checked) => (checked ? setAsking(true) : askTurnOff())}
        />
        {s("Import past chats automatically")}
      </label>
      <ReadOnlyNote show={readOnly} />
      <p className="text-xs text-muted-foreground">
        {s("This switch applies to every host. Automatic import makes model calls.")}
      </p>
      {asking && (
        <TurnOnDialog
          onConfirm={async () => {
            await backfill.save({ autoBackfill: true });
          }}
          onClose={() => setAsking(false)}
        />
      )}
      {dialog}
    </section>
  );
}
