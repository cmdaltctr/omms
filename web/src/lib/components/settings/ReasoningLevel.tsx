import { useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import { reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import {
  hasReasoningFacts,
  ignoredReasoningField,
  reasoningChoices,
  reasoningFamily,
  savedLevel,
  type ExtraParams,
  type ReasoningFacts,
  type ReasoningLevel as Level,
} from "$shared/model-reasoning";
import { Blocked } from "./OpenRouterProviderRows";
import { ReadOnlyNote } from "./ReadOnlyNote";

const SAVE_PATH = "/api/settings/external-api/reasoning";

type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

/**
 * The Reasoning level of the saved external API endpoint. The field comes from the SAVED URL
 * and provider, so `unsaved` (the card shows an edit that is not saved) turns Save off. `models`
 * is OpenRouter's model list, which holds each model's reasoning facts. `saved` holds the saved
 * `reasoning`, `reasoning_effort` and `thinking` members of the global `memoryExtraParams`.
 */
export function ReasoningLevel({
  revision,
  saved,
  savedUrl,
  savedProvider,
  savedModel,
  unsaved,
  models,
  readOnly = false,
}: {
  revision: string;
  saved: ExtraParams;
  savedUrl: string;
  savedProvider: string;
  savedModel: string;
  unsaved: boolean;
  models: (ReasoningFacts & { id: string })[];
  readOnly?: boolean;
}) {
  const s = useSettingsText();
  // A pick belongs to the saved endpoint it was made for. `at` is that endpoint.
  const [picked, setPicked] = useState<{ at: string; level: string }>();
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const { ask, dialog } = useSettingsConfirm();
  const { changes } = useSettingsChanges();

  const family = reasoningFamily(savedUrl, savedProvider);
  if (family === "none") {
    return (
      <p className="text-xs text-muted-foreground">
        {s("Reasoning for this provider is set in memoryExtraParams in the config file.")}
      </p>
    );
  }

  const model = models.find((row) => row.id === savedModel.trim());
  const facts = hasReasoningFacts(model) ? model : undefined;
  const choices = reasoningChoices(family, facts);
  const current = savedLevel(family, saved);
  const initial = current !== "custom" && choices.levels.includes(current) ? current : "custom";
  const at = [savedUrl, savedProvider, savedModel].join("\n");
  // A pick from another endpoint, or one the model's facts no longer offer, is dropped.
  const shown =
    picked?.at === at && choices.levels.includes(picked.level as Level) ? picked.level : initial;
  const toggle = family === "openrouter" && choices.levels.includes("on");
  const ignored = ignoredReasoningField(family, saved);

  const names: Record<Level, string> = {
    default: s("Default"),
    off: s("Off"),
    on: s("On"),
    minimal: s("Minimal"),
    low: s("Low"),
    medium: s("Medium"),
    high: s("High"),
    xhigh: s("Extra high"),
    max: s("Max"),
  };
  const label = (level: Level) =>
    level === "default" && choices.defaultEffort
      ? s("Default ({effort})").replace(
          "{effort}",
          names[choices.defaultEffort as Level] ?? choices.defaultEffort
        )
      : names[level];

  const blockReason = unsaved
    ? s("Save the endpoint first. The level applies to the saved URL, provider and model.")
    : undefined;

  /** Posts the shown level and reloads the settings. Returns the failure message, if any. */
  async function submit(): Promise<string | undefined> {
    try {
      await settingsRequest(SAVE_PATH, {
        method: "POST",
        body: JSON.stringify({ revision, level: shown, ...(toggle ? { toggle: true } : {}) }),
      });
      // The pick stays on screen until a fresh snapshot holds the saved level.
      if (await reloadSettingsSnapshot()) setPicked(undefined);
      return undefined;
    } catch (error) {
      await reloadSettingsSnapshot();
      return (error as Error).message;
    }
  }

  /** Saves the level and reports on the card. A refusal keeps the dialog open with its reason. */
  async function saveLevelNow(): Promise<ConfirmResult> {
    setSave({ kind: "saving" });
    const failure = await submit();
    if (failure !== undefined) {
      setSave({ kind: "error", message: failure });
      return { success: false, error: failure };
    }
    setSave({ kind: "saved" });
    return { success: true };
  }

  /** Asks first. The picked level stays on screen as a draft when the user cancels. */
  function saveLevel() {
    const fields = [
      {
        key: "level",
        label: s("Reasoning level"),
        print: (value: unknown) => label(value as Level),
      },
    ];
    const rows = changes({ level: initial }, { level: shown }, fields);
    ask({
      title: s("Save reasoning level?"),
      body: <SettingsChangeList changes={rows} />,
      confirmLabel: s("Save reasoning level"),
      busyLabel: s("Saving reasoning level…"),
      run: saveLevelNow,
    });
  }

  // A hand-written value is replaced by the save, so the user confirms first. The dialog shows
  // the progress and the server's error, and closes on success.
  function askToReplace() {
    ask({
      title: s("Replace the value in the config file?"),
      body: (
        <p>
          {s(
            "The config file holds a reasoning value that this control cannot show. Saving a level replaces it."
          )}
        </p>
      ),
      confirmLabel: s("Replace"),
      busyLabel: s("Saving reasoning level…"),
      destructive: true,
      run: async () => {
        const failure = await submit();
        if (failure !== undefined) return { success: false, error: failure };
        setSave({ kind: "saved" });
        return { success: true };
      },
    });
  }

  const button = (
    <Button
      disabled={
        save.kind === "saving" || readOnly || shown === "custom" || blockReason !== undefined
      }
      aria-describedby={blockReason === undefined ? undefined : "reasoning-save-reason"}
      onClick={() => (initial === "custom" ? askToReplace() : saveLevel())}
    >
      {s("Save reasoning level")}
    </Button>
  );
  const note = (message: string) => <p className="text-xs text-muted-foreground">{message}</p>;
  return (
    <div className="space-y-2">
      <Label htmlFor="external-api-reasoning" className="font-medium">
        {s("Reasoning level")}
      </Label>
      <div className="sm:w-72 sm:max-w-full">
        <Select
          id="external-api-reasoning"
          value={shown}
          disabled={save.kind === "saving"}
          onChange={(event) => {
            setPicked({ at, level: event.target.value });
            setSave({ kind: "idle" });
          }}
        >
          {initial === "custom" && (
            <option value="custom" disabled>
              {s("Set in the config file")}
            </option>
          )}
          {choices.levels.map((level) => (
            <option key={level} value={level}>
              {label(level)}
            </option>
          ))}
        </Select>
      </div>
      {note(s("Lower levels answer faster."))}
      {choices.note === "nearest" &&
        note(s("OpenRouter uses the nearest level the model supports."))}
      {choices.note === "may-ignore" &&
        note(s("This endpoint may ignore or refuse this field. Default sends nothing."))}
      {ignored && (
        <Callout tone="warning">
          <p>
            {ignored === "thinking"
              ? s("OpenRouter ignores the saved thinking field.")
              : s("DeepSeek ignores the saved reasoning field.")}
          </p>
          <p>{s("Saving a level replaces it.")}</p>
        </Callout>
      )}
      {blockReason === undefined ? button : <Blocked reason={blockReason}>{button}</Blocked>}
      <ReadOnlyNote show={readOnly} />
      {dialog}
      {blockReason !== undefined && (
        <p id="reasoning-save-reason" className="text-xs text-muted-foreground">
          {blockReason}
        </p>
      )}
      {save.kind === "saving" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s("Saving reasoning level…")}
        </p>
      )}
      {save.kind === "saved" && (
        <p role="status" className="text-sm">
          {s("Reasoning level saved.")}
        </p>
      )}
      {save.kind === "error" && (
        <p role="alert" className="text-sm text-destructive-label">
          {save.message}
        </p>
      )}
    </div>
  );
}
