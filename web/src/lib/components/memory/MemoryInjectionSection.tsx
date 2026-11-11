import { useEffect, useRef, useState } from "react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Callout } from "$lib/components/skills/Callout";
import { Textarea } from "$lib/components/ui/textarea";
import { useSettingsText } from "$lib/i18n/settings";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import {
  DEFAULT_INJECTION_DRAFT,
  OPENING_QUERY_MAX,
  canSaveInjection,
  injectionDraftFromSettings,
  injectionProblem,
  injectionSaveEdits,
  type InjectionDraft,
  type InjectionSettings,
} from "$lib/injection-controls";

type Snapshot = { revision: string; settings: InjectionSettings };

/** Store status identities so a language switch retranslates the feedback. */
type Status =
  | { kind: "load-failed" }
  | { kind: "saved"; reloaded: boolean }
  | { kind: "save-failed"; message: string; reloaded: boolean };

/** `/memory`: when OMMS adds memories to a session without a search from the user. */
export function MemoryInjectionSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<InjectionDraft>(DEFAULT_INJECTION_DRAFT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const saving = useRef(false);
  // The draft the file held at the last load, so a refresh keeps typed values.
  const loaded = useRef<InjectionDraft>(DEFAULT_INJECTION_DRAFT);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    let active = true;
    const apply = (value: Snapshot) => {
      const next = injectionDraftFromSettings(value.settings);
      const untouched = JSON.stringify(draftRef.current) === JSON.stringify(loaded.current);
      loaded.current = next;
      setSnapshot(value);
      if (untouched) setDraft(next);
    };
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) apply(value);
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) apply(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const problem = injectionProblem(draft);
  const canSave = canSaveInjection(draft, loaded.current);
  const update = (patch: Partial<InjectionDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  async function save() {
    if (!snapshot || !canSave || saving.current) return;
    saving.current = true;
    setBusy(true);
    let failure: Error | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          edits: injectionSaveEdits(draft, loaded.current),
          revision: snapshot.revision,
        }),
      });
    } catch (error) {
      failure = error as Error;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    saving.current = false;
    setStatus(
      failure
        ? { kind: "save-failed", message: failure.message, reloaded }
        : { kind: "saved", reloaded }
    );
  }

  function statusText(current: Status): string {
    if (current.kind === "load-failed")
      return s("The memory injection settings could not be loaded. Reload the page to try again.");
    if (current.kind === "saved")
      return current.reloaded
        ? s("Saved. The next session uses these options.")
        : withNote(
            s("Saved. The next session uses these options."),
            s("Reload the page before saving again.")
          );
    // The writer's message names the key and the rule and never repeats the value.
    const note = current.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    return withNote(s(current.message), note);
  }

  const lengthLabel = `${draft.query.length} / ${OPENING_QUERY_MAX}`;
  return (
    <section
      id="memory-injection"
      className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Memory injection")}
    >
      <h2 className="text-section-title font-semibold">{s("Memory injection")}</h2>
      <p className="text-xs text-muted-foreground">
        {s("Sets how OMMS adds memories to the context the model sees.")}
      </p>
      <Callout tone="success">
        <p>{s("Memories are added at these moments:")}</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            {s(
              "With every message: the memories that match that message. On by default. chatMessage.enabled in the config file turns it off, and the first-message and subagent options with it."
            )}
          </li>
          <li>
            {s(
              "With the first message of a new session: the memories that match the query below. Needs the first switch."
            )}
          </li>
          <li>
            {s(
              "For a subagent: the memories that match its task. Claude Code adds them once, when the subagent starts. OpenCode V2 and Pi add them with each prompt the subagent gets. Needs the Subagent memory switch."
            )}
          </li>
          <li>
            {s(
              "After a compaction or resume: the memories that session captured. Needs the Restore switch."
            )}
          </li>
        </ul>
        <p>{s("Nothing is added when a new session opens.")}</p>
      </Callout>
      <p className="text-xs text-muted-foreground">
        {s(
          "A project config can turn the first-message and subagent options off. It can turn restore on or off."
        )}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="injection-opening"
              role="switch"
              checked={draft.opening}
              disabled={busy}
              aria-describedby="injection-opening-help"
              onChange={(event) => update({ opening: event.target.checked })}
            />
            <Label htmlFor="injection-opening">{s("Inject memories with the first message")}</Label>
          </div>
          <p id="injection-opening-help" className="text-xs text-muted-foreground">
            {s(
              "Added once, with the first message of a new session. Nothing is added when a new session opens. OMMS searches the query below and adds only matching memories."
            )}
          </p>
          <Callout tone="info">
            <p>
              {s(
                "Claude Code can add memories when a session opens. Pi and OpenCode V2 cannot. To keep all three the same, OMMS adds them with the first message on every host."
              )}
            </p>
          </Callout>
        </div>
        <div className="space-y-2">
          <Label htmlFor="injection-query">{s("First-message search query")}</Label>
          <Textarea
            id="injection-query"
            maxLength={OPENING_QUERY_MAX}
            rows={3}
            disabled={busy}
            value={draft.query}
            aria-invalid={problem === "query" || undefined}
            aria-describedby="injection-query-count"
            onChange={(event) => update({ query: event.target.value })}
          />
          <span
            id="injection-query-count"
            dir="ltr"
            className="block text-xs tabular-nums text-muted-foreground"
          >
            {lengthLabel}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="injection-subagent"
              role="switch"
              checked={draft.subagent}
              disabled={busy}
              aria-describedby="injection-subagent-help"
              onChange={(event) => update({ subagent: event.target.checked })}
            />
            <Label htmlFor="injection-subagent">{s("Subagent memory")}</Label>
          </div>
          <p id="injection-subagent-help" className="text-xs text-muted-foreground">
            {s(
              "Subagents get memories that match their task. Claude Code adds them once, at start. OpenCode V2 and Pi add them with each subagent prompt. No rows are shown for them."
            )}
          </p>
          <Callout tone="warning">
            <p>
              {s(
                "Applies to OpenCode V2, Pi and Claude Code. On Pi, a subagent gets memory only when its agent maps the OMMS extension in om-pi-subagents. Turn it on in /omps-settings, Agent capabilities, Memory."
              )}
            </p>
          </Callout>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="injection-restore"
              role="switch"
              checked={draft.restore}
              disabled={busy}
              onChange={(event) => update({ restore: event.target.checked })}
            />
            <Label htmlFor="injection-restore">
              {s("Restore memories after compaction or resume")}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {s(
              "Added when a session resumes or compacts. Restores the memories that session captured."
            )}
          </p>
          <Label htmlFor="injection-limit">{s("Most memories to restore")}</Label>
          <Input
            type="number"
            id="injection-limit"
            className="w-36 tabular-nums"
            inputMode="numeric"
            step={1}
            min={1}
            disabled={busy}
            value={draft.limit}
            aria-invalid={problem === "limit" || undefined}
            aria-describedby="injection-limit-help"
            onChange={(event) => update({ limit: event.target.value })}
          />
          <span
            id="injection-limit-help"
            className={`block text-xs ${problem === "limit" ? "text-red-600" : "text-muted-foreground"}`}
          >
            {s("Enter a positive whole number.")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !snapshot || !canSave}>
            {s("Save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setDraft(DEFAULT_INJECTION_DRAFT)}
          >
            {s("Reset to default")}
          </Button>
        </div>
      </form>
      {status && (
        <p role="status" className="text-sm">
          {statusText(status)}
        </p>
      )}
    </section>
  );
}
