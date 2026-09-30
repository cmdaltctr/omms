import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { isValidClaudeConfigDir, nextClaudeDraft } from "$lib/claude-folder-settings";

type ClaudeFolder = { root: string; source: "setting" | "env" | "default"; exists: boolean };
type Snapshot = {
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
  claudeFolder?: ClaudeFolder;
};

export function ClaudeFolderSection() {
  const s = useSettingsText();
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
  async function save() {
    if (!snapshot) return;
    if (!isValidClaudeConfigDir(draft)) {
      setMessage(s("Enter a full path, or a path that starts with ~/."));
      return;
    }
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          edits: { claudeConfigDir: draft.trim() },
          revision: snapshot.revision,
        }),
      });
      edited.current = false;
      setMessage(s("Saved. Capture and import use this folder now."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Claude Code folder")}
    >
      <h2 className="text-lg font-medium">{s("Claude Code folder")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Set this when Claude Code does not use ~/.claude, for example when you start it with CLAUDE_CONFIG_DIR. Leave it empty to use the default."
        )}
      </p>
      <label className="block space-y-1 text-sm">
        <span>{s("Claude Code folder")}</span>
        <input
          className="w-full rounded border border-border bg-background p-2 font-mono"
          placeholder="~/.claude"
          value={draft}
          disabled={busy || !snapshot}
          onChange={(event) => {
            edited.current = true;
            setDraft(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="rounded border border-border px-3 py-1.5 text-sm"
        disabled={busy || !snapshot}
        onClick={() => void save()}
      >
        {s("Save folder")}
      </button>
      <ClaudeFolderStatus folder={snapshot?.claudeFolder} />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
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
