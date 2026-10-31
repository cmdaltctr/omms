import { useMemo } from "react";
import { Info, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { linkCitations } from "$lib/chat-answer-html";
import { citedLabels } from "$lib/chat-citations";
import { isSourceDeleted } from "$lib/chat-skills";
import { renderMarkdown } from "$lib/markdown";
import type { ChatMessage, ChatSource } from "$lib/chat-api";
import { CitationChip } from "./CitationChip";
import { SearchDetails } from "./SearchDetails";

type Props = {
  message: ChatMessage;
  missingMemoryIds: Set<string>;
  missingSkillNames: Set<string>;
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
  missingSkillNames,
  readOnly,
  onOpenSource,
  onRetry,
}: Props) {
  const { t } = useI18n();
  const labels = message.sources.map((source) => source.label);
  const byLabel = new Map(message.sources.map((source) => [source.label, source]));
  const isDeleted = (source?: ChatSource) =>
    isSourceDeleted(source, missingMemoryIds, missingSkillNames);
  const html = useMemo(
    () =>
      linkCitations(
        renderMarkdown(message.content),
        labels,
        (label) => isDeleted(byLabel.get(label)),
        (label) => t("chat-cite-label", { label })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.content, message.sources, missingMemoryIds, missingSkillNames, t]
  );
  const openCited = (event: React.MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-cite]");
    const source = button ? byLabel.get(button.dataset.cite ?? "") : undefined;
    if (source) onOpenSource(source);
  };
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
        <div
          dir="auto"
          className="markdown-content chat-answer break-words text-sm leading-7"
          onClick={openCited}
          dangerouslySetInnerHTML={{ __html: html }}
        />
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
                  {source.kind === "skill"
                    ? source.id
                    : `${source.projectName ? `${source.projectName} · ` : ""}${source.text}`}
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
