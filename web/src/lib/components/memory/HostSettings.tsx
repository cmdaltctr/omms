import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { Select } from "$lib/components/ui/select";
import { manualModelFieldVisible, type ModelBackfillHost } from "$lib/auto-import-settings";
import { externalMissing } from "$lib/external-api-settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import type { Backfill } from "./use-backfill";

/** One host's own settings: its backfill model, and the global automatic-import switch. */
export function HostSettings({ host, backfill }: { host: WebHost; backfill: Backfill }) {
  const s = useSettingsText();
  const { snapshot, lists, busy } = backfill;
  const [choice, setChoice] = useState<string>();
  const [typedMode, setTypedMode] = useState<boolean>();
  const settings = snapshot?.settings ?? {};
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
            <input
              aria-label={`${hostLabel(host)} ${s("Manual provider/model")}`}
              className="w-full rounded-[10px] border border-border bg-card p-2"
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
            disabled={busy || !snapshot}
            onClick={() => backfill.saveModel(host as ModelBackfillHost, current)}
          >
            {s("Save model")}
          </Button>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(settings.autoBackfill?.globalValue)}
          disabled={busy || !snapshot}
          onChange={(event) => void backfill.save({ autoBackfill: event.target.checked })}
        />
        {s("Import past chats automatically")}
      </label>
      <p className="text-xs text-muted-foreground">
        {s("This switch applies to every host. Automatic import makes model calls.")}
      </p>
    </section>
  );
}
