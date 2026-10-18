import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Read the client language snapshot, and let components with state render outside a renderer.
let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [state[index], () => {}];
  },
}));

const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { ChatSetupNotice } = await import("../src/lib/components/chat/ChatSetupNotice.tsx");
const { ChatInput } = await import("../src/lib/components/chat/ChatInput.tsx");
const { AnswerBubble } = await import("../src/lib/components/chat/AnswerBubble.tsx");
const { SearchDetails } = await import("../src/lib/components/chat/SearchDetails.tsx");
const { deleteBody } = await import("../src/lib/components/chat/DeleteChatsDialog.tsx");
const { t } = await import("../src/lib/i18n/index.ts");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}

beforeEach(() => {
  setLanguage("en");
  state = [];
  cursor = 0;
});

const memory = {
  label: "S1",
  kind: "memory" as const,
  id: "m1",
  text: "Use npm for JavaScript projects.",
  projectName: "omms",
  createdAt: Date.UTC(2026, 9, 1),
  tags: ["npm", "tooling"],
};
const answer = {
  id: "a1",
  conversationId: "c1",
  role: "assistant" as const,
  content: "Use npm [S1].",
  sources: [memory],
  plan: { queries: ["npm or bun"], tags: ["npm"], profileCategories: [], skipped: false },
  model: "m",
  errorCode: null,
  notice: null,
  createdAt: 1,
};

it("names the missing settings and links to Settings, never showing values", () => {
  const html = renderToStaticMarkup(
    <ChatSetupNotice
      status={{ ready: false, missing: ["memoryApiKey"], provider: "openai-chat", apiHost: null }}
    />
  );
  expect(html).toContain("memoryApiKey");
  expect(html).toContain('href="/settings#settings-section-external-api"');
});

it("disables the question input when chat is not ready", () => {
  const html = renderToStaticMarkup(
    <ChatInput
      projects={[]}
      scope={null}
      scopeMissing={false}
      disabled={true}
      onScope={() => {}}
      onAsk={() => {}}
    />
  );
  expect(html).toMatch(/<textarea[^>]*disabled/);
});

it("asks for a scope when the chat's project is not on this computer", () => {
  const html = renderToStaticMarkup(
    <ChatInput
      projects={[]}
      scope={undefined}
      scopeMissing={true}
      disabled={false}
      onScope={() => {}}
      onAsk={() => {}}
    />
  );
  expect(html).toContain("Project not on this computer");
  expect(html).toContain("Choose where to search before you ask.");
});

it("opens the cited source from a citation chip", () => {
  const opened: string[] = [];
  const tree = AnswerBubble({
    message: answer,
    missingMemoryIds: new Set(),
    readOnly: false,
    onOpenSource: (source) => opened.push(source.id),
    onRetry: () => {},
  });
  const chips = find(
    tree,
    (node) => typeof node.props.label === "string" && "onOpen" in node.props
  );
  expect(chips.length).toBeGreaterThan(0);
  (chips[0]!.props.onOpen as () => void)();
  expect(opened).toEqual(["m1"]);
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("Sources");
  expect(html).toContain('aria-label="Open source S1"');
});

it("shows how the answer searched, and when the plan was skipped", () => {
  const html = renderToStaticMarkup(
    <SearchDetails plan={{ queries: ["q"], tags: [], profileCategories: [], skipped: true }} />
  );
  expect(html).toContain("How I searched");
  expect(html).toContain("The search plan was skipped");
  expect(html).toContain("none");
});

it("shows a failed answer with a retry action", () => {
  const retried: string[] = [];
  const failed = { ...answer, content: "", errorCode: "model_http_401", sources: [] };
  const tree = AnswerBubble({
    message: failed,
    missingMemoryIds: new Set(),
    readOnly: false,
    onOpenSource: () => {},
    onRetry: (message) => retried.push(message.id),
  });
  expect(renderToStaticMarkup(tree)).toContain("The answer failed (model_http_401).");
  const retry = find(tree, (node) => typeof node.props.onClick === "function")[0]!;
  (retry.props.onClick as () => void)();
  expect(retried).toEqual(["a1"]);
});

it("states the chat count in the folder and bulk delete confirmations", () => {
  expect(deleteBody({ kind: "folder", id: "f", name: "Thesis", count: 4 }, t)).toBe(
    'The folder "Thesis" and its 4 chats will be deleted. This cannot be undone.'
  );
  expect(deleteBody({ kind: "chats", ids: ["a", "b", "c"] }, t)).toContain("3 chats");
});
