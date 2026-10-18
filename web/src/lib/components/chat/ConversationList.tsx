import { useState } from "react";
import { CheckSquare, FolderPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { chatApi, type ChatConversation } from "$lib/chat-api";
import type { ChatState } from "@/hooks/useChat";
import { ConversationRow } from "./ConversationRow";
import type { DeleteRequest } from "./DeleteChatsDialog";
import type { NameRequest } from "./FolderDialog";
import { FolderRow } from "./FolderRow";

type Props = {
  chat: ChatState;
  selectMode: boolean;
  selected: Set<string>;
  onSelectMode: (on: boolean) => void;
  onSelected: (ids: Set<string>) => void;
  onDelete: (request: DeleteRequest) => void;
  onName: (request: NameRequest) => void;
  onOpened?: () => void;
};

/** Chats grouped by folder, then the chats in no folder, with select mode for bulk delete. */
export function ConversationList(props: Props) {
  const { t } = useI18n();
  const { chat, selectMode, selected } = props;
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const { conversations, folders, readOnly } = chat.list;
  const loose = conversations.filter((c) => !c.folderId);

  const folderError = (error: string | null) =>
    error === "conflict" ? t("chat-folder-exists") : error;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onSelected(next);
  };
  const selectAll = (ids: string[]) => props.onSelected(new Set([...selected, ...ids]));

  const renameChat = (c: ChatConversation) =>
    props.onName({
      title: t("chat-chat-rename-title"),
      label: t("chat-chat-title"),
      initial: c.title,
      submitLabel: t("chat-save"),
      submit: (name) => chat.change(() => chatApi.rename(c.id, name)),
    });

  const rows = (items: ChatConversation[]) =>
    items.map((c) => (
      <ConversationRow
        key={c.id}
        conversation={c}
        folders={folders}
        active={c.id === chat.activeId}
        selectMode={selectMode}
        selected={selected.has(c.id)}
        actionsOpen={actionsFor === c.id}
        readOnly={readOnly}
        onOpen={() => {
          void chat.open(c.id);
          props.onOpened?.();
        }}
        onToggleSelect={() => toggle(c.id)}
        onToggleActions={() => setActionsFor(actionsFor === c.id ? null : c.id)}
        onRename={() => renameChat(c)}
        onMove={(folderId) => void chat.change(() => chatApi.move(c.id, folderId))}
        onDelete={() => props.onDelete({ kind: "chats", ids: [c.id] })}
      />
    ));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {selectMode ? (
          <>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t("chat-selected-count", { count: selected.size })}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              disabled={selected.size === 0}
              onClick={() => props.onDelete({ kind: "chats", ids: [...selected] })}
            >
              <Trash2 />
              {t("chat-delete-selected")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => props.onSelectMode(false)}
            >
              {t("chat-select-done")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="xs" disabled={readOnly} onClick={() => void chat.newChat()}>
              <Plus />
              {t("chat-new")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={readOnly}
              onClick={() =>
                props.onName({
                  title: t("chat-folder-create-title"),
                  label: t("chat-folder-name"),
                  initial: "",
                  submitLabel: t("chat-create"),
                  submit: async (name) =>
                    folderError(await chat.change(() => chatApi.createFolder(name))),
                })
              }
            >
              <FolderPlus />
              {t("chat-new-folder")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={readOnly || conversations.length === 0}
              onClick={() => props.onSelectMode(true)}
            >
              <CheckSquare />
              {t("chat-select")}
            </Button>
          </>
        )}
      </div>

      {conversations.length === 0 && folders.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{t("chat-empty-list")}</p>
      ) : null}

      {folders.map((folder) => {
        const items = conversations.filter((c) => c.folderId === folder.id);
        return (
          <FolderRow
            key={folder.id}
            name={folder.name}
            count={items.length}
            onSelectAll={selectMode ? () => selectAll(items.map((c) => c.id)) : undefined}
            actions={
              readOnly
                ? undefined
                : {
                    onNewChat: () => void chat.newChat(folder.id),
                    onRename: () =>
                      props.onName({
                        title: t("chat-folder-rename-title"),
                        label: t("chat-folder-name"),
                        initial: folder.name,
                        submitLabel: t("chat-save"),
                        submit: async (name) =>
                          folderError(
                            await chat.change(() => chatApi.renameFolder(folder.id, name))
                          ),
                      }),
                    onDelete: () =>
                      props.onDelete({
                        kind: "folder",
                        id: folder.id,
                        name: folder.name,
                        count: items.length,
                      }),
                  }
            }
          >
            {rows(items)}
          </FolderRow>
        );
      })}

      {loose.length > 0 ? (
        <FolderRow
          name={t("chat-no-folder")}
          count={loose.length}
          onSelectAll={selectMode ? () => selectAll(loose.map((c) => c.id)) : undefined}
        >
          {rows(loose)}
        </FolderRow>
      ) : null}
    </div>
  );
}
