import { CircleCheck } from "lucide-react";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { fill } from "$lib/skills-model";

/**
 * A green check for a skill that an applied proposal changed. The tooltip
 * shows on hover and on keyboard focus; the same text is there for screen readers.
 */
export function ModifiedMark({ at, className }: { at: number; className?: string }) {
  const s = useSettingsText();
  const text = fill(s("Modified on {date}"), { date: formatDate(at) });
  return (
    <Tooltip content={text} className={className}>
      <span
        tabIndex={0}
        className="inline-flex rounded-full text-status-success focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CircleCheck className="size-4" aria-hidden="true" />
        <span className="sr-only">{text}</span>
      </span>
    </Tooltip>
  );
}
