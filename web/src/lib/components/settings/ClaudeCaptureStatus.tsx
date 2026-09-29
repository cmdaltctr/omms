import { hostLabel } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";

/** `effective["claude-code"]` from `/api/settings`. */
export type ClaudeCaptureState = { ready: boolean; mode?: string; issues?: string[] };

/**
 * Claude Code capture status. Claude Code has no host model setting: capture
 * and profile learning use the external API, and are off until it is complete.
 */
export function ClaudeCaptureStatus({ status }: { status?: ClaudeCaptureState }) {
  const s = useSettingsText();
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <h3 className="font-medium">{hostLabel("claude-code")}</h3>
      {status?.ready === true && (
        <p className="text-xs text-muted-foreground">
          {s("Claude Code capture uses the external API.")}
        </p>
      )}
      {status?.ready === false && (
        <div role="alert" className="space-y-1 text-xs">
          <p className="text-amber-600">
            {s("Claude Code capture is off. Complete the external API settings.")}
          </p>
          {(status.issues ?? []).length > 0 && (
            <p>
              {s("Missing settings")}: {(status.issues ?? []).map((issue) => s(issue)).join("; ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
