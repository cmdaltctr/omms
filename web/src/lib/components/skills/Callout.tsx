import type { ReactNode } from "react";
import { Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "$lib/utils";

const TONES = {
  info: {
    box: "border-status-info/25 bg-status-info/10",
    icon: "text-status-info",
    Icon: Info,
  },
  warning: {
    box: "border-status-warning/25 bg-status-warning/10",
    icon: "text-status-warning",
    Icon: TriangleAlert,
  },
  danger: {
    box: "border-destructive/25 bg-destructive/10",
    icon: "text-destructive-label",
    Icon: OctagonAlert,
  },
} as const;

/**
 * A short notice with a tone. Danger announces itself as an alert; info and
 * warning are notes the reader finds in place.
 */
export function Callout({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      data-tone={tone}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-start text-sm",
        box,
        className
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden="true" />
      <div className="min-w-0 space-y-1.5 text-foreground">{children}</div>
    </div>
  );
}
