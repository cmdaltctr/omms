import { useEffect, useRef, useState } from "react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { SettingRow } from "./SettingRow";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { isValidClaudeConfigDir, nextClaudeDraft } from "$lib/claude-folder-settings";
import { ReadOnlyNote } from "./ReadOnlyNote";

type ClaudeFolder = { root: string; source: "setting" | "env" | "default"; exists: boolean };
type Snapshot = {
  readOnly?: boolean;
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
  claudeFolder?: ClaudeFolder;
};

export function ClaudeFolderSection() {
  const s = useSettingsText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // True while the field holds text the user has not saved yet.
  const edited = useRef(false);
  useEffect(() => {
    let active = true;
    const show = (value: Snapshot) => {
      if (!active) return;
      setSnapshot(value);
      setDraft((draft) =>
        nextClaudeDraft(value.settings.claudeConfigDir?.globalValue, draft, edited.current)
      );
    };
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (read.isCurrent()) show(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    const unsubscribe = onSettingsSnapshot((value) => show(value as Snapshot));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const readOnly = snapshot?.readOnly === true;
  /** Asks first, with the folder that will be saved. The card's own feedback stays. */
  function save() {
    if (!snapshot) return;
    if (!isValidClaudeConfigDir(draft)) {
      setMessage(s("Enter a full path, or a path that starts with ~/."));
      return;
    }
    const edits = { claudeConfigDir: draft.trim() };
    const fields = [
      {
        key: "claudeConfigDir",
        label: name("claudeConfigDir"),
        // An unset folder means the usual one, both before the save and after it is emptied.
        print: (value: unknown) => (value ? String(value) : s("The usual Claude folder")),
      },
    ];
    const inForce = { claudeConfigDir: snapshot.settings.claudeConfigDir?.globalValue };
    const rows = changes(inForce, edits, fields);
    // Save stays on for an unchanged folder. The dialog has nothing to list for that, so the card
    // saves as it did before it asked first.
    if (rows.length === 0) {
      void saveFolder(edits);
      return;
    }
    ask({
      title: s("Save the Claude Code folder?"),
      body: <SettingsChangeList changes={rows} />,
      confirmLabel: s("Save folder"),
      busyLabel: s("Saving…"),
      run: () => saveFolder(edits),
    });
  }
  /** Saves the folder. A refusal keeps the dialog open with its reason. */
  async function saveFolder(edits: { claudeConfigDir: string }): Promise<ConfirmResult> {
    if (!snapshot) return { success: false };
    setBusy(true);
    let failure: string | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      edited.current = false;
      setMessage(s("Saved. Capture and import use this folder now."));
    } catch (error) {
      failure = (error as Error).message;
      setMessage(failure);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
    return failure === undefined ? { success: true } : { success: false, error: failure };
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Claude Code folder")}
    >
      <h2 className="text-section-title font-semibold">{s("Claude Code folder")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Set this when Claude Code does not use ~/.claude, for example when you start it with CLAUDE_CONFIG_DIR. Leave it empty to use the default."
        )}
      </p>
      <SettingRow setting="claudeConfigDir" controlId="claude-folder">
        <Input
          id="claude-folder"
          dir="ltr"
          className="font-mono"
          placeholder="~/.claude"
          value={draft}
          disabled={busy || !snapshot}
          onChange={(event) => {
            edited.current = true;
            setDraft(event.target.value);
          }}
        />
      </SettingRow>
      <Button type="button" disabled={busy || !snapshot || readOnly} onClick={() => save()}>
        {s("Save folder")}
      </Button>
      <ReadOnlyNote show={readOnly} />
      <ClaudeFolderStatus folder={snapshot?.claudeFolder} />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {dialog}
    </section>
  );
}

/** `claudeFolder` from `/api/settings`: the folder in use, where it comes from, and a missing folder warning. */
export function ClaudeFolderStatus({ folder }: { folder?: ClaudeFolder }) {
  const s = useSettingsText();
  if (!folder) return null;
  const sources = {
    setting: s("this setting"),
    env: s("the CLAUDE_CONFIG_DIR variable of the web app"),
    default: s("the default folder"),
  };
  return (
    <div className="space-y-1 text-sm">
      <p>
        {s("Transcripts folder in use")}: <span className="font-mono">{folder.root}</span>
      </p>
      <p>
        {s("From")}: {sources[folder.source]}
      </p>
      {!folder.exists && (
        <p role="status" className="text-amber-600">
          {s("This folder does not exist. Claude Code capture and import will not work:")}{" "}
          <span className="font-mono">{folder.root}</span>
        </p>
      )}
    </div>
  );
}
