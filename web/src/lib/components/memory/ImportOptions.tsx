import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { compactField, Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES } from "$lib/router";
import type { ImportDraft } from "./import-types";

const SKILL_CARD = `${ROUTES.settings}#settings-section-skill-learning`;
export const importField =
  "mt-1 block w-full min-w-0 rounded border border-border bg-background p-2";

export function ImportOptions({
  draft,
  skillRecording,
  advanced,
  onChange,
  onAdvanced,
}: {
  draft: ImportDraft;
  /** Whether Record agent turns is on; skill turns can be imported only then. */
  skillRecording: boolean;
  advanced: boolean;
  onChange: (patch: Partial<ImportDraft>) => void;
  onAdvanced: () => void;
}) {
  const s = useSettingsText();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <Label className="w-auto">
          <Checkbox
            aria-label={s("Project memories")}
            checked={draft.memories}
            onCheckedChange={(checked) => onChange({ memories: checked === true })}
          />
          {s("Project memories")}
        </Label>
        <Label className="w-auto">
          <Checkbox
            aria-label={s("User profile")}
            checked={draft.profile}
            onCheckedChange={(checked) => onChange({ profile: checked === true })}
          />
          {s("User profile")} {s("(preferences, patterns, and workflows)")}
        </Label>
        <Label className="w-auto">
          <Checkbox
            aria-label={s("Skill turns")}
            checked={skillRecording && draft.skills}
            disabled={!skillRecording}
            onCheckedChange={(checked) => onChange({ skills: checked === true })}
          />
          {s("Skill turns")}
        </Label>
      </div>
      {!skillRecording && (
        <p className="text-xs text-muted-foreground">
          {s("Skill turns are recorded only while Record agent turns is on.")}{" "}
          <a
            className="underline"
            href={SKILL_CARD}
            onClick={(event) => {
              event.preventDefault();
              navigate(SKILL_CARD);
            }}
          >
            {s("Open the Skill learning card")}
          </a>
        </p>
      )}
      <label className="block text-sm">
        {s("Scope")}
        {/* Two short options: a compact width, not the whole row. */}
        <div className={compactField}>
          <Select
            aria-label={s("Scope")}
            className={importField}
            value={draft.scope}
            onChange={(event) => onChange({ scope: event.target.value as ImportDraft["scope"] })}
          >
            <option value="current-project">{s("Current project")}</option>
            <option value="all-projects">{s("All projects")}</option>
          </Select>
        </div>
      </label>
      <Label>
        <Checkbox
          aria-label={s("Show handled sessions")}
          checked={draft.showHandled}
          onCheckedChange={(checked) => onChange({ showHandled: checked === true })}
        />
        {s("Show handled sessions")}
      </Label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdvanced}
        aria-expanded={advanced}
      >
        {s(advanced ? "Hide advanced options" : "Advanced options")}
      </Button>
      <div hidden={!advanced} className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.scope === "current-project" && (
            <Label className="flex-col items-stretch gap-1">
              {s("Project directory")}
              <Input
                aria-label={s("Project directory")}
                dir="ltr"
                value={draft.project}
                placeholder={s("Current directory")}
                onChange={(event) => onChange({ project: event.target.value })}
              />
            </Label>
          )}
          {(
            [
              ["Prompt date from", "since"],
              ["Prompt date to", "until"],
              ["Profile batch size", "profileBatch"],
            ] as const
          ).map(([label, key]) => (
            <Label key={key} className="flex-col items-stretch gap-1">
              {s(label)}
              <Input
                aria-label={s(label)}
                type={key === "profileBatch" ? "text" : "date"}
                inputMode={key === "profileBatch" ? "numeric" : undefined}
                value={draft[key]}
                onChange={(event) => onChange({ [key]: event.target.value })}
              />
            </Label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {s(
            "Prompt dates are inclusive, use your time zone, and filter the turns inside each session, not the list. Empty dates include every turn."
          )}
        </p>
        <Label>
          <Checkbox
            aria-label={s("Re-analyse handled history")}
            checked={draft.force}
            onCheckedChange={(checked) => onChange({ force: checked === true })}
          />
          {s("Re-analyse handled history")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {s(
            "Re-analysis applies to the selected outputs. Each profile prompt can be forcibly re-analysed once. Findings merge into the existing profile."
          )}
        </p>
      </div>
    </div>
  );
}
