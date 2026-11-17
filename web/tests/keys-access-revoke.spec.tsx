import { beforeEach, expect, it } from "bun:test";
import {
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

const { KeysAccessSection } = await import("../src/lib/components/settings/KeysAccessSection.tsx");
const { ApiTokensTable } = await import("../src/lib/components/settings/ApiTokensTable.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [KeysAccessSection, ApiTokensTable];
const token = { id: "t1", name: "ci", createdAt: 0, expiresAt: null, lastUsedAt: null };
let requests: Request[] = [];

beforeEach(() => {
  resetRender();
  setLanguage("en");
  requests = installFetch((request) => {
    if (request.path === "/api/web/status") return { body: { isLocal: true } };
    if (request.path === "/api/settings/tokens" && request.method === "GET") {
      return { body: { tokens: [token] } };
    }
    if (request.path === "/api/settings") {
      return { body: { revision: "r1", secrets: {}, effective: {}, access: undefined } };
    }
    return { body: { ok: true } };
  });
});

const button = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const deletes = () => requests.filter((request) => request.method === "DELETE");

it("revokes a token only after the dialog is confirmed", async () => {
  let tree = await settle(<KeysAccessSection />, own);
  button(tree, "Revoke").props.onClick();
  tree = await settle(<KeysAccessSection />, own);
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(dialog).toBeDefined();
  expect(deletes()).toHaveLength(0);
  dialog.props.onClose();
  tree = await settle(<KeysAccessSection />, own);
  expect(byType(tree, SettingsConfirmDialog)).toHaveLength(0);
  expect(deletes()).toHaveLength(0);

  button(tree, "Revoke").props.onClick();
  tree = await settle(<KeysAccessSection />, own);
  const result = await byType(tree, SettingsConfirmDialog)[0]!.props.onConfirm();
  expect(result.success).toBe(true);
  expect(deletes().map((request) => request.path)).toEqual(["/api/settings/tokens/t1"]);
});
