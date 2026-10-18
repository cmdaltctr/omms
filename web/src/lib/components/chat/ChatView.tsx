import { useState } from "react";
import { Info, MessagesSquare, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import type { ChatSource } from "$lib/chat-api";
import { useChat } from "@/hooks/useChat";
import { cn } from "$lib/utils";
import { ChatInput } from "./ChatInput";
import { ChatSetupNotice } from "./ChatSetupNotice";
import { ConversationList } from "./ConversationList";
import { DeleteChatsDialog, type DeleteRequest } from "./DeleteChatsDialog";
import { FolderDialog, type NameRequest } from "./FolderDialog";
import { MessageThread } from "./MessageThread";
import { SourceDialog } from "./SourceDialog";

/** The chat page: the chat list beside the open chat. On narrow screens the list is a panel. */
export function ChatView() {
  const { t } = useI18n();
  const chat = useChat();
  const [listOpen, setListOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<DeleteRequest | null>(null);
  const [naming, setNaming] = useState<NameRequest | null>(null);
  const [source, setSource] = useState<ChatSource | null>(null);

  const missing = new Set(chat.detail?.missingMemoryIds ?? []);
  const readOnly = chat.list.readOnly;
  const ready = chat.status?.ready ?? false;

  function selectModeChange(on: boolean) {
    setSelectMode(on);
    setSelected(new Set());
  }

  async function confirmDelete(request: DeleteRequest) {
    if (request.kind === "folder") await chat.deleteFolder(request.id);
    else await chat.deleteChats(request.ids);
    setDeleting(null);
    selectModeChange(false);
  }

  const list = (
    <ConversationList
      chat={chat}
      selectMode={selectMode}
      selected={selected}
      onSelectMode={selectModeChange}
      onSelected={setSelected}
      onDelete={setDeleting}
      onName={setNaming}
      onOpened={() => setListOpen(false)}
    />
  );

  return (
    <div className="grid min-h-[calc(100svh-9rem)] gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 overflow-y-auto border-e border-border pe-4 md:block">
        {list}
      </aside>

      {listOpen ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("chat-show-list")}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label={t("chat-cancel")}
            onClick={() => setListOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 flex w-[min(20rem,85vw)] flex-col gap-3 overflow-y-auto bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("chat-conversations")}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat-cancel")}
                onClick={() => setListOpen(false)}
              >
                <X />
              </Button>
            </div>
            {list}
          </div>
        </div>
      ) : null}

      <section className="flex min-h-0 min-w-0 flex-col gap-4">
        <div className="flex items-center gap-2 md:hidden">
          <Button type="button" variant="outline" size="sm" onClick={() => setListOpen(true)}>
            <MessagesSquare />
            {t("chat-show-list")}
          </Button>
          {chat.detail ? (
            <span dir="auto" className="min-w-0 truncate text-sm text-muted-foreground">
              {chat.detail.conversation.title}
            </span>
          ) : null}
        </div>

        {chat.status && !ready ? <ChatSetupNotice status={chat.status} /> : null}
        {readOnly ? (
          <p role="alert" className="rounded-xl border border-border bg-card p-3 text-sm">
            {t("chat-read-only")}
          </p>
        ) : null}

        <div className={cn("flex min-h-48 flex-1 flex-col overflow-y-auto")}>
          <MessageThread
            messages={chat.detail?.messages ?? []}
            pending={chat.pending}
            missingMemoryIds={missing}
            readOnly={readOnly || !ready}
            onOpenSource={setSource}
            onRetry={chat.retry}
          />
        </div>

        <div className="sticky bottom-0 grid gap-1.5 bg-background pb-1">
          <ChatInput
            projects={chat.projects}
            scope={chat.scope}
            scopeMissing={chat.scopeMissing}
            disabled={!ready || readOnly || chat.pending !== null}
            onScope={chat.setScope}
            onAsk={(question) => void chat.ask(question)}
          />
          {ready && chat.status?.apiHost ? (
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Info className="size-3 shrink-0" aria-hidden="true" />
              {t("chat-provider-note", { host: chat.status.apiHost })}
            </p>
          ) : null}
        </div>
      </section>

      <DeleteChatsDialog
        request={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <FolderDialog request={naming} onClose={() => setNaming(null)} />
      <SourceDialog
        source={source}
        deleted={!!source && source.kind === "memory" && missing.has(source.id)}
        onClose={() => setSource(null)}
      />
    </div>
  );
}
