import type { LucideIcon } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Tooltip } from "$lib/components/ui/tooltip";

/**
 * One action of a space card. The tooltip shows the action name, or the reason when the server
 * blocks the action. A disabled button gets no hover and no focus, so a blocked button sits in a
 * focusable span that holds the tooltip. An sr-only line carries the reason, and the button
 * points at it with aria-describedby.
 */
export function SpaceActionButton({
  label,
  reason,
  reasonId,
  busy,
  icon: Icon,
  iconOnly = false,
  variant,
  onClick,
}: {
  label: string;
  /** Why the server blocks this action, in words. Absent when the action is allowed. */
  reason?: string;
  reasonId: string;
  /** Another action is running, so every button waits. */
  busy: boolean;
  icon: LucideIcon;
  /** An icon-only button has the label as its accessible name and its tooltip. */
  iconOnly?: boolean;
  variant?: "outline" | "destructive";
  onClick: () => void;
}) {
  const blocked = reason !== undefined;
  const button = (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon-sm" : "sm"}
      aria-label={iconOnly ? label : undefined}
      aria-describedby={blocked ? reasonId : undefined}
      disabled={busy || blocked}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      {iconOnly ? null : label}
    </Button>
  );
  // A text button names itself, so only an icon-only button needs a tooltip while it is allowed.
  if (!blocked) return iconOnly ? <Tooltip content={label}>{button}</Tooltip> : button;
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        className="inline-flex rounded-[9px] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {button}
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      </span>
    </Tooltip>
  );
}
