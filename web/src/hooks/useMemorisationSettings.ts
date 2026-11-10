import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import {
  isRepeat,
  isSizeUnit,
  parseCap,
  type Repeat,
  type SizeUnit,
} from "$lib/memorisation-model";

type Setting = { value?: unknown; globalValue?: unknown };
type Snapshot = { revision: string; settings: Record<string, Setting | undefined> };

export type SettingsStatus =
  | { kind: "load-failed" }
  | { kind: "repeat-saved" }
  | { kind: "size-saved" }
  /** The number is outside the range of the chosen unit, so nothing was sent or the server refused it. */
  | { kind: "out-of-range"; unit: SizeUnit }
  | { kind: "stale" }
  | { kind: "failed" };

const saved = (snapshot: Snapshot | undefined, key: string) =>
  snapshot?.settings[key]?.globalValue ?? snapshot?.settings[key]?.value;

/**
 * The three global memorisation settings, read from and saved through `/api/settings`. The repeat
 * choice saves on selection. The size cap and its unit save together, because the server checks
 * the pair. The size box keeps what the user typed until a save succeeds.
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

  async function patch(edits: Record<string, unknown>, done: SettingsStatus, range?: SizeUnit) {
    if (!snapshot || saving.current) return;
    saving.current = true;
    setBusy(true);
    setStatus(undefined);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setStatus(done);
    } catch (error) {
      const message = (error as Error)?.message ?? "";
      if (message.includes("Config changed")) setStatus({ kind: "stale" });
      else if (range && message.includes("memorisationMaxSize")) {
        setStatus({ kind: "out-of-range", unit: range });
      } else setStatus({ kind: "failed" });
    }
    // Reload either way, so the next save carries the file's current revision.
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
    saving.current = false;
  }

  return {
    loaded: snapshot !== undefined,
    busy,
    status,
    repeat: isRepeat(savedRepeat) ? savedRepeat : ("add" as Repeat),
    savedSize: typeof savedSize === "number" ? savedSize : undefined,
    savedUnit: isSizeUnit(savedUnit) ? savedUnit : ("characters" as SizeUnit),
    sizeText,
    unit,
    setSizeText,
    setUnit,
    chooseRepeat: (value: Repeat) => patch({ memorisationRepeat: value }, { kind: "repeat-saved" }),
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
