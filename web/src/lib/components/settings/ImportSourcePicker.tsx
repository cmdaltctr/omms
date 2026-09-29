import { useState } from "react";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import type { WebHost } from "$lib/host-label";

export type ChosenSource = {
  kind: "pi-folder" | "pi-file" | "opencode-db" | "claude-projects";
  displayPath: string;
  sourceToken: string;
};
type BrowseEntry = { name: string; path: string; kind: "folder" | "pi-file" | "opencode-db" };
type BrowseResult = {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  truncated: boolean;
};

/**
 * Choose a server-side history source. The path field works on every bind;
 * the folder browser works only when the server listens on loopback, and the
 * server refuses it otherwise. No file is ever uploaded from the browser.
 */
export function ImportSourcePicker(props: {
  host: WebHost;
  onChoose: (source: ChosenSource | null) => void;
}) {
  const s = useSettingsText();
  const [path, setPath] = useState("");
  const [chosen, setChosen] = useState<ChosenSource | null>(null);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [browseOff, setBrowseOff] = useState(false);
  const [error, setError] = useState("");
  const button = "rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50";

  async function choose(target: string) {
    try {
      const source = await settingsRequest<ChosenSource>("/api/settings/imports/sources/validate", {
        method: "POST",
        body: JSON.stringify({ host: props.host, path: target }),
      });
      setChosen(source);
      setPath(source.displayPath);
      props.onChoose(source);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function open(target?: string) {
    try {
      const result = await settingsRequest<BrowseResult>("/api/settings/imports/sources/browse", {
        method: "POST",
        body: JSON.stringify({ host: props.host, ...(target ? { path: target } : {}) }),
      });
      setBrowse(result);
      setError("");
    } catch (cause) {
      const message = (cause as Error).message;
      if (/loopback/i.test(message)) setBrowseOff(true);
      setError(message);
    }
  }

  function reset() {
    setChosen(null);
    setPath("");
    setBrowse(null);
    props.onChoose(null);
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        {props.host === "pi"
          ? s("Pi sessions folder or one .jsonl session file")
          : props.host === "claude-code"
            ? s("Claude Code transcripts folder")
            : s("OpenCode database file")}
        <input
          className="mt-1 block w-full rounded border border-border bg-background p-2 font-mono"
          value={path}
          placeholder={s("Absolute path, for example on a mounted volume")}
          onChange={(event) => setPath(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={!path.trim()}
          onClick={() => void choose(path.trim())}
        >
          {s("Use this source")}
        </button>
        {!browseOff && (
          <button type="button" className={button} onClick={() => void open(browse?.path)}>
            {s("Browse")}
          </button>
        )}
        {chosen && (
          <button type="button" className={button} onClick={reset}>
            {s("Use the default location")}
          </button>
        )}
      </div>
      {chosen && (
        <p role="status">
          {s("Chosen source")}: <span className="font-mono">{chosen.displayPath}</span>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {browse && (
        <div className="rounded border border-border p-2">
          <p className="font-mono text-xs break-all">{browse.path}</p>
          <ul className="max-h-60 overflow-auto">
            {browse.parent && (
              <li>
                <button
                  type="button"
                  className="underline"
                  onClick={() => void open(browse.parent!)}
                >
                  ..
                </button>
              </li>
            )}
            {browse.entries.map((entry) => (
              <li key={entry.path} className="flex items-center gap-2">
                {entry.kind === "folder" ? (
                  <button type="button" className="underline" onClick={() => void open(entry.path)}>
                    {entry.name}/
                  </button>
                ) : (
                  <span className="font-mono text-xs">{entry.name}</span>
                )}
                {/* Pi and Claude Code read a folder; OpenCode reads one database file. */}
                {(entry.kind !== "folder" || props.host !== "opencode") && (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => void choose(entry.path)}
                  >
                    {s("Choose")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {browse.truncated && (
            <p className="text-xs">{s("Only the first 500 entries are shown.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
