import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  byType,
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

const { EmbeddingSection, EmbeddingRunStatus, EmbeddingSummary } =
  await import("../src/lib/components/settings/EmbeddingSection.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

/** The card on its own: the dialog stays an element to drive through its props. */
const own = [EmbeddingSection, EmbeddingRunStatus, EmbeddingSummary];
const REFUSED = "A re-embed is already running";

const current = {
  kind: "builtin" as const,
  url: null,
  model: "Xenova/nomic-embed-text-v1",
  dimensions: 768,
  memoryCount: 12,
  run: { state: "failed" as const, progress: { processed: 3, total: 12 }, error: "503" },
};

let refusal: string | undefined;
let requests: Request[];
beforeEach(() => {
  resetRender();
  setLanguage("en");
  refusal = undefined;
  requests = installFetch((request) => {
    if (request.method === "POST" && request.path === "/api/settings/embedding/run") {
      if (refusal) return { status: 409, body: { error: refusal } };
      // "done" keeps the card from polling a running re-embed inside this spec.
      return { body: { state: "done", progress: { processed: 12, total: 12 } } };
    }
    if (request.path === "/api/settings/embedding") return { body: current };
    if (request.path === "/api/web/status") return { body: { isLocal: true } };
    return { body: { revision: "r1", secrets: {} } };
  });
});

const card = () => settle(<EmbeddingSection />, own);
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const runs = () => requests.filter((request) => request.path === "/api/settings/embedding/run");

it("asks before it retries a failed re-embed, and sends nothing until the user confirms", async () => {
  let tree = await card();
  expect(allText(tree)).toContain("Re-embed failed");
  buttonOf(tree, "Retry").props.onClick();
  tree = await card();

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Retry the re-embed?");
  expect(dialog.props.confirmLabel).toBe("Retry");
  expect(dialog.props.busyLabel).toBe("Re-embedding…");
  expect(text(dialog.props.body)).toBe(
    "The re-embed will run again and send every stored memory to the embedding model."
  );
  expect(runs()).toHaveLength(0);
});

it("sends nothing on Cancel, and the failure stays on the card", async () => {
  let tree = await card();
  buttonOf(tree, "Retry").props.onClick();
  tree = await card();
  dialogOf(tree)!.props.onClose();
  tree = await card();

  expect(dialogOf(tree)).toBeUndefined();
  expect(runs()).toHaveLength(0);
  expect(allText(tree)).not.toContain("Re-embed finished.");
});

it("sends the same request as before the rule once the user confirms", async () => {
  let tree = await card();
  buttonOf(tree, "Retry").props.onClick();
  tree = await card();

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(runs()).toHaveLength(1);
  expect(runs()[0]!.method).toBe("POST");
  expect(runs()[0]!.body).toEqual({});
  // The dialog itself closes once the request succeeds.
  dialogOf(tree)!.props.onClose();
  tree = await card();
  expect(dialogOf(tree)).toBeUndefined();
  expect(allText(tree)).toContain("Re-embed finished.");
});

it("keeps a server refusal inside the dialog, which stays open", async () => {
  refusal = REFUSED;
  let tree = await card();
  buttonOf(tree, "Retry").props.onClick();
  tree = await card();

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({
    success: false,
    error: REFUSED,
  });
  tree = await card();
  expect(dialogOf(tree)).toBeDefined();
  expect(runs()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
});
