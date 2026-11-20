import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// Hooks run outside a renderer: useState hands back queued values and records its set calls.
let queuedState: unknown[] = [];
let setCalls: unknown[][] = [];
mock.module("react", () => ({
  ...react,
  useId: () => "tip-0",
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const calls: unknown[] = [];
    setCalls.push(calls);
    return [queuedState.length ? queuedState.shift() : initial, (v: unknown) => calls.push(v)];
  },
}));
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!react.isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

const VIEWPORT = 1280;
const REM = 16;
const NATURAL = 700; // The width of the text on one line, wider than any cap.

/** The px value of one CSS length or a `min(...)` of lengths, as the browser computes it. */
function px(value: string): number {
  const v = value.trim();
  if (v.startsWith("min(")) return Math.min(...splitArgs(v.slice(4, -1)).map(px));
  if (v === "calc(100vw - 1rem)") return VIEWPORT - REM;
  if (v.endsWith("rem")) return Number.parseFloat(v) * REM;
  return Number.parseFloat(v);
}
function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  [...inner].forEach((ch, i) => {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  });
  return [...parts, inner.slice(start)];
}

/** The bubble's width: an inline max-width replaces the stylesheet cap of min(24rem, 100vw - 1rem). */
function widthFor(inline: string | number | undefined): number {
  const cap =
    inline === undefined || inline === ""
      ? px("min(24rem, calc(100vw - 1rem))")
      : typeof inline === "number"
        ? inline
        : px(inline);
  return Math.min(NATURAL, cap);
}

beforeEach(() => {
  queuedState = [];
  setCalls = [];
});

/**
 * Hovers a tooltip whose anchor is centred on `centre`, inside a column from `left` to
 * `right`. Renders again with the state that the hover set, and returns where the bubble ends.
 */
function hover(centre: number, left: number, right: number, style: Record<string, string> = {}) {
  const fake = {
    style,
    parentElement: { getBoundingClientRect: () => ({ left: centre - 10, width: 20 }) },
    closest: () => ({ getBoundingClientRect: () => ({ left, right }) }),
    get offsetWidth() {
      return widthFor(style.maxWidth);
    },
  };
  setCalls = [];
  const first = nodes(Tooltip({ content: "A long tip", children: <span>anchor</span> }));
  const bubble = first.find((n) => n.props.role === "tooltip")!;
  (bubble.props.ref as { current: unknown }).current = fake;
  (first[0]!.props.onPointerEnter as () => void)();
  queuedState = setCalls.map((calls) => calls.at(-1));
  const shift = queuedState[0] as number;
  const again = nodes(Tooltip({ content: "A long tip", children: <span>anchor</span> }));
  const placed = again.find((n) => n.props.role === "tooltip")!;
  const inline = (placed.props.style as { maxWidth?: string | number }).maxWidth;
  const width = widthFor(inline ?? style.maxWidth);
  return { start: centre + shift - width / 2, end: centre + shift + width / 2, width };
}

it("keeps a long tooltip inside its column after the width cap applies", () => {
  // CodeRabbit's case: bounds 0 to 600, centre 550.
  const { start, end, width } = hover(550, 0, 600);
  expect(width).toBe(24 * REM);
  expect(start).toBeGreaterThanOrEqual(8);
  expect(end).toBeLessThanOrEqual(592);
});

it("keeps the 24rem cap in a wide column", () => {
  expect(hover(640, 0, 1280).width).toBe(24 * REM);
});

it("wraps to the column width in a narrow column", () => {
  // A 390px phone: a 310px column leaves 294px after the 8px gap on each side.
  const { start, end, width } = hover(200, 40, 350);
  expect(width).toBe(294);
  expect(start).toBeGreaterThanOrEqual(48);
  expect(end).toBeLessThanOrEqual(342);
});

it("measures with the new cap, not the cap of an earlier hover in a narrower column", () => {
  const style: Record<string, string> = {};
  hover(200, 40, 350, style);
  // The window grew since then, so the column is wider.
  const { end, width } = hover(550, 0, 600, style);
  expect(width).toBe(24 * REM);
  expect(end).toBeLessThanOrEqual(592);
});
