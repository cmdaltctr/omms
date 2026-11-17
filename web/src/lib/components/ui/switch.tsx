import * as React from "react";
import { cn } from "$lib/utils";

type SwitchProps = Omit<React.ComponentProps<"button">, "onClick" | "role" | "type"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * An on/off switch. It is a native button, so Space and Enter work and a
 * wrapping `<label>` can toggle it. It holds no state: the caller owns `checked`.
 * The thumb mirrors in right-to-left layouts.
 */
function Switch({ className, checked, onCheckedChange, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "border-input bg-muted data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors duration-150 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        aria-hidden="true"
        className="pointer-events-none block size-3.5 rounded-full bg-card shadow-sm ring-1 ring-border transition-transform duration-150 data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4"
        data-state={checked ? "checked" : "unchecked"}
      />
    </button>
  );
}

export { Switch };
