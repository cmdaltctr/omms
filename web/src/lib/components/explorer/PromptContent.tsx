import { Fragment } from "react";
import { useI18n } from "$lib/i18n";
import { splitInlineCode, splitPrompt } from "$lib/prompt-segments";

function CodeCard({ label, children }: { label?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background/60">
      {label ? (
        <div className="border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      ) : null}
      <pre
        dir="ltr"
        className="overflow-x-auto p-3 font-mono text-code leading-relaxed whitespace-pre-wrap break-words"
      >
        {children}
      </pre>
    </div>
  );
}

/** Renders a stored user prompt. Commands and pasted terminal output get code styling. */
export function PromptContent({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {splitPrompt(content).map((segment, i) => {
        if (segment.kind === "pasted") {
          return (
            <CodeCard key={i} label={t("label-pasted-content")}>
              {segment.text}
            </CodeCard>
          );
        }
        if (segment.kind === "code") return <CodeCard key={i}>{segment.text}</CodeCard>;
        return (
          <p key={i} className="text-sm whitespace-pre-wrap break-words">
            {splitInlineCode(segment.text).map((part, j) =>
              part.code ? (
                <code key={j} className="inline-code">
                  {part.text}
                </code>
              ) : (
                <Fragment key={j}>{part.text}</Fragment>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}
