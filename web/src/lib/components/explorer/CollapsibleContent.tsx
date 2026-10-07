import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

type Props = {
  children: ReactNode;
  /** Collapsed height in px. Content shorter than this shows no button. */
  maxHeight: number;
  /** CSS colour the fade ends in. Match the surface behind the content. */
  fade?: string;
};

export function CollapsibleContent({ children, maxHeight, fade = "var(--card)" }: Props) {
  const { t } = useI18n();
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.offsetHeight > maxHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeight]);

  const collapsed = overflows && !expanded;
  return (
    <div className="space-y-2">
      <div
        id={id}
        className="relative overflow-hidden"
        style={collapsed ? { maxHeight } : undefined}
        data-collapsed={collapsed ? "true" : undefined}
      >
        <div ref={contentRef}>{children}</div>
        {collapsed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{ background: `linear-gradient(to top, ${fade}, transparent)` }}
          />
        ) : null}
      </div>
      {overflows ? (
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? t("btn-see-less") : t("btn-see-more")}
        </Button>
      ) : null}
    </div>
  );
}
