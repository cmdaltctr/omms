import { Search } from "lucide-react";
import { useI18n } from "$lib/i18n";
import type { ChatPlan } from "$lib/chat-api";

/** "How I searched": the phrases, tags and profile categories the plan used. */
export function SearchDetails({ plan }: { plan: ChatPlan }) {
  const { t } = useI18n();
  const rows: Array<[string, string[]]> = [
    [t("chat-search-phrases"), plan.queries],
    [t("chat-search-tags"), plan.tags],
    [t("chat-search-categories"), plan.profileCategories],
  ];
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 transition-colors duration-200 ease-in hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Search className="size-3" aria-hidden="true" />
        {t("chat-how-searched")}
      </summary>
      <div className="mt-2 grid gap-1.5 rounded-lg border border-border p-2.5">
        {plan.skipped ? <p>{t("chat-plan-skipped")}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map(([label, values]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd dir="auto" className="min-w-0 break-words text-foreground">
                {values.length ? values.join(" · ") : t("chat-none")}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
