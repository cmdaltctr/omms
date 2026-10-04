import * as React from "react";
import { cn } from "$lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      dir="auto"
      className={cn(
        "border-input placeholder:text-muted-foreground selection:bg-selection selection:text-foreground flex field-sizing-content min-h-16 w-full min-w-0 rounded-[10px] border bg-card px-2.5 py-2 text-ui [unicode-bidi:plaintext] transition-colors duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:ring-destructive aria-invalid:ring-1 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
