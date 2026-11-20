import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Label } from "$lib/components/ui/label";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useSettingsText } from "$lib/i18n/settings";
import {
  formatPrice,
  policyLabelKey,
  type ProviderPolicy,
  type ProviderPrice,
} from "$lib/openrouter-routing";

export type Shown = { slug: string; name: string; policy?: ProviderPolicy; price?: ProviderPrice };

const policyVariant = { zdr: "default", safety: "info", unknown: "warning" } as const;
const VISIBLE_ROWS = 6;

/**
 * A blocked control stays visible. A disabled control gets no hover or focus, so it sits in a
 * focusable span that shows the reason as a tooltip. The caller adds an sr-only line or a
 * visible line with the reason and points the control at it with aria-describedby.
 */
export function Blocked({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex">
        {children}
      </span>
    </Tooltip>
  );
}

/** Height that ends at the bottom of the sixth row. Rows wrap, so it is measured, not fixed. */
function useSixRowHeight(
  listRef: { current: HTMLUListElement | null },
  active: boolean,
  rows: readonly unknown[]
) {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!active || !list) return;
    const measure = () => {
      const row = list.children[VISIBLE_ROWS - 1] as HTMLElement | undefined;
      if (row) setHeight(row.offsetTop + row.offsetHeight);
    };
    measure();
    // A width or language change rewraps the rows. The capped list keeps its size, so watch
    // the six rows as well.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const row of Array.from(list.children).slice(0, VISIBLE_ROWS)) observer.observe(row);
    return () => observer.disconnect();
  }, [listRef, active, rows]);
  return height;
}

export function ProviderRows({
  shown,
  ticked,
  zdr,
  onToggle,
  onRemove,
  lockedReason,
  scrollTopKey,
}: {
  shown: Shown[];
  ticked: string[];
  zdr: boolean;
  onToggle: (slug: string, checked: boolean) => void;
  onRemove: (slug: string) => void;
  /** Set while OpenRouter chooses the provider: every tick is off, and the visible note says why. */
  lockedReason?: string;
  /** The list scrolls to its top when this value changes. */
  scrollTopKey?: number;
}) {
  const s = useSettingsText();
  // Show six rows; the rest scroll inside the list.
  const scroll = shown.length > VISIBLE_ROWS;
  const listRef = useRef<HTMLUListElement>(null);
  const maxHeight = useSixRowHeight(listRef, scroll, shown);
  const locked = lockedReason !== undefined;
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: 0 });
  }, [scrollTopKey]);
  return (
    <ul
      ref={listRef}
      data-scroll={scroll || undefined}
      style={scroll && maxHeight ? { maxHeight } : undefined}
      className={`relative space-y-2 ${scroll ? "overflow-y-auto pe-1" : ""}`}
    >
      {shown.map(({ slug, name, policy, price }) => {
        const id = `openrouter-provider-${slug}`;
        const position = ticked.indexOf(slug) + 1;
        const blocked = zdr && policy === "unknown";
        const off = blocked || locked;
        const reason = s("Not available while Zero data retention only is on.");
        const box = (
          <Checkbox
            id={id}
            checked={position > 0}
            disabled={off}
            aria-describedby={
              locked ? "openrouter-chooses-reason" : blocked ? `${id}-reason` : undefined
            }
            onCheckedChange={(checked) => onToggle(slug, checked === true)}
          />
        );
        return (
          <li
            key={slug}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2"
          >
            {off ? <Blocked reason={locked ? lockedReason : reason}>{box}</Blocked> : box}
            <span className="w-6 shrink-0">
              {position > 0 && (
                <Badge variant="outline" data-position={position} data-slug={slug}>
                  <span className="sr-only">{s("Try position")} </span>
                  {position}
                </Badge>
              )}
            </span>
            <Label
              htmlFor={id}
              className="min-w-0 flex-1 basis-[min(100%,12rem)] flex-wrap gap-x-2 gap-y-0 break-words"
            >
              {policy && <bdi className="font-medium">{name}</bdi>}
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {slug}
              </span>
              {price && (
                <span className="w-full text-xs font-normal text-muted-foreground">
                  <span dir="ltr" data-price={slug}>
                    {formatPrice(price, s)}
                  </span>
                </span>
              )}
            </Label>
            {policy && (
              <Badge variant={policyVariant[policy]} className="ms-auto">
                {s(policyLabelKey(policy))}
              </Badge>
            )}
            {blocked && !locked && (
              <span id={`${id}-reason`} className="sr-only">
                {reason}
              </span>
            )}
            {!policy && (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={locked}
                aria-label={`${s("Remove provider")} ${slug}`}
                onClick={() => onRemove(slug)}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
