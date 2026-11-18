import { useWebStatus } from "$lib/web-status";
import { cn } from "$lib/utils";

/** The product name at the section-title size, then the running version once the status answers. */
export function SidebarBrand({ brand, className }: { brand: string; className?: string }) {
  const { status } = useWebStatus();
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="truncate text-section-title font-semibold">{brand}</span>
      {status ? (
        <span
          className="shrink-0 truncate text-[0.8125rem] text-muted-foreground"
          data-testid="sidebar-version"
        >
          v{status.version}
        </span>
      ) : null}
    </span>
  );
}
