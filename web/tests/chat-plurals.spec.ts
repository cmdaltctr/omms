import { expect, it } from "bun:test";
import { t } from "../src/lib/i18n/index.ts";
import { translations } from "../src/lib/i18n/translations.ts";
import { deleteBody } from "../src/lib/components/chat/DeleteChatsDialog.tsx";

it("says one chat, not 1 chats, when one chat is deleted", () => {
  const html = deleteBody({ kind: "chats", ids: ["a"] } as never, (key, params) =>
    t(key, params, "en")
  );
  expect(html).toContain("1 chat will be deleted");
  expect(html).not.toContain("1 chats");
});

it("says one chat in a folder delete and in the folder count", () => {
  expect(t("chat-delete-folder-body-one", { name: "X", count: 1 }, "en")).toContain("1 chat ");
  expect(
    deleteBody({ kind: "folder", name: "X", count: 1 } as never, (k, p) => t(k, p, "en"))
  ).toContain("1 chat");
  expect(
    deleteBody({ kind: "folder", name: "X", count: 1 } as never, (k, p) => t(k, p, "en"))
  ).not.toContain("1 chats");
  expect(t("chat-folder-count-one", { count: 1 }, "en")).toBe("1 chat");
});

it("defines every singular key in every language", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    for (const key of [
      "chat-delete-chats-body-one",
      "chat-delete-folder-body-one",
      "chat-folder-count-one",
    ]) {
      expect((translations[lang] as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy();
    }
  }
});
