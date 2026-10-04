import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "$lib/utils";

const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-destructive border border-transparent bg-clip-padding text-ui font-medium focus-visible:ring-2 aria-invalid:ring-1 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex max-w-full shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 border-primary/25 text-primary-label hover:bg-primary/16 active:bg-primary/22 dark:bg-primary/16 dark:hover:bg-primary/22 dark:active:bg-primary/30",
        outline:
          "border-input bg-card text-foreground hover:bg-interactive-hover active:bg-interactive-active aria-expanded:bg-selection",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-interactive-hover active:bg-interactive-active aria-expanded:bg-selection",
        ghost:
          "text-foreground hover:bg-interactive-hover active:bg-interactive-active aria-expanded:bg-selection",
        destructive:
          "bg-destructive/10 border-destructive/25 text-destructive-label hover:bg-destructive/16 active:bg-destructive/22 dark:bg-destructive/16 dark:hover:bg-destructive/22 dark:active:bg-destructive/30",
        link: "text-primary-label underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 rounded-[10px] gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "h-6 rounded-[7px] gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-[9px] gap-1 px-3 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        lg: "h-10 rounded-[12px] gap-1.5 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-9 rounded-[10px]",
        "icon-xs": "size-6 rounded-[7px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[9px]",
        "icon-lg": "size-10 rounded-[12px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
