import * as React from "react";
import { cn } from "$lib/utils";

const EDGE_GAP = 8;

/**
 * A small styled tooltip shown on hover or keyboard focus of its child. It sits centred
 * on one line above the child, and slides sideways when it would leave the viewport.
 */
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
  const tip = React.useRef<HTMLSpanElement>(null);
  const [shift, setShift] = React.useState(0);
  const child = React.isValidElement<{ "aria-describedby"?: string }>(children)
    ? React.cloneElement(children, { "aria-describedby": id })
    : children;

  // Measure from the centred position, then push the bubble back inside the viewport.
  const place = () => {
    const node = tip.current;
    if (!node) return;
    const anchor = node.parentElement!.getBoundingClientRect();
    const half = node.offsetWidth / 2;
    const centre = anchor.left + anchor.width / 2;
    const viewport = document.documentElement.clientWidth;
    const minCentre = EDGE_GAP + half;
    const maxCentre = viewport - EDGE_GAP - half;
    setShift(Math.min(Math.max(centre, minCentre), maxCentre) - centre);
  };

  return (
    <span
      className={cn("group/tooltip relative inline-flex", className)}
      onPointerEnter={place}
      onFocus={place}
    >
      {child}
      <span
        ref={tip}
        id={id}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[min(24rem,calc(100vw-1rem))] rounded-md border border-border bg-card px-2 py-1 text-xs whitespace-normal text-card-foreground opacity-0 shadow-sm transition-opacity duration-150 ease-in group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100"
      >
        {content}
        <span
          aria-hidden="true"
          style={{ left: `calc(50% - ${shift}px)` }}
          className="absolute top-full -mt-1 size-2 -translate-x-1/2 rotate-45 border-e border-b border-border bg-card"
        />
      </span>
    </span>
  );
}
