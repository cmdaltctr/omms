import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";

let refCursor = 0;
let refs: { current: unknown }[] = [];

mock.module("react", () => ({
  ...react,
  useRef: (value: unknown) => {
    const index = refCursor++;
    refs[index] ??= { current: value };
    return refs[index];
  },
}));
mock.module("../src/lib/i18n/index.ts", () => ({
  useI18n: () => ({
    language: "en",
    t: (key: string) => key,
  }),
}));

const { DialogContent } = await import("../src/lib/components/ui/dialog.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
type FocusEvent = { defaultPrevented: boolean; preventDefault: () => void };

class FakeHTMLElement {
  isConnected = true;
  focusCount = 0;

  focus() {
    this.focusCount++;
    (document as unknown as { activeElement: unknown }).activeElement = this;
  }
}

function event(): FocusEvent {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function content(props: Record<string, unknown> = {}) {
  refCursor = 0;
  const tree = DialogContent({ children: null, ...props });
  const children = (tree as Node).props.children as ReactNode[];
  return children[1] as Node;
}

function open(contentNode: Node, openEvent = event()) {
  (contentNode.props.onOpenAutoFocus as ((value: FocusEvent) => void) | undefined)?.(openEvent);
  return openEvent;
}

function close(contentNode: Node, closeEvent = event()) {
  (contentNode.props.onCloseAutoFocus as ((value: FocusEvent) => void) | undefined)?.(closeEvent);
  return closeEvent;
}

function expectFocusCallbacks(contentNode: Node) {
  expect(contentNode.props.onOpenAutoFocus).toBeTypeOf("function");
  expect(contentNode.props.onCloseAutoFocus).toBeTypeOf("function");
}

beforeEach(() => {
  refCursor = 0;
  refs = [];
  Object.assign(globalThis, {
    HTMLElement: FakeHTMLElement,
    document: { activeElement: null },
  });
});

it("restores the connected opener after a controlled dialog closes", () => {
  const opener = new FakeHTMLElement();
  (document as unknown as { activeElement: unknown }).activeElement = opener;
  const rendered = content();

  expectFocusCallbacks(rendered);
  open(rendered);
  const closeEvent = close(rendered);

  expect(closeEvent.defaultPrevented).toBe(true);
  expect(opener.focusCount).toBe(1);
  expect(document.activeElement).toBe(opener);
});

it("captures the opener before an open-focus handler changes focus", () => {
  const opener = new FakeHTMLElement();
  const changedFocus = new FakeHTMLElement();
  (document as unknown as { activeElement: unknown }).activeElement = opener;
  const onOpenAutoFocus = mock(() => {
    (document as unknown as { activeElement: unknown }).activeElement = changedFocus;
  });
  const rendered = content({ onOpenAutoFocus });

  expectFocusCallbacks(rendered);
  const openEvent = open(rendered);
  close(rendered);

  expect(onOpenAutoFocus).toHaveBeenCalledWith(openEvent);
  expect(opener.focusCount).toBe(1);
  expect(changedFocus.focusCount).toBe(0);
});

it("keeps the captured opener across a re-render caused by language or props changes", () => {
  const opener = new FakeHTMLElement();
  (document as unknown as { activeElement: unknown }).activeElement = opener;

  const initial = content({ className: "english" });
  expectFocusCallbacks(initial);
  open(initial);
  (document as unknown as { activeElement: unknown }).activeElement = new FakeHTMLElement();
  const rerendered = content({ className: "arabic", dir: "rtl" });
  expectFocusCallbacks(rerendered);
  const closeEvent = close(rerendered);

  expect(closeEvent.defaultPrevented).toBe(true);
  expect(opener.focusCount).toBe(1);
});

it("respects a consumer close-focus handler that prevents default", () => {
  const opener = new FakeHTMLElement();
  (document as unknown as { activeElement: unknown }).activeElement = opener;
  const onCloseAutoFocus = mock((closeEvent: FocusEvent) => closeEvent.preventDefault());
  const rendered = content({ onCloseAutoFocus });

  expectFocusCallbacks(rendered);
  open(rendered);
  const closeEvent = close(rendered);

  expect(onCloseAutoFocus).toHaveBeenCalledWith(closeEvent);
  expect(closeEvent.defaultPrevented).toBe(true);
  expect(opener.focusCount).toBe(0);
});

it("leaves the default close behaviour untouched when the opener disconnected", () => {
  const opener = new FakeHTMLElement();
  opener.isConnected = false;
  (document as unknown as { activeElement: unknown }).activeElement = opener;
  const rendered = content();

  expectFocusCallbacks(rendered);
  open(rendered);
  const closeEvent = close(rendered);

  expect(closeEvent.defaultPrevented).toBe(false);
  expect(opener.focusCount).toBe(0);
});

it("safely ignores an absent or non-HTMLElement active element", () => {
  const absent = content();
  expectFocusCallbacks(absent);
  open(absent);
  expect(() => close(absent)).not.toThrow();
  expect(close(absent).defaultPrevented).toBe(false);

  const nonElement = { isConnected: true, focus: mock(() => {}) };
  (document as unknown as { activeElement: unknown }).activeElement = nonElement;
  const rendered = content();
  expectFocusCallbacks(rendered);
  open(rendered);
  const closeEvent = close(rendered);

  expect(closeEvent.defaultPrevented).toBe(false);
  expect(nonElement.focus).not.toHaveBeenCalled();
});
