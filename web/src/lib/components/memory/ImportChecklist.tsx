import { Check, CircleDashed, Loader, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { hostLabel } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES } from "$lib/router";
import { fill } from "$lib/skills-model";
import { cn } from "$lib/utils";
import { statusText } from "./host-status";
import type { CheckRow } from "./import-checks";
import type { ModelLine } from "./import-model-blocker";

const EXTERNAL_SETTINGS = `${ROUTES.settings}#settings-section-external-api`;
const LABEL: Record<CheckRow["id"], string> = {
  model: "Model",
  memories: "Memories saving",
  history: "History found",
  profile: "Profile",
};
const ICON = { pass: Check, fail: X, untested: CircleDashed, unknown: Loader } as const;

/**
 * The three checks above the import button, in words as well as colour. A failed
 * row says what to do and offers the link or button that does it.
 */
export function ImportChecklist({
  rows,
  testFailed,
  onRecheck,
}: {
  rows: CheckRow[];
  /** The model test failed on this page; a new test needs a page reload. */
  testFailed: boolean;
  onRecheck: () => void;
}) {
  const s = useSettingsText();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{s("Before you import")}</h3>
      <ul className="space-y-1 text-sm">
        {rows.map((row) => {
          const Icon = ICON[row.state];
          const text = statusText(s, row.text);
          return (
            <li key={row.id} className="flex min-w-0 items-start gap-2">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  row.state === "fail" && "text-destructive-label",
                  row.state === "pass" && "text-status-success",
                  row.state === "unknown" && "animate-spin text-muted-foreground",
                  row.state === "untested" && "text-muted-foreground"
                )}
              />
              <div className="min-w-0 space-y-1 break-words">
                <p role={row.state === "fail" ? "alert" : undefined}>
                  <span className="font-medium">{s(LABEL[row.id])}</span>:{" "}
                  {row.host ? `${hostLabel(row.host)}: ${text}` : text}
                  {row.note && <> {statusText(s, row.note)}</>}
                </p>
                {row.detail && (
                  <p className="text-xs text-muted-foreground">
                    {fill(s("Error code: {code}"), { code: row.detail })}
                  </p>
                )}
                {row.id === "model" && row.state === "fail" && testFailed && (
                  <p className="text-xs text-muted-foreground">
                    {s("Fix the settings, then reload this page to test the model again.")}
                  </p>
                )}
                {row.state === "fail" && row.action?.kind === "external-settings" && (
                  <a
                    className="text-xs underline"
                    href={EXTERNAL_SETTINGS}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(EXTERNAL_SETTINGS);
                    }}
                  >
                    {statusText(s, row.action.label)}
                  </a>
                )}
                {row.state === "fail" && row.action?.kind === "recheck" && (
                  <Button type="button" variant="outline" size="xs" onClick={onRecheck}>
                    {statusText(s, row.action.label)}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One line that names the import model, with Change, and a note per host whose automatic import differs. */
export function ImportModelLine({ line, onChange }: { line: ModelLine; onChange: () => void }) {
  const s = useSettingsText();
  if (line.models.length === 0) return null;
  const models = line.models.map((entry) => statusText(s, entry)).join(", ");
  return (
    <div className="space-y-1 text-sm">
      <p className="break-words">
        {s("Model: {model}").replace("{model}", models)} ·{" "}
        <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onChange}>
          {s("Change")}
        </Button>
      </p>
      {line.notes.map((note, index) => (
        <p key={index} className="break-words text-xs text-muted-foreground">
          {statusText(s, note)}
        </p>
      ))}
    </div>
  );
}
