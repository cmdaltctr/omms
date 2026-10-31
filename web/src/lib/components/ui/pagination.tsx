import * as React from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { buttonVariants, type Button } from "$lib/components/ui/button";
import { cn } from "$lib/utils";

/*
 * shadcn/ui pagination (new-york), adapted for client-side paging: page
 * items are buttons, not links, and every visible label comes from the
 * caller so it can be translated.
 */

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row flex-wrap items-center justify-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationButtonProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"button">;

/** A page number, or Previous and Next. A disabled one leaves the tab order. */
function PaginationButton({
  className,
  isActive,
  size = "icon-sm",
  disabled,
  ...props
}: PaginationButtonProps) {
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      data-slot="pagination-button"
      data-active={isActive}
      className={cn(
        buttonVariants({ variant: isActive ? "outline" : "ghost", size }),
        "tabular-nums",
        isActive && "border-primary/40 bg-selection",
        className
      )}
      {...props}
    />
  );
}

/** The gap between page numbers. `label` is read by screen readers only. */
function PaginationEllipsis({
  className,
  label,
  ...props
}: React.ComponentProps<"span"> & { label: string }) {
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn("flex size-8 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export { Pagination, PaginationButton, PaginationContent, PaginationEllipsis, PaginationItem };
