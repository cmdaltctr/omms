import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "$lib/utils";

const EDGE_GAP = 8;

/**
 * An "i" button that opens a short explanation below it on click. Escape or a click outside
 * closes it. The panel sits centred under the button and slides sideways when it would leave
 * the viewport, as the tooltip does.
 */
export function InfoPopover({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  const root = React.useRef<HTMLSpanElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [shift, setShift] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Measure from the centred position, then push the panel back inside the viewport.
  React.useLayoutEffect(() => {
    const node = panel.current;
    const anchor = root.current;
    if (!open || !node || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const half = node.offsetWidth / 2;
    const centre = rect.left + rect.width / 2;
    const viewport = document.documentElement.clientWidth;
    const clamped = Math.min(Math.max(centre, EDGE_GAP + half), viewport - EDGE_GAP - half);
    setShift(clamped - centre);
  }, [open]);

  return (
    <span ref={root} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 outline-none hover:bg-interactive-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-selection aria-expanded:text-foreground"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
          className="absolute top-full left-1/2 z-30 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-card p-3 text-start text-xs whitespace-normal text-card-foreground shadow-sm"
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
