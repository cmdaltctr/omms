import { useState } from "react";
import { FolderPlus, RotateCcw, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { useSettingsText } from "$lib/i18n/settings";
import type { FolderRow } from "$lib/skills-api";
import { fill, withFolder, withoutFolder } from "$lib/skills-model";
import { useSkillSettings } from "./use-skill-settings";

/** The watched folders. Every change saves `skillFolders` through the Settings save flow. */
export function SkillFolders({
  folders,
  onChanged,
}: {
  folders: FolderRow[];
  onChanged: () => void;
}) {
  const s = useSettingsText();
  const { snapshot, busy, save } = useSkillSettings();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const paths = folders.map((folder) => folder.path);
  // Reset needs the key in the file; without it the default folders already apply.
  const canReset = snapshot?.settings.skillFolders?.source === "global";

  async function apply(next: string[] | null) {
    setError("");
    const failure = await save({ skillFolders: next });
    if (failure) setError(failure);
    else {
      setPath("");
      onChanged();
    }
  }

  return (
    <section className="space-y-3" aria-label={s("Watched folders")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title font-semibold">{s("Watched folders")}</h2>
        {canReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void apply(null)}
          >
            <RotateCcw aria-hidden="true" />
            {s("Reset default")}
          </Button>
        ) : null}
      </div>
      {folders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s("No folders are watched.")}</p>
      ) : (
        <ul className="space-y-3">
          {folders.map((folder) => (
            <li
              key={folder.path}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="break-all font-mono text-xs text-start">
                  {folder.path}
                </p>
                <p className="text-xs text-muted-foreground">
                  {folder.exists
                    ? fill(s(folder.skills === 1 ? "{count} skill" : "{count} skills"), {
                        count: folder.skills,
                      })
                    : s("Folder not found")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={fill(s("Remove folder {path}"), { path: folder.path })}
                title={s("Remove folder")}
                onClick={() => void apply(withoutFolder(paths, folder.path))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (path.trim()) void apply(withFolder(paths, path));
        }}
      >
        <Input
          dir="ltr"
          className="max-w-md flex-1 basis-60"
          value={path}
          placeholder="~/.agents/skills"
          aria-label={s("Folder path")}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !path.trim()}>
          <FolderPlus aria-hidden="true" />
          {s("Add folder")}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}
    </section>
  );
}
