import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchAPI } from "$lib/api";
import {
  chatApi,
  type ChatDetail,
  type ChatList,
  type ChatMessage,
  type ChatStatus,
} from "$lib/chat-api";
import type { TagInfo } from "$lib/types";

/** `undefined` scope means the user must pick one before asking. */
export type ChatScope = string | null | undefined;

const EMPTY_LIST: ChatList = { conversations: [], folders: [], readOnly: false };

/** State and actions for the chat page. Every change is saved on the server first. */
export function useChat() {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [list, setList] = useState<ChatList>(EMPTY_LIST);
  const [projects, setProjects] = useState<TagInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [scope, setScope] = useState<ChatScope>(null);
  const [pending, setPending] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const result = await chatApi.list();
    if (result.success && result.data) setList(result.data);
  }, []);

  useEffect(() => {
    void chatApi.status().then((r) => r.success && r.data && setStatus(r.data));
    void fetchAPI<{ project: TagInfo[] }>("/api/tags").then(
      (r) => r.success && r.data && setProjects(r.data.project)
    );
    void refreshList();
  }, [refreshList]);

  const scopeExists = useCallback(
    (tag: string | null) => tag === null || projects.some((p) => p.tag === tag),
    [projects]
  );

  const open = useCallback(
    async (id: string) => {
      const result = await chatApi.get(id);
      if (!result.success || !result.data) return void toast.error(result.error ?? "");
      setActiveId(id);
      setDetail(result.data);
      const tag = result.data.conversation.scopeTag;
      setScope(scopeExists(tag) ? tag : undefined);
    },
    [scopeExists]
  );

  const newChat = useCallback(
    async (folderId: string | null = null) => {
      const result = await chatApi.create(folderId, null);
      if (!result.success || !result.data) return void toast.error(result.error ?? "");
      await refreshList();
      setActiveId(result.data.id);
      setDetail({ conversation: result.data, messages: [] });
      setScope(null);
    },
    [refreshList]
  );

  const ask = useCallback(
    async (question: string, retry = false) => {
      if (scope === undefined) return;
      let id = activeId;
      if (!id) {
        const created = await chatApi.create(null, scope);
        if (!created.success || !created.data) return void toast.error(created.error ?? "");
        id = created.data.id;
        setActiveId(id);
        setDetail({ conversation: created.data, messages: [] });
      }
      setPending(question);
      const result = await chatApi.ask(id, question, scope, retry);
      setPending(null);
      if (!result.success || !result.data) return void toast.error(result.error ?? "");
      await open(id);
      await refreshList();
    },
    [activeId, scope, open, refreshList]
  );

  const retry = useCallback(
    (message: ChatMessage) => {
      const messages = detail?.messages ?? [];
      const index = messages.findIndex((m) => m.id === message.id);
      const question = messages[index - 1];
      if (question?.role === "user") void ask(question.content, true);
    },
    [detail, ask]
  );

  const afterDelete = useCallback(
    async (deletedIds: string[]) => {
      if (activeId && deletedIds.includes(activeId)) {
        setActiveId(null);
        setDetail(null);
        setScope(null);
      }
      await refreshList();
    },
    [activeId, refreshList]
  );

  const deleteChats = useCallback(
    async (ids: string[]) => {
      const result =
        ids.length === 1 ? await chatApi.remove(ids[0]!) : await chatApi.removeMany(ids);
      if (!result.success) return void toast.error(result.error ?? "");
      await afterDelete(ids);
    },
    [afterDelete]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const inFolder = list.conversations.filter((c) => c.folderId === folderId).map((c) => c.id);
      const result = await chatApi.removeFolder(folderId);
      if (!result.success) return void toast.error(result.error ?? "");
      await afterDelete(inFolder);
    },
    [list, afterDelete]
  );

  /** Runs a list change and reloads the list and the open chat. Returns the error, if any. */
  const change = useCallback(
    async (action: () => Promise<{ success: boolean; error?: string; code?: string }>) => {
      const result = await action();
      // A duplicate folder name comes back as code "conflict"; the caller shows it translated.
      if (!result.success)
        return result.code === "conflict" ? "conflict" : (result.error ?? "error");
      await refreshList();
      if (activeId) await open(activeId);
      return null;
    },
    [refreshList, activeId, open]
  );

  return {
    status,
    list,
    projects,
    activeId,
    detail,
    scope,
    setScope,
    pending,
    scopeMissing: !!detail && scope === undefined,
    open,
    newChat,
    ask,
    retry,
    deleteChats,
    deleteFolder,
    change,
  };
}

export type ChatState = ReturnType<typeof useChat>;
