import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import type { ImportDraft } from "./import-types";

export const importField =
  "mt-1 block w-full min-w-0 rounded border border-border bg-background p-2";
export const importButton = "rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50";

export function ImportOptions({
  draft,
  advanced,
  onChange,
  onAdvanced,
}: {
  draft: ImportDraft;
  advanced: boolean;
  onChange: (patch: Partial<ImportDraft>) => void;
  onAdvanced: () => void;
}) {
  const s = useSettingsText();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <input
            type="checkbox"
            aria-label={s("Project memories")}
            checked={draft.memories}
            onChange={(event) => onChange({ memories: event.target.checked })}
          />{" "}
          {s("Project memories")}
        </label>
        <label>
          <input
            type="checkbox"
            aria-label={s("User profile")}
            checked={draft.profile}
            onChange={(event) => onChange({ profile: event.target.checked })}
          />{" "}
          {s("User profile")} {s("(preferences, patterns, and workflows)")}
        </label>
      </div>
      <label className="block text-sm">
        {s("Scope")}
        <Select
          aria-label={s("Scope")}
          className={importField}
          value={draft.scope}
          onChange={(event) => onChange({ scope: event.target.value as ImportDraft["scope"] })}
        >
          <option value="current-project">{s("Current project")}</option>
          <option value="all-projects">{s("All projects")}</option>
        </Select>
      </label>
      <button type="button" className={importButton} onClick={onAdvanced} aria-expanded={advanced}>
        {s(advanced ? "Hide advanced options" : "Advanced options")}
      </button>
      <div hidden={!advanced} className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.scope === "current-project" && (
            <label className="text-sm">
              {s("Project directory")}
              <input
                aria-label={s("Project directory")}
                className={importField}
                dir="ltr"
                value={draft.project}
                placeholder={s("Current directory")}
                onChange={(event) => onChange({ project: event.target.value })}
              />
            </label>
          )}
          {(
            [
              ["Prompt date from", "since"],
              ["Prompt date to", "until"],
              ["Profile batch size", "profileBatch"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="text-sm">
              {s(label)}
              <input
                aria-label={s(label)}
                type={key === "profileBatch" ? "text" : "date"}
                inputMode={key === "profileBatch" ? "numeric" : undefined}
                className={importField}
                value={draft[key]}
                onChange={(event) => onChange({ [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {s(
            "Prompt dates are inclusive, use your time zone, and filter the turns inside each session, not the list. Empty dates include every turn."
          )}
        </p>
        <label className="block text-sm">
          {s("Directory maps (old=new, one per line)")}
          <textarea
            aria-label={s("Directory maps (old=new, one per line)")}
            dir="ltr"
            className={importField}
            rows={2}
            value={draft.maps}
            onChange={(event) => onChange({ maps: event.target.value })}
          />
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            aria-label={s("Re-analyse handled history")}
            checked={draft.force}
            onChange={(event) => onChange({ force: event.target.checked })}
          />{" "}
          {s("Re-analyse handled history")}
        </label>
        <p className="text-xs text-muted-foreground">
          {s(
            "Re-analysis applies to the selected outputs. Each profile prompt can be forcibly re-analysed once. Findings merge into the existing profile."
          )}
        </p>
      </div>
    </div>
  );
}
