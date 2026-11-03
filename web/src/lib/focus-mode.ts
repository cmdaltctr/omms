/**
 * How the last input arrived, so a text field can show the right outline.
 *
 * "keyboard": the person moves with Tab or a screen reader. The field keeps the strong outline.
 * "typing": the person clicked into the field or started to type. The field shows a gentle one.
 *
 * Text fields always match :focus-visible, so CSS alone cannot tell the two cases apart.
 * The mode lives on <html data-focus-mode>, and app.css reads it.
 */
export type FocusMode = "keyboard" | "typing";

export type FocusInput = {
  type: string;
  key?: string;
  /** True when the event target is an input or textarea. */
  inTextField: boolean;
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function nextFocusMode(current: FocusMode, input: FocusInput): FocusMode {
  if (input.type === "pointerdown") return "typing";
  if (input.type !== "keydown" || !input.key) return current;
  if (input.key === "Tab") return "keyboard";
  if (MODIFIER_KEYS.has(input.key)) return current;
  return input.inTextField ? "typing" : current;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Start tracking. Returns a function that stops it. */
export function initFocusMode(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  let mode: FocusMode = "keyboard";
  root.dataset.focusMode = mode;

  const update = (event: Event) => {
    const next = nextFocusMode(mode, {
      type: event.type,
      key: event instanceof KeyboardEvent ? event.key : undefined,
      inTextField: isTextField(event.target),
    });
    if (next === mode) return;
    mode = next;
    root.dataset.focusMode = mode;
  };

  document.addEventListener("keydown", update, true);
  document.addEventListener("pointerdown", update, true);
  return () => {
    document.removeEventListener("keydown", update, true);
    document.removeEventListener("pointerdown", update, true);
  };
}
