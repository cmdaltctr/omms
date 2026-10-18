import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Hooks also run when the component is called directly for the click test.
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { ProfileEvidenceButton } =
  await import("../src/lib/components/explorer/ProfileEvidenceButton.tsx");

beforeEach(() => setLanguage("en"));

function render(evidence: unknown, onOpen = () => {}) {
  return renderToStaticMarkup(
    <ProfileEvidenceButton item={{ description: "x", evidence } as never} onOpen={onOpen} />
  );
}

it("renders a button with the translated count and accessible label", () => {
  const html = render(["a", "b", "c"]);
  expect(html).toContain("<button");
  expect(html).toContain('type="button"');
  expect(html).toContain("3 evidence");
  expect(html).toContain('aria-label="Show evidence (3)"');
  expect(html).toContain('aria-haspopup="dialog"');
});

it("shows a pointer and changes colour on hover", () => {
  const html = render(["a"]);
  expect(html).toContain("cursor-pointer");
  expect(html).toContain("hover:text-primary-label");
});

it("counts evidence stored as one string as 1", () => {
  expect(render("only")).toContain("1 evidence");
});

it("renders nothing when there is no evidence", () => {
  expect(render(undefined)).toBe("");
  expect(render([])).toBe("");
});

it("translates the label", () => {
  setLanguage("zh");
  expect(render(["a", "b"])).toContain("2 条证据");
});

it("calls onOpen when clicked", () => {
  let opened = 0;
  const element = ProfileEvidenceButton({
    item: { description: "x", evidence: ["a"] } as never,
    onOpen: () => opened++,
  }) as react.ReactElement<{ onClick: () => void }>;
  element.props.onClick();
  expect(opened).toBe(1);
});
