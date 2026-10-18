import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { useWriteHealth } from "$lib/write-health-store";

/** The warning itself: what failed, what to do, and Check again. */
export function WriteHealthNotice({
  reason,
  checking,
  onCheck,
}: {
  reason: string | null;
  checking: boolean;
  onCheck: () => void;
}) {
  const s = useSettingsText();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--status-warning)] bg-card p-3 text-sm"
    >
      <TriangleAlert className="size-4 shrink-0 text-status-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium">{s("Memories are not being saved.")}</span>{" "}
        {reason ? (/[.!?]$/.test(reason) ? reason : `${reason}.`) : ""}{" "}
        {s("Fix the service named here, then press Check again.")}
      </p>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={onCheck}>
        {s("Check again")}
      </Button>
    </div>
  );
}

/** Shown above a host view while new memories cannot be saved. */
export function WriteHealthStrip() {
  const { health, recheck } = useWriteHealth();
  const [checking, setChecking] = useState(false);
  if (!health || health.ok) return null;
  return (
    <WriteHealthNotice
      reason={health.reason}
      checking={checking}
      onCheck={() => {
        setChecking(true);
        void recheck().finally(() => setChecking(false));
      }}
    />
  );
}
