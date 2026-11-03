import { expect, it } from "bun:test";
import { nextFocusMode } from "../src/lib/focus-mode";

// The strong outline helps someone who moves with Tab or a screen reader. A person who is
// typing in a box needs only a gentle one. Text fields always match :focus-visible, so CSS
// alone cannot tell the two apart. The page records how the last input arrived.

it("uses the strong outline after Tab and Shift+Tab", () => {
  expect(nextFocusMode("typing", { type: "keydown", key: "Tab", inTextField: false })).toBe(
    "keyboard"
  );
  expect(nextFocusMode("typing", { type: "keydown", key: "Tab", inTextField: true })).toBe(
    "keyboard"
  );
});

it("switches to the gentle outline once the person types in a text field", () => {
  expect(nextFocusMode("keyboard", { type: "keydown", key: "a", inTextField: true })).toBe(
    "typing"
  );
  expect(nextFocusMode("keyboard", { type: "keydown", key: "Backspace", inTextField: true })).toBe(
    "typing"
  );
});

it("uses the gentle outline when the person clicks or taps", () => {
  expect(nextFocusMode("keyboard", { type: "pointerdown", inTextField: false })).toBe("typing");
});

it("keeps the strong outline for keys that move between controls", () => {
  expect(nextFocusMode("keyboard", { type: "keydown", key: "ArrowDown", inTextField: false })).toBe(
    "keyboard"
  );
  expect(nextFocusMode("keyboard", { type: "keydown", key: "Enter", inTextField: false })).toBe(
    "keyboard"
  );
});

it("ignores a modifier key pressed on its own", () => {
  for (const key of ["Shift", "Control", "Alt", "Meta"]) {
    expect(nextFocusMode("keyboard", { type: "keydown", key, inTextField: true })).toBe("keyboard");
  }
});

it("keeps the current mode for events it does not know", () => {
  expect(nextFocusMode("typing", { type: "keyup", key: "a", inTextField: true })).toBe("typing");
});
