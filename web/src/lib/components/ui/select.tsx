import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "$lib/utils";

type OptionItem = { value: string; label: React.ReactNode; disabled: boolean };

type SelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type SelectProps = {
  id?: string;
  className?: string;
  value: string | number;
  onChange: (event: SelectChangeEvent) => void;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  children: React.ReactNode;
};

/** Collect `<option>` children, including ones nested in arrays and fragments. */
function collectOptions(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
    if (child.type === React.Fragment) {
      items.push(...collectOptions(child.props.children));
      return;
    }
    if (child.type !== "option") return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    items.push({
      value: String(props.value ?? ""),
      label: props.children,
      disabled: Boolean(props.disabled),
    });
  });
  return items;
}

/**
 * A styled replacement for the native `<select>`. It takes the same `value`,
 * `onChange` and `<option>` children, so call sites only swap the tag name.
 */
export function Select({
  id,
  className,
  value,
  onChange,
  required,
  disabled,
  "aria-label": ariaLabel,
  children,
}: SelectProps) {
  const options = collectOptions(children);
  const current = String(value);
  const selected = options.find((option) => option.value === current);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const container = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Lock each wheel or trackpad gesture to its main axis so the list never scrolls diagonally.
  React.useEffect(() => {
    const node = list.current;
    if (!open || !node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) node.scrollLeft += event.deltaX;
      else node.scrollTop += event.shiftKey && !event.deltaX ? 0 : event.deltaY;
      if (event.shiftKey && !event.deltaX) node.scrollLeft += event.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === current)
      )
    );
    setOpen(true);
  };

  const choose = (option: OptionItem) => {
    if (option.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (option.value !== current) {
      onChange({ target: { value: option.value }, currentTarget: { value: option.value } });
    }
  };

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) {
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => move(index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => move(index, -1));
        break;
      case "Home":
        event.preventDefault();
        setActive(move(-1, 1));
        break;
      case "End":
        event.preventDefault();
        setActive(move(options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (options[active]) choose(options[active]);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div
      ref={container}
      className={cn("relative min-w-0 max-w-full", className?.includes("w-full") && "w-full")}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-9 max-w-full items-center justify-between gap-2 rounded-[10px] border border-input bg-card px-2.5 text-ui text-foreground text-start transition-colors duration-150 hover:bg-interactive-hover focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className,
          "flex h-9 rounded-[10px] border-input bg-card text-ui"
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute start-0 top-full z-20 mt-1 max-h-64 w-max min-w-full max-w-[min(40rem,calc(100vw-2rem))] overflow-auto overscroll-contain rounded-[10px] border border-input bg-card p-1 shadow-sm"
        >
          {options.map((option, index) => (
            <li
              key={`${option.value}-${index}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === current}
              aria-disabled={option.disabled || undefined}
              onPointerMove={() => !option.disabled && setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={cn(
                "flex w-max min-w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-card-foreground transition-colors",
                index === active && "bg-selection text-foreground",
                option.value === current && "font-medium",
                option.disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <span
                className="shrink-0"
                title={typeof option.label === "string" ? option.label : undefined}
              >
                {option.label}
              </span>
              {option.value === current ? (
                <Check className="size-3.5 shrink-0 text-primary" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
