import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import {
  PRESET_KEYS,
  isRepeat,
  isSizeUnit,
  parseCap,
  presetSizeIn,
  presetsFrom,
  selectedPreset,
  type Preset,
  type Repeat,
  type SizeUnit,
} from "$lib/memorisation-model";

type Setting = { value?: unknown; globalValue?: unknown };
type Snapshot = { revision: string; settings: Record<string, Setting | undefined> };

export type SettingsStatus =
  | { kind: "load-failed" }
  | { kind: "repeat-saved" }
  | { kind: "size-saved" }
  | { kind: "rerank-saved" }
  | { kind: "presets-saved" }
  /** The number is outside the range of the chosen unit, so nothing was sent or the server refused it. */
  | { kind: "out-of-range"; unit: SizeUnit }
  | { kind: "stale" }
  /** The rerank save failed; `reason` is the server's message, when it gave one. */
  | { kind: "rerank-failed"; reason: string }
  /** The presets save failed; `reason` is the server's message, when it gave one. */
  | { kind: "presets-failed"; reason: string }
  | { kind: "failed" };

const saved = (snapshot: Snapshot | undefined, key: string) =>
  snapshot?.settings[key]?.globalValue ?? snapshot?.settings[key]?.value;

/**
 * The global memorisation settings, read from and saved through `/api/settings`. The repeat
 * choice saves on selection. The size cap and its unit save together, because the server checks
 * the pair. The size box keeps what the user typed until a save succeeds. The three preset sizes
 * (Short, Medium, Long, in characters) save together; the selected preset is never stored, it is
 * worked out from the box, the unit and the presets.
 */
export function useMemorisationSettings() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [sizeText, setSizeText] = useState("");
  const [unit, setUnit] = useState<SizeUnit>("characters");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SettingsStatus>();
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    const fill = (value: Snapshot) => {
      setSnapshot(value);
      const size = saved(value, "memorisationMaxSize");
      const savedUnit = saved(value, "memorisationSizeUnit");
      setSizeText(typeof size === "number" ? String(size) : "");
      setUnit(isSizeUnit(savedUnit) ? savedUnit : "characters");
    };
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) fill(value);
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    // Another card saved: keep the revision current without losing what is typed here.
    const stop = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  const savedRepeat = saved(snapshot, "memorisationRepeat");
  const savedSize = saved(snapshot, "memorisationMaxSize");
  const savedUnit = saved(snapshot, "memorisationSizeUnit");
  const savedRerank = saved(snapshot, "memorisationRerank");
  const savedRerankerUrl = saved(snapshot, "rerankerApiUrl");
  const savedRerankerModel = saved(snapshot, "rerankerModel");
  const presets = presetsFrom((key) => saved(snapshot, key));
  const sizeNow = typeof savedSize === "number" ? savedSize : undefined;
  const unitNow: SizeUnit = isSizeUnit(savedUnit) ? savedUnit : "characters";
  const rerankerReady =
    typeof savedRerankerUrl === "string" &&
    savedRerankerUrl.trim().length > 0 &&
    typeof savedRerankerModel === "string" &&
    savedRerankerModel.trim().length > 0;

  async function patch(
    edits: Record<string, unknown>,
    done: SettingsStatus,
    range?: SizeUnit,
    /** Builds the failure status from the server's message; default hides the message. */
    failed?: (message: string) => SettingsStatus
  ): Promise<boolean> {
    if (!snapshot || saving.current) return false;
    saving.current = true;
    setBusy(true);
    setStatus(undefined);
    let ok = true;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setStatus(done);
    } catch (error) {
      ok = false;
      const message = (error as Error)?.message ?? "";
      if (message.includes("Config changed")) setStatus({ kind: "stale" });
      else if (range && message.includes("memorisationMaxSize")) {
        setStatus({ kind: "out-of-range", unit: range });
      } else setStatus(failed ? failed(message) : { kind: "failed" });
    }
    // Reload either way, so the next save carries the file's current revision.
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
    saving.current = false;
    return ok;
  }

  return {
    loaded: snapshot !== undefined,
    busy,
    status,
    repeat: isRepeat(savedRepeat) ? savedRepeat : ("add" as Repeat),
    rerank: savedRerank === true,
    rerankerReady,
    savedSize: sizeNow,
    savedUnit: unitNow,
    sizeText,
    unit,
    presets,
    setSizeText,
    choosePreset: (preset: Preset) => setSizeText(String(presetSizeIn(presets[preset], unit))),
    /** A preset keeps its value across the switch; a custom number stays as typed. */
    chooseUnit: (next: SizeUnit) => {
      const preset = selectedPreset(sizeText, unit, presets);
      if (preset !== "custom") setSizeText(String(presetSizeIn(presets[preset], next)));
      setUnit(next);
    },
    /**
     * Saves the three presets. When the preset that the saved cap matches changes value, the cap
     * follows it in the saved unit, so that preset stays selected. Resolves true on success.
     */
    savePresets: async (values: Record<Preset, number>) => {
      const kept = selectedPreset(sizeNow, unitNow, presets);
      const edits: Record<string, unknown> = {
        [PRESET_KEYS.short]: values.short,
        [PRESET_KEYS.medium]: values.medium,
        [PRESET_KEYS.long]: values.long,
      };
      let cap: number | undefined;
      if (kept !== "custom" && values[kept] !== presets[kept]) {
        cap = presetSizeIn(values[kept], unitNow);
        edits.memorisationMaxSize = cap;
      }
      // The box follows the cap unless it holds an unsaved edit.
      const clean = sizeText.trim() === String(sizeNow ?? "") && unit === unitNow;
      const ok = await patch(
        edits,
        { kind: "presets-saved" },
        undefined,
        (message): SettingsStatus => ({ kind: "presets-failed", reason: message })
      );
      if (ok && cap !== undefined && clean) setSizeText(String(cap));
      return ok;
    },
    chooseRepeat: (value: Repeat) => patch({ memorisationRepeat: value }, { kind: "repeat-saved" }),
    chooseRerank: (value: boolean) =>
      patch(
        { memorisationRerank: value },
        { kind: "rerank-saved" },
        undefined,
        (message): SettingsStatus => ({ kind: "rerank-failed", reason: message })
      ),
    saveSize: () => {
      const size = parseCap(sizeText, unit);
      if (size === null) return setStatus({ kind: "out-of-range", unit });
      return patch(
        { memorisationMaxSize: size, memorisationSizeUnit: unit },
        { kind: "size-saved" },
        unit
      );
    },
  };
}
