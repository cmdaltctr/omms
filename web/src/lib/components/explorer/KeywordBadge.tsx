import { cn } from "$lib/utils";

/** Stable hue for a keyword. Case and spacing do not matter, so one keyword always gets one colour. */
export function keywordHue(keyword: string): number {
  let hash = 0;
  for (const char of keyword.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 360;
}

export function KeywordBadge({
  keyword,
  active = false,
  title,
  onClick,
}: {
  keyword: string;
  active?: boolean;
  title?: string;
  onClick?: (keyword: string) => void;
}) {
  const hue = keywordHue(keyword);
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={() => onClick?.(keyword)}
      className={cn(
        "inline-flex h-5 cursor-pointer items-center rounded-2xl border px-2 text-xs whitespace-nowrap transition-[filter,box-shadow] duration-150 ease-in hover:brightness-125",
        // Dark text on the light theme, light text on the dark theme, so the label stays readable.
        "[color:oklch(0.42_0.13_var(--keyword-hue))] dark:[color:oklch(0.8_0.13_var(--keyword-hue))]",
        active && "ring-2 ring-offset-1 ring-offset-background"
      )}
      style={{
        backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
        borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
        ["--keyword-hue" as string]: String(hue),
        ["--tw-ring-color" as string]: `oklch(0.72 0.14 ${hue} / 0.7)`,
      }}
    >
      {keyword}
    </button>
  );
}
