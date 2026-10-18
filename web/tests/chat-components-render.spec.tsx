import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationRow } from "../src/lib/components/chat/ConversationRow.tsx";
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
