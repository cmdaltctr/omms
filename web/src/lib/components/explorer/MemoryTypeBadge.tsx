import { Badge } from "$lib/components/ui/badge";
import { keywordHue } from "./KeywordBadge";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useI18n } from "$lib/i18n";

/** Present the stored type with the same deterministic colour identity on every card. */
export function MemoryTypeBadge({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <Tooltip content={t("tooltip-memory-type")} className="min-w-0 max-w-full">
      <Badge
        variant="outline"
        data-memory-type={type}
        tabIndex={0}
        className="h-auto min-h-5 max-w-full shrink break-all whitespace-normal bg-transparent border-current [color:oklch(0.42_0.13_var(--memory-type-hue))] dark:[color:oklch(0.8_0.13_var(--memory-type-hue))]"
        style={{ ["--memory-type-hue" as string]: String(keywordHue(type)) }}
      >
        {type}
      </Badge>
    </Tooltip>
  );
}
