import * as React from "react";
import { cn } from "$lib/utils";

/** A small styled tooltip shown on hover or keyboard focus of its child. */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  const child = React.isValidElement<{ "aria-describedby"?: string }>(children)
    ? React.cloneElement(children, { "aria-describedby": id })
    : children;
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {child}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full end-0 z-30 mb-1.5 w-max max-w-64 rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground opacity-0 shadow-lg transition-opacity duration-150 ease-in group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
