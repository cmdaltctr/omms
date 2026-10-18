import { Loader } from "lucide-react";
import { useI18n } from "$lib/i18n";
import type { ChatMessage, ChatSource } from "$lib/chat-api";
import { AnswerBubble } from "./AnswerBubble";

type Props = {
  messages: ChatMessage[];
  /** A question on its way to the server, shown until the answer arrives. */
  pending: string | null;
  missingMemoryIds: Set<string>;
  readOnly: boolean;
  onOpenSource: (source: ChatSource) => void;
  onRetry: (message: ChatMessage) => void;
};

function Question({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-secondary px-3.5 py-2.5">
        <span className="sr-only">{t("chat-you")}: </span>
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6">
          {text}
        </p>
      </div>
    </div>
  );
}

/** The questions and answers of one chat, oldest first. */
export function MessageThread({
  messages,
  pending,
  missingMemoryIds,
  readOnly,
  onOpenSource,
  onRetry,
}: Props) {
  const { t } = useI18n();
  if (messages.length === 0 && !pending) {
    return (
      <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
        {t("chat-empty-thread")}
      </p>
    );
  }
  return (
    <ol className="grid gap-6" aria-live="polite">
      {messages.map((message) => (
        <li key={message.id}>
          {message.role === "user" ? (
            <Question text={message.content} />
          ) : (
            <AnswerBubble
              message={message}
              missingMemoryIds={missingMemoryIds}
              readOnly={readOnly}
              onOpenSource={onOpenSource}
              onRetry={onRetry}
            />
          )}
        </li>
      ))}
      {pending ? (
        <li className="grid gap-4">
          {messages.at(-1)?.role === "user" && messages.at(-1)?.content === pending ? null : (
            <Question text={pending} />
          )}
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("chat-thinking")}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
