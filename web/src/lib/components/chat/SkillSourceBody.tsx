import { useI18n } from "$lib/i18n";
import { formatDate, formatDateOnly } from "$lib/format";
import { historyKindKey, modifiedText } from "$lib/chat-skills";
import type { ChatSkillFacts } from "$lib/chat-api";

const BY_KEY = {
  person: "chat-skill-by-person",
  agent: "chat-skill-by-agent",
  automatic: "chat-skill-by-automatic",
} as const;

/** A skill source: counts in a small list, then up to five recent changes. */
export function SkillSourceBody({ skill }: { skill: ChatSkillFacts }) {
  const { t } = useI18n();
  const facts: Array<[string, string]> = [
    [t("chat-skill-uses"), String(skill.uses)],
    [t("chat-skill-failed"), String(skill.failedTurns)],
    [t("chat-skill-attention"), skill.attention.toFixed(2)],
    [t("chat-skill-modified"), modifiedText(skill, t, formatDateOnly)],
  ];
  return (
    <div className="grid min-w-0 gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {t("chat-skill-window")} {t("chat-skill-modified-note")}
      </p>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("chat-skill-history")}</span>
        {skill.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("chat-skill-history-empty")}</p>
        ) : (
          <ol className="grid gap-2">
            {skill.history.map((entry, i) => (
              <li key={i} className="grid gap-0.5 rounded-lg border border-border p-2 text-xs">
                <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t(historyKindKey(entry.kind))}
                  </span>
                  <span>{formatDate(entry.at)}</span>
                  {entry.appliedBy && entry.appliedBy in BY_KEY ? (
                    <span>{t(BY_KEY[entry.appliedBy as keyof typeof BY_KEY])}</span>
                  ) : null}
                </span>
                <span dir="auto" className="break-words">
                  {entry.summary}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
