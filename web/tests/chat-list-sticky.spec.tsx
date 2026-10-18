import { expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// ChatView only needs a chat object with a few fields to build its layout.
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
mock.module("../src/hooks/useChat.ts", () => ({
  useChat: () => ({
    status: { ready: true, apiHost: null },
    list: { readOnly: false },
    detail: null,
    pending: null,
    projects: [],
    scope: null,
    scopeMissing: false,
  }),
}));

const { ChatView } = await import("../src/lib/components/chat/ChatView.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}

it("keeps the chat list in view while a long chat scrolls", () => {
  const [list] = find(ChatView(), (node) => node.type === "aside");
  const classes = String(list!.props.className).split(" ");
  // The page scrolls as a whole, so the list sticks to the top and scrolls inside its own height.
  expect(classes).toContain("md:sticky");
  expect(classes).toContain("md:self-start");
  expect(classes.some((name) => name.startsWith("md:max-h-"))).toBe(true);
  expect(classes).toContain("overflow-y-auto");
});
