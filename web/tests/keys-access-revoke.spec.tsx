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

const { KeysAccessSection, PasswordFields } =
  await import("../src/lib/components/settings/KeysAccessSection.tsx");
const { ApiTokensTable } = await import("../src/lib/components/settings/ApiTokensTable.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [KeysAccessSection, ApiTokensTable, PasswordFields];
const token = { id: "t1", name: "ci", createdAt: 0, expiresAt: null, lastUsedAt: null };
const REFUSED = "The web app could not write the password file.";
let refusal: string | undefined;
let requests: Request[] = [];

beforeEach(() => {
  resetRender();
  setLanguage("en");
  refusal = undefined;
  requests = installFetch((request) => {
    if (refusal && request.method === "POST" && request.path === "/api/settings/web-password")
      return { status: 409, body: { error: refusal } };
    if (request.path === "/api/web/status") return { body: { isLocal: true } };
    if (request.path === "/api/settings/tokens") {
      if (request.method === "POST") return { body: { value: "omms_new" } };
      return { body: { tokens: [token] } };
    }
    if (request.path === "/api/settings") {
      return {
        body: {
          revision: "r1",
          secrets: {},
          effective: {},
          access: {
            host: "127.0.0.1",
            authEnabled: true,
            tokenAvailable: true,
            embeddingApiUrl: null,
            authUsername: "me",
            configTokenIgnored: false,
          },
        },
      };
    }
    return { body: { ok: true } };
  });
});

const button = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const inputOf = (tree: Node[], id: string) =>
  byType(tree, Input).find((node) => node.props.id === id)!;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
const deletes = () => requests.filter((request) => request.method === "DELETE");
const passwordPosts = () =>
  requests.filter((request) => request.path === "/api/settings/web-password");
const tokenPosts = () =>
  requests.filter(
    (request) => request.path === "/api/settings/tokens" && request.method === "POST"
  );
/** Confirm the open dialog, then let it close as it does when the request succeeds. */
async function confirm(tree: Node[]) {
  const dialog = dialogOf(tree)!;
  const result = await dialog.props.onConfirm();
  dialog.props.onClose();
  return result;
}

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

it("asks before the password is saved, shows no secret, and keeps it on Cancel", async () => {
  let tree = await settle(<KeysAccessSection />, own);
  inputOf(tree, "web-password-user").props.onChange({ target: { value: "me" } });
  tree = await settle(<KeysAccessSection />, own);
  inputOf(tree, "web-password-value").props.onChange({ target: { value: "hunter2" } });
  tree = await settle(<KeysAccessSection />, own);
  button(tree, "Save password").props.onClick();
  tree = await settle(<KeysAccessSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save the browser password?");
  expect(dialog.props.confirmLabel).toBe("Save password");
  expect(dialog.props.destructive).toBeFalsy();
  // One sentence, and never the password itself.
  expect(text(dialog.props.body)).toBe(
    "The password is stored in a private file on this computer. The web app asks for it after it restarts."
  );
  expect(allText(tree)).not.toContain("hunter2");
  expect(passwordPosts()).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(<KeysAccessSection />, own);
  expect(passwordPosts()).toHaveLength(0);
  // The typed password stays as a draft, so Save password can be used again.
  expect(inputOf(tree, "web-password-value").props.value).toBe("hunter2");
  button(tree, "Save password").props.onClick();
  tree = await settle(<KeysAccessSection />, own);
  await confirm(tree);
  tree = await settle(<KeysAccessSection />, own);
  expect(passwordPosts()).toHaveLength(1);
  expect(passwordPosts()[0]!.body).toEqual({
    password: "hunter2",
    username: "me",
    revision: "r1",
  });
  // The password leaves the page as soon as it is saved.
  expect(inputOf(tree, "web-password-value").props.value).toBe("");
  expect(allText(tree)).toContain("Saved. Restart the web app to use the new browser password.");
});

it("asks before the password is cleared, and confirm sends the same body", async () => {
  let tree = await settle(<KeysAccessSection />, own);
  button(tree, "Clear password").props.onClick();
  tree = await settle(<KeysAccessSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Clear the browser password?");
  expect(dialog.props.confirmLabel).toBe("Clear password");
  expect(dialog.props.destructive).toBe(true);
  expect(text(dialog.props.body)).toBe(
    "The browser password is removed. The web app stops asking for it after it restarts."
  );
  expect(passwordPosts()).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(<KeysAccessSection />, own);
  expect(passwordPosts()).toHaveLength(0);

  button(tree, "Clear password").props.onClick();
  tree = await settle(<KeysAccessSection />, own);
  await confirm(tree);
  tree = await settle(<KeysAccessSection />, own);
  expect(passwordPosts()).toHaveLength(1);
  expect(passwordPosts()[0]!.body).toEqual({ clear: true, revision: "r1" });
  expect(allText(tree)).toContain("Browser password cleared. Restart the web app to turn it off.");
});

it("asks before a token is generated, and confirm sends the same body", async () => {
  let tree = await settle(<KeysAccessSection />, own);
  inputOf(tree, "api-token-name").props.onChange({ target: { value: "ci" } });
  tree = await settle(<KeysAccessSection />, own);
  button(tree, "Generate token").props.onClick();
  tree = await settle(<KeysAccessSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Generate a token?");
  expect(dialog.props.confirmLabel).toBe("Generate token");
  expect(text(dialog.props.body)).toBe(
    "OMMS creates a token that lets scripts and other computers call this web app's API."
  );
  expect(tokenPosts()).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(<KeysAccessSection />, own);
  expect(tokenPosts()).toHaveLength(0);

  button(tree, "Generate token").props.onClick();
  tree = await settle(<KeysAccessSection />, own);
  await confirm(tree);
  tree = await settle(<KeysAccessSection />, own);
  expect(tokenPosts()).toHaveLength(1);
  expect(tokenPosts()[0]!.body).toEqual({ name: "ci", expiresInDays: 30 });
  // The new value is shown once, with its copy warning.
  expect(allText(tree)).toContain("omms_new");
  expect(allText(tree)).toContain("Copy this token now. It will not be shown again.");
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(<KeysAccessSection />, own);
  inputOf(tree, "web-password-value").props.onChange({ target: { value: "hunter2" } });
  tree = await settle(<KeysAccessSection />, own);
  button(tree, "Save password").props.onClick();
  tree = await settle(<KeysAccessSection />, own);

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<KeysAccessSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(passwordPosts()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved.");

  dialogOf(tree)!.props.onClose();
  tree = await settle(<KeysAccessSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
});
