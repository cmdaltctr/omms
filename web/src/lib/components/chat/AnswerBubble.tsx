import { Info, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { citedLabels, splitCitations } from "$lib/chat-citations";
import type { ChatMessage, ChatSource } from "$lib/chat-api";
import { CitationChip } from "./CitationChip";
import { SearchDetails } from "./SearchDetails";

type Props = {
  message: ChatMessage;
  missingMemoryIds: Set<string>;
  readOnly: boolean;
  onOpenSource: (source: ChatSource) => void;
  onRetry: (message: ChatMessage) => void;
};

const NOTICE_KEY = {
  no_sources: "chat-no-sources",
  insufficient: "chat-insufficient",
  uncited: "chat-uncited",
} as const;

/** One answer: text with citation chips, its notices, the cited sources, and how it searched. */
export function AnswerBubble({
  message,
  missingMemoryIds,
  readOnly,
  onOpenSource,
  onRetry,
}: Props) {
  const { t } = useI18n();
  const labels = message.sources.map((source) => source.label);
  const byLabel = new Map(message.sources.map((source) => [source.label, source]));
  const isDeleted = (source?: ChatSource) =>
    !!source && source.kind === "memory" && missingMemoryIds.has(source.id);
  const cited = citedLabels(message.content, labels)
    .map((label) => byLabel.get(label))
    .filter((source): source is ChatSource => !!source);

  return (
    <article className="grid min-w-0 gap-2.5">
      {message.errorCode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive-label">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t("chat-error", { code: message.errorCode })}</span>
          {readOnly ? null : (
            <Button type="button" variant="outline" size="xs" onClick={() => onRetry(message)}>
              <RotateCw />
              {t("chat-retry")}
            </Button>
          )}
        </div>
      ) : null}

      {message.content ? (
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7">
          {splitCitations(message.content, labels).map((part, i) =>
            part.kind === "text" ? (
              <span key={i}>{part.text}</span>
            ) : (
              <CitationChip
                key={i}
                label={part.label}
                deleted={isDeleted(byLabel.get(part.label))}
                onOpen={() => onOpenSource(byLabel.get(part.label)!)}
              />
            )
          )}
        </p>
      ) : null}

      {message.notice ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t(NOTICE_KEY[message.notice])}
        </p>
      ) : null}

      {cited.length ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("chat-sources")}</span>
          <ul className="grid gap-1">
            {cited.map((source) => (
              <li key={source.label} className="flex min-w-0 items-start gap-2 text-xs">
                <CitationChip
                  label={source.label}
                  deleted={isDeleted(source)}
                  onOpen={() => onOpenSource(source)}
                />
                <span
                  dir="auto"
                  className="min-w-0 flex-1 truncate leading-5 text-muted-foreground"
                >
                  {source.projectName ? `${source.projectName} · ` : ""}
                  {source.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.plan ? <SearchDetails plan={message.plan} /> : null}
    </article>
  );
}
