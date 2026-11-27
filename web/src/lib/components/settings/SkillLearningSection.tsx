import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { Switch as SwitchControl } from "$lib/components/ui/switch";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { useSettingsText } from "$lib/i18n/settings";
import { skillsApi, type SkillStats } from "$lib/skills-api";
import { countText, fileSizeText, fill } from "$lib/skills-model";
import { Callout } from "../skills/Callout";
import { RecordPast } from "../skills/RecordPast";
import { useSkillSettings } from "../skills/use-skill-settings";
import { ReadOnlyNote, useSettingsReadOnly } from "./ReadOnlyNote";

export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-start gap-2.5 text-sm">
      <SwitchControl
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <span className="min-w-0 break-words font-medium">{label}</span>
    </label>
  );
}

export type SkillLearningCardProps = {
  recording: boolean;
  redact: boolean;
  projectOff: boolean;
  stats: SkillStats | null;
  /** Switches and buttons wait while a save runs or settings are loading. */
  busy: boolean;
  /** The config file cannot be read, so the two switches cannot save. */
  readOnly?: boolean;
  confirm: "delete" | null;
  message: string;
  failure: string;
  onRecording: (on: boolean) => void;
  onRedact: (on: boolean) => void;
  onConfirm: (what: "delete" | null) => void;
  onDeleteTurns: () => void;
  onRecordPastEnd: () => void;
};

/** The card as pure markup, so each warning and confirmation can be checked on its own. */
export function SkillLearningCard(props: SkillLearningCardProps) {
  const s = useSettingsText();
  const { recording, redact, stats, busy, confirm } = props;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Skill learning")}
    >
      <h2 className="text-section-title font-semibold">{s("Skill learning")}</h2>
      <p className="text-sm text-muted-foreground">
        {s("Record agent turns so OMMS can rank your skills and draft improvements.")}
      </p>

      <div className="space-y-3">
        <Switch
          label={s("Record agent turns")}
          checked={recording}
          disabled={busy || props.readOnly === true}
          onChange={props.onRecording}
        />
        <ReadOnlyNote show={props.readOnly === true} />
        {props.projectOff ? (
          <p className="text-xs text-muted-foreground">
            {s("A project config turns recording off for this project.")}
          </p>
        ) : null}
        {recording ? (
          <>
            <Callout tone="warning">
              <p>
                {s(
                  "OMMS stores full prompts, replies and tool calls in skills.db on this computer. Drafting sends recorded turns to the external API. The file holds whatever the turns hold."
                )}
              </p>
              <p>
                {s(
                  "The memory chat sends skill counts and short change summaries to the external API, never turn text."
                )}
              </p>
            </Callout>
            <RecordPast onEnd={props.onRecordPastEnd} />
          </>
        ) : null}
      </div>

      <div className="space-y-3">
        <Switch
          label={s("Remove private text and secrets")}
          checked={redact}
          disabled={busy || props.readOnly === true}
          onChange={props.onRedact}
        />
        {!redact ? (
          <Callout tone="danger">
            <p>
              {s(
                "<private> text, API keys and passwords will be stored as written and sent to the external API when drafting."
              )}
            </p>
          </Callout>
        ) : null}
      </div>

      <dl className="grid max-w-md grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-border px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{s("Recorded turns")}</dt>
          <dd className="font-medium tabular-nums">{stats ? countText(stats.turns) : "…"}</dd>
        </div>
        <div className="rounded-xl border border-border px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{s("File size")}</dt>
          <dd className="font-medium tabular-nums">{stats ? fileSizeText(stats.fileSize) : "…"}</dd>
        </div>
      </dl>

      <div className="space-y-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy || !stats || stats.turns === 0}
          onClick={() => props.onConfirm("delete")}
        >
          <Trash2 aria-hidden="true" />
          {s("Delete recorded turns")}
        </Button>
        {confirm === "delete" && stats ? (
          <Callout tone="danger">
            <p className="font-medium">
              {fill(s("Delete {count} recorded turns? This cannot be undone."), {
                count: countText(stats.turns),
              })}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="destructive" size="sm" onClick={props.onDeleteTurns}>
                {s("Delete")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => props.onConfirm(null)}
              >
                {s("Cancel")}
              </Button>
            </div>
          </Callout>
        ) : null}
      </div>

      {props.message ? (
        <p role="status" className="text-sm">
          {props.message}
        </p>
      ) : null}
      {props.failure ? (
        <p role="alert" className="text-sm text-destructive-label">
          {props.failure}
        </p>
      ) : null}
    </section>
  );
}

/** Skill learning settings: recording, redaction, the store size and a delete. */
export function SkillLearningSection() {
  const s = useSettingsText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const { snapshot, loadError, busy, save } = useSkillSettings();
  const readOnly = useSettingsReadOnly();
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  /** The values picked while a dialog asks. Cancel puts the saved ones back. */
  const [pendingRecording, setPendingRecording] = useState<boolean>();
  const [pendingRedact, setPendingRedact] = useState<boolean>();

  const loadStats = useCallback(async () => {
    const reply = await skillsApi.stats();
    if (reply.ok) setStats(reply.data);
  }, []);
  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const recordEntry = snapshot?.settings.skillLearning;
  const savedRecording = recordEntry?.globalValue === true;
  const savedRedact = snapshot?.settings.skillLearningRedact?.globalValue !== false;

  async function change(edits: Record<string, unknown>): Promise<string | null> {
    setMessage("");
    setFailure("");
    setConfirm(null);
    const error = await save(edits);
    if (error) setFailure(error);
    else setMessage(s("Saved."));
    await loadStats();
    return error;
  }

  /** The run every switch dialog shares: save, then drop the pending value once the file agrees. */
  async function runSwitch(
    dropPending: (value: boolean | undefined) => void,
    edits: Record<string, unknown>
  ) {
    const error = await change(edits);
    if (error) return { success: false, error };
    // The reloaded snapshot shows the saved value, so the picked one can go.
    dropPending(undefined);
    return { success: true };
  }

  /** Asks before the recording switch saves. The switch shows the picked value meanwhile. */
  function turnRecording(on: boolean) {
    const edits = { skillLearning: on };
    setPendingRecording(on);
    ask({
      title: s(on ? "Turn on skill learning?" : "Turn off skill learning?"),
      body: (
        <SettingsChangeList
          changes={changes({ skillLearning: savedRecording }, edits, [
            { key: "skillLearning", label: name("skillLearning") },
          ])}
        />
      ),
      confirmLabel: s(on ? "Turn on" : "Turn off"),
      busyLabel: s("Saving…"),
      onCancel: () => setPendingRecording(undefined),
      run: () => runSwitch(setPendingRecording, edits),
    });
  }

  /** Asks before the redaction switch saves; the dialog carries the old warning when it turns off. */
  function turnRedact(on: boolean) {
    const edits = { skillLearningRedact: on };
    setPendingRedact(on);
    ask({
      title: s(on ? "Remove private text and secrets?" : "Stop removing private text and secrets?"),
      body: (
        <>
          <SettingsChangeList
            changes={changes({ skillLearningRedact: savedRedact }, edits, [
              { key: "skillLearningRedact", label: name("skillLearningRedact") },
            ])}
          />
          {!on ? <p>{s("New turns will be stored as written.")}</p> : null}
        </>
      ),
      confirmLabel: s(on ? "Turn on" : "Turn off"),
      busyLabel: s("Saving…"),
      destructive: !on,
      onCancel: () => setPendingRedact(undefined),
      run: () => runSwitch(setPendingRedact, edits),
    });
  }

  async function deleteTurns() {
    setConfirm(null);
    setFailure("");
    const reply = await skillsApi.deleteTurns();
    if (reply.ok) {
      setMessage(
        fill(s("Deleted {count} recorded turns."), { count: countText(reply.data.deleted) })
      );
    } else setFailure(reply.error);
    await loadStats();
  }

  return (
    <>
      <SkillLearningCard
        recording={pendingRecording ?? savedRecording}
        redact={pendingRedact ?? savedRedact}
        projectOff={recordEntry?.source === "project" && recordEntry.value === false}
        stats={stats}
        busy={busy || !snapshot}
        readOnly={readOnly}
        confirm={confirm}
        message={message}
        failure={failure || loadError}
        onRecording={(on) => turnRecording(on)}
        onRedact={(on) => turnRedact(on)}
        onConfirm={setConfirm}
        onDeleteTurns={() => void deleteTurns()}
        onRecordPastEnd={() => void loadStats()}
      />
      {dialog}
    </>
  );
}
