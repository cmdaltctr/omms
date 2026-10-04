import * as React from "react";
import { cn } from "$lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input file:text-foreground placeholder:text-muted-foreground selection:bg-selection selection:text-foreground flex h-9 w-full min-w-0 rounded-[10px] border bg-card px-2.5 py-1 text-ui transition-colors duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:ring-destructive aria-invalid:ring-1 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
