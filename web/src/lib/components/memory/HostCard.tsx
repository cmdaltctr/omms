import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useHostLooks } from "$lib/host-looks";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate } from "$lib/router";
import { memoryPath, type MemoryViewId } from "$lib/routes";
import { cn } from "$lib/utils";
import { AvatarDialog } from "./AvatarDialog";
import { HostAvatar, SharedMark } from "./HostAvatar";

type Props = {
  view: MemoryViewId;
  /** The status line under the name. */
  line: string;
  /** Memories cannot be saved right now; the card turns amber and says why. */
  warning?: string | null;
  notSetUp?: boolean;
  current?: boolean;
  /** Smaller card for the switcher inside a host view. */
  compact?: boolean;
};

/** One card of the overview and the switcher: a link to the view, plus Change icon on hosts. */
export function HostCard({ view, line, warning, notSetUp, current, compact }: Props) {
  const s = useSettingsText();
  const { looks } = useHostLooks();
  const [editing, setEditing] = useState(false);
  const host = view === "shared" ? null : (view as WebHost);
  const name = host ? hostLabel(host) : s("Shared");
  const path = memoryPath(view);
  const avatar: ReactNode = host ? (
    <HostAvatar host={host} look={looks[host]} className={compact ? "size-8" : undefined} />
  ) : (
    <SharedMark className={compact ? "size-8" : undefined} />
  );
  return (
    <div className="relative h-full min-w-0">
      <a
        href={path}
        aria-current={current ? "page" : undefined}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          navigate(path);
        }}
        className={cn(
          "flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-start transition-colors duration-150 hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
          compact && "flex-row items-center gap-2 p-2 pe-10",
          warning ? "border-[var(--status-warning)]" : "border-border",
          current && "bg-sidebar-accent",
          notSetUp && "opacity-70"
        )}
      >
        {avatar}
        <span className="min-w-0 space-y-1">
          <span className="block break-words text-subsection-title font-semibold">{name}</span>
          <span className="block break-words text-xs text-muted-foreground">
            {warning ? (
              <>
                <span className="font-medium text-status-warning">{s("Memories not saved")}</span>
                {!compact && <span className="block">{warning}</span>}
              </>
            ) : (
              line
            )}
          </span>
        </span>
      </a>
      {host && (
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-xs" : "icon-sm"}
          className="absolute end-2 top-2"
          aria-label={`${s("Change icon")}: ${name}`}
          title={s("Change icon")}
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
      {editing && host && <AvatarDialog host={host} onClose={() => setEditing(false)} />}
    </div>
  );
}
