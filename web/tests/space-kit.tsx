/**
 * A small test renderer for the memory space components. There is no DOM in these specs.
 * `installReact()` swaps the React hooks for versions that keep state per component, so the
 * tree can be rendered again after each change. `render()` expands only the components the
 * spec names; library components such as Dialog and Button stay as elements to inspect.
 * A Dialog whose `open` is false hides its children, as the real one does.
 */
import { mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

type Slot = { values: unknown[]; deps: (readonly unknown[] | undefined)[] };
export type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;

const slots = new Map<string, Slot>();
const queued: (() => unknown)[] = [];
let slot: Slot = { values: [], deps: [] };
let cursor = 0;
let effectCursor = 0;

const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
  !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

export function installReact() {
  mock.module("react", () => ({
    ...react,
    useContext: () => null,
    useId: () => "id",
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useRef: (initial: unknown) => {
      const index = cursor++;
      slot.values[index] ??= { current: initial };
      return slot.values[index];
    },
    useState: (initial: unknown) => {
      const mine = slot;
      const index = cursor++;
      if (!(index in mine.values)) {
        mine.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        mine.values[index],
        (value: unknown) => {
          mine.values[index] =
            typeof value === "function"
              ? (value as (v: unknown) => unknown)(mine.values[index])
              : value;
        },
      ];
    },
    useMemo: (factory: () => unknown, deps?: readonly unknown[]) => {
      const index = cursor++;
      const saved = slot.values[index] as { value: unknown; deps?: readonly unknown[] } | undefined;
      if (saved && same(saved.deps, deps)) return saved.value;
      const value = factory();
      slot.values[index] = { value, deps };
      return value;
    },
    useCallback: (fn: unknown, deps?: readonly unknown[]) => {
      const index = cursor++;
      const saved = slot.values[index] as { value: unknown; deps?: readonly unknown[] } | undefined;
      if (saved && same(saved.deps, deps)) return saved.value;
      slot.values[index] = { value: fn, deps };
      return fn;
    },
    useEffect: (effect: () => unknown, deps?: readonly unknown[]) => {
      const index = effectCursor++;
      if (deps && same(slot.deps[index], deps)) return;
      slot.deps[index] = deps;
      queued.push(effect);
    },
  }));
}

function walk(node: ReactNode, key: string, own: readonly unknown[], out: Node[]) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, `${key}[${index}]`, own, out));
    return;
  }
  if (!react.isValidElement(node)) return;
  const element = node as Node;
  if (typeof element.type === "function" && own.includes(element.type)) {
    const name = `${key}/${element.type.name}${element.key ?? ""}`;
    slot = slots.get(name) ?? { values: [], deps: [] };
    slots.set(name, slot);
    cursor = 0;
    effectCursor = 0;
    walk((element.type as (props: unknown) => ReactNode)(element.props), name, own, out);
    return;
  }
  out.push(element);
  if (element.props.open === false) return;
  walk(element.props.children, key, own, out);
}

/** Render `element` once and return every element of the expanded tree. */
export function render(element: ReactElement, own: readonly unknown[]): Node[] {
  const out: Node[] = [];
  walk(element, "root", own, out);
  return out;
}

/** Render, run the effects the render queued, wait for their requests, and repeat until quiet. */
export async function settle(element: ReactElement, own: readonly unknown[]): Promise<Node[]> {
  const wait = async () => {
    for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  // A handler that the spec called may have started a request; let it finish first.
  await wait();
  let tree = render(element, own);
  for (let round = 0; round < 12; round++) {
    const effects = queued.splice(0);
    if (effects.length === 0) return tree;
    for (const effect of effects) effect();
    await wait();
    tree = render(element, own);
  }
  return tree;
}

/** Forget every component's state, as a page reload does. */
export function resetRender() {
  slots.clear();
  queued.length = 0;
}

export const text = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return react.isValidElement(node) ? text((node as Node).props.children) : "";
};
/** Every piece of text in the expanded tree, joined by a space. */
export const allText = (tree: Node[]) =>
  tree
    .flatMap((node) => [node.props.children].flat())
    .filter(
      (child): child is string | number => typeof child === "string" || typeof child === "number"
    )
    .join(" ");
export const byType = (tree: Node[], type: unknown) => tree.filter((node) => node.type === type);
export const byText = (tree: Node[], type: unknown, label: string) =>
  tree.filter((node) => node.type === type && text(node.props.children).trim() === label);

type Reply = { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
export type Request = { method: string; path: string; body: any };

/** Fake `fetch` and `window` for the spaces routes. The handler returns a reply per request. */
export function installFetch(handler: (request: Request) => Reply) {
  const requests: Request[] = [];
  Object.assign(globalThis, {
    window: { __OMMS_TOKEN__: "token", location: { hash: "" } },
    fetch: async (path: string, options: RequestInit = {}) => {
      const request = {
        method: options.method ?? "GET",
        path,
        body: options.body ? JSON.parse(String(options.body)) : undefined,
      };
      requests.push(request);
      const { status = 200, body } = await handler(request);
      return new Response(JSON.stringify(body), { status });
    },
  });
  return requests;
}
