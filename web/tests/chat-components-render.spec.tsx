import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationRow } from "../src/lib/components/chat/ConversationRow.tsx";
import { CitationChip } from "../src/lib/components/chat/CitationChip.tsx";
import { CitationLegend } from "../src/lib/components/chat/CitationLegend.tsx";
import { FolderRow } from "../src/lib/components/chat/FolderRow.tsx";
import { SourceBody } from "../src/lib/components/chat/SourceDialog.tsx";

// Radix primitives need a real render, so these run without the hook stubs in chat-components.

const memory = {
  label: "S1",
  kind: "memory" as const,
  id: "m1",
  text: "Use npm for JavaScript projects.",
  projectName: "omms",
  createdAt: Date.UTC(2026, 9, 1),
  tags: ["npm", "tooling"],
};

it("says when a cited memory no longer exists", () => {
  const html = renderToStaticMarkup(<SourceBody source={memory} deleted={true} />);
  expect(html).toContain("This memory no longer exists");
  expect(html).toContain("Use npm for JavaScript projects.");
  expect(html).toContain("omms");
});

it("shows a labelled tick box for each chat in select mode", () => {
  const props = {
    conversation: {
      id: "c1",
      folderId: null,
      title: "Thesis plan",
      scopeTag: null,
      createdAt: 1,
      updatedAt: 1,
    },
    folders: [],
    active: false,
    selectMode: true,
    selected: true,
    actionsOpen: false,
    readOnly: false,
    onOpen: () => {},
    onToggleSelect: () => {},
    onToggleActions: () => {},
    onRename: () => {},
    onMove: () => {},
    onDelete: () => {},
  };
  const html = renderToStaticMarkup(<ConversationRow {...props} />);
  expect(html).toContain('role="checkbox"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('aria-label="Select Thesis plan"');
});

it("cuts a long chat title with an ellipsis inside the button and shows the full title on hover", () => {
  const long =
    "How does OMMS decide which memories to add to a prompt when several projects match?";
  const props = {
    conversation: {
      id: "c1",
      folderId: null,
      title: long,
      scopeTag: null,
      createdAt: 1,
      updatedAt: 1,
    },
    folders: [],
    active: false,
    selectMode: false,
    selected: false,
    actionsOpen: false,
    readOnly: false,
    onOpen: () => {},
    onToggleSelect: () => {},
    onToggleActions: () => {},
    onRename: () => {},
    onMove: () => {},
    onDelete: () => {},
  };
  const html = renderToStaticMarkup(<ConversationRow {...props} />);
  // The ellipsis lives on a block-level span: text-overflow does not work on a button itself.
  expect(html).toMatch(/<button[^>]*overflow-hidden[^>]*><span[^>]*class="[^"]*block[^"]*truncate/);
  expect(html).toContain(`title="${long}"`);
});

it("keeps the folder group and its chat list to the width of the column", () => {
  // An unlimited grid column grows to the longest title, so the whole panel scrolls sideways.
  const html = renderToStaticMarkup(
    <FolderRow name="No folder" count={1}>
      <li>a very long chat title that would otherwise make the whole column wider</li>
    </FolderRow>
  );
  expect(html).toMatch(/<section[^>]*grid-cols-\[minmax\(0,1fr\)\]/);
  expect(html).toMatch(/<ul[^>]*grid-cols-\[minmax\(0,1fr\)\]/);
});

it("explains the S and P labels with the same badges the citations use", () => {
  const legend = renderToStaticMarkup(<CitationLegend letters={["S", "P"]} />);
  const memoryChip = renderToStaticMarkup(<CitationChip label="S1" onOpen={() => {}} />);
  const profileChip = renderToStaticMarkup(<CitationChip label="P1" onOpen={() => {}} />);
  const classOf = (html: string, text: string) =>
    html.match(new RegExp(`class="([^"]*)"[^>]*>${text}<`))?.[1];
  // The legend badge has the colour classes of the chip with the same letter.
  const memoryColours = classOf(memoryChip, "S1")?.match(/border-primary\/30[^"]*/)?.[0];
  const profileColours = classOf(profileChip, "P1")?.match(/border-blue-600\/40[^"]*/)?.[0];
  expect(memoryColours).toBeDefined();
  expect(profileColours).toBeDefined();
  expect(classOf(legend, "S")).toContain(memoryColours as string);
  expect(classOf(legend, "P")).toContain(profileColours as string);
  expect(legend).toContain("memory (a note saved from your sessions)");
  expect(legend).toContain("profile item (a preference, pattern or workflow)");
});

it("shows the K badge in the legend only when asked, with the colours of the K chip", () => {
  const without = renderToStaticMarkup(<CitationLegend letters={["S", "P"]} />);
  const withK = renderToStaticMarkup(<CitationLegend letters={["S", "P", "K"]} />);
  const chip = renderToStaticMarkup(<CitationChip label="K1" onOpen={() => {}} />);
  const classOf = (html: string, text: string) =>
    html.match(new RegExp(`class="([^"]*)"[^>]*>${text}<`))?.[1];
  const colours = classOf(chip, "K1")?.match(/border-violet-600\/40[^"]*/)?.[0];
  expect(colours).toBeDefined();
  expect(without).not.toContain("skill (usage and change history)");
  expect(classOf(withK, "K")).toContain(colours as string);
  expect(withK).toContain("skill (usage and change history)");
});
