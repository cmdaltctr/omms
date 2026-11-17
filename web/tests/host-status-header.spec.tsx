import { expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLanguage } from "../src/lib/i18n/index";
import { allSetUp, fakeStatuses } from "./fake-statuses";

// Read the client language snapshot during server rendering, as other web specs do.
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: () => undefined,
}));
const { HostStatusHeader } = await import("../src/lib/components/memory/HostStatusHeader");
const { TurnOnAction } = await import("../src/lib/components/memory/TurnOnAction");

const cutoff = Date.UTC(2026, 8, 28, 12);

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, match: (element: Node) => boolean): Node | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!react.isValidElement(node)) return null;
  const element = node as Node;
  return match(element) ? element : find(element.props.children, match);
}
const text = (node: ReactNode): string =>
  react.isValidElement(node)
    ? text((node as Node).props.children)
    : Array.isArray(node)
      ? node.map(text).join("")
      : String(node ?? "");

it("reads Off with Turn on, a note that it applies to every host and the Off status line", () => {
  const html = renderToStaticMarkup(
    <HostStatusHeader
      host="pi"
      statuses={fakeStatuses(allSetUp, { autoImport: false, cutoff, pending: 12 })}
    />
  );
  expect(html).toContain("State: Off");
  expect(html).toContain("Turn on");
  expect(html).toContain("Turning this on applies to every host.");
  expect(html).not.toContain("Pause");
  expect(html).toContain("· 12 chat exchanges waiting · Automatic import off");
  expect(html).toContain("Automatic import is off. Use Import new chats");
});

it("reads the status line with the cutoff, the waiting count and Automatic import on", () => {
  const html = renderToStaticMarkup(
    <HostStatusHeader host="pi" statuses={fakeStatuses(allSetUp, { cutoff, pending: 12 })} />
  );
  expect(html).toContain(
    `History imported up to ${cutoff} · 12 chat exchanges waiting · Automatic import on`
  );
  expect(html).toContain("State: Running");
  expect(html).not.toContain("Turn on");
  expect(html).not.toContain("Turning this on applies to every host.");
});

it("leaves each part out of the status line when it is unknown", () => {
  const html = renderToStaticMarkup(
    <HostStatusHeader host="pi" statuses={fakeStatuses(allSetUp)} />
  );
  expect(html).not.toContain("History imported up to");
  expect(html).not.toContain("waiting ·");
  expect(html).toContain("Automatic import on");
});

it("says in one line how automatic import and Import new chats differ", () => {
  const withDate = renderToStaticMarkup(
    <HostStatusHeader host="pi" statuses={fakeStatuses(allSetUp, { cutoff })} />
  );
  expect(withDate).toContain(
    `Automatic import brings in chats up to ${cutoff} by itself. Import new chats brings in every chat not yet imported, newer ones included.`
  );
  const withoutDate = renderToStaticMarkup(
    <HostStatusHeader host="pi" statuses={fakeStatuses(allSetUp)} />
  );
  expect(withoutDate).toContain("Automatic import brings in older chats by itself.");
});

it("asks first, then sends autoBackfill true when Turn on is confirmed", async () => {
  const saved: Record<string, unknown>[] = [];
  const tree = HostStatusHeader({
    host: "pi",
    statuses: fakeStatuses(allSetUp, {
      autoImport: false,
      save: async (edits) => void saved.push(edits),
    }),
  });
  // No button saves straight away; Turn on goes through the confirm question.
  expect(
    find(tree, (element) => text(element) === "Turn on" && !!element.props.onClick)
  ).toBeNull();
  const turnOn = find(tree, (element) => element.type === TurnOnAction);
  expect(turnOn).not.toBeNull();
  expect(saved).toEqual([]);
  await (turnOn!.props.onConfirm as () => Promise<void>)();
  expect(saved).toEqual([{ autoBackfill: true }]);
});

it("reads Off in Chinese and Arabic", () => {
  for (const [language, label] of [
    ["zh", "开启"],
    ["ar", "تشغيل"],
  ] as const) {
    setLanguage(language);
    const html = renderToStaticMarkup(
      <HostStatusHeader host="pi" statuses={fakeStatuses(allSetUp, { autoImport: false })} />
    );
    expect(html).toContain(label);
  }
  setLanguage("en");
});
