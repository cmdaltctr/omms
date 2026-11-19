import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// The dialog edits an item by its index in the profile the page shows. It sends that
// profile's version, so the server can refuse the edit after a newer version moved the items.

let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_s: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
const bodies: unknown[] = [];
Object.assign(globalThis, {
  window: { __OMMS_TOKEN__: "page-token" },
  fetch: async (_path: string, options: RequestInit = {}) => {
    bodies.push(JSON.parse(String(options.body)));
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  },
});
const { ProfileItemDialog } = await import("../src/lib/components/explorer/ProfileItemDialog.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  const own = predicate(element) ? [element] : [];
  return [...own, ...find(element.props.children, predicate)];
}

async function submit(props: Parameters<typeof ProfileItemDialog>[0]) {
  cursor = 0;
  const form = find(ProfileItemDialog(props), (node) => node.type === "form")[0]!;
  await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
    preventDefault: () => {},
  });
}

beforeEach(() => {
  states = [];
  bodies.length = 0;
});

it("sends the shown profile version with an edit", async () => {
  await submit({ open: true, type: "preferences", index: 2, action: "edit", version: 7 });
  expect(bodies[0]).toMatchObject({ type: "preferences", index: 2, action: "edit", version: 7 });
});

it("sends the shown profile version with a delete after the second confirmation", async () => {
  const props = { open: true, type: "patterns", index: 0, action: "delete", version: 7 } as const;
  await submit(props);
  expect(bodies).toEqual([]);
  await submit(props);
  expect(bodies[0]).toEqual({ type: "patterns", index: 0, action: "delete", version: 7 });
});
