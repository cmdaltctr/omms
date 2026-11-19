import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

type Props = {
  children: ReactNode;
  /**
   * Height classes of the folded box, for example `h-[24rem] lg:h-[22rem]`. The box keeps this
   * height even when the content is shorter, so cards side by side line up.
   */
  collapsedClassName: string;
  /** CSS colour the fade ends in. Match the surface behind the content. */
  fade?: string;
};

export function CollapsibleContent({ children, collapsedClassName, fade = "var(--card)" }: Props) {
  const { t } = useI18n();
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || expanded) return;
    // Measure only while folded: the box then has its fixed height.
    const measure = () => setOverflows(content.offsetHeight > box.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(box);
    return () => observer.disconnect();
  }, [expanded]);

  const collapsed = !expanded;
  return (
    <div className="flex flex-col gap-2">
      <div
        id={id}
        ref={boxRef}
        className={`relative overflow-hidden ${collapsed ? collapsedClassName : ""}`}
        data-collapsed={collapsed && overflows ? "true" : undefined}
      >
        <div ref={contentRef}>{children}</div>
        {collapsed && overflows ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{ background: `linear-gradient(to top, ${fade}, transparent)` }}
          />
        ) : null}
      </div>
      {/* The row keeps its space without a button, so every card stays the same height. */}
      <div className={`h-6 ${overflows || expanded ? "" : "invisible"}`}>
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
      </div>
    </div>
  );
}
