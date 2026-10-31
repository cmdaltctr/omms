import { keywordHue } from "$lib/components/explorer/KeywordBadge";
import { cn } from "$lib/utils";

/**
 * A static label in the colour its text always gets, like the keyword badges.
 * `colourKey` fixes the hue when the shown text is translated.
 */
export function HuePill({
  label,
  colourKey = label,
  className,
}: {
  label: string;
  colourKey?: string;
  className?: string;
}) {
  const hue = keywordHue(colourKey);
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-[7px] border px-2 text-xs break-words",
        "[color:oklch(0.42_0.13_var(--keyword-hue))] dark:[color:oklch(0.8_0.13_var(--keyword-hue))]",
        className
      )}
      style={{
        backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
        borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
        ["--keyword-hue" as string]: String(hue),
      }}
    >
      {label}
    </span>
  );
}
