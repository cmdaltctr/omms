import { useWebStatus } from "$lib/web-status";
import { cn } from "$lib/utils";

/** The product name in the brand colour, then the running version once the status answers. */
export function SidebarBrand({ brand, className }: { brand: string; className?: string }) {
  const { status } = useWebStatus();
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1.5", className)}>
      <span className="truncate text-ui font-medium tracking-wide text-brand-label">{brand}</span>
      {status ? (
        <span className="shrink-0 text-xs text-foreground" data-testid="sidebar-version">
          v{status.version}
        </span>
      ) : null}
    </span>
  );
}
