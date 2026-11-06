import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

export type SpacesLayout = "grid" | "list";

const VIEW_KEY = "omms-spaces-view";

/**
 * The layout of the space cards, saved in this browser. With no saved choice it is a grid.
 * Blocked storage leaves the toggle working for this visit.
 */
export function useSpacesLayout(): [SpacesLayout, (next: SpacesLayout) => void] {
  const [layout, setLayout] = useState<SpacesLayout>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  return [
    layout,
    (next) => {
      setLayout(next);
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        // Storage can be blocked; the toggle still works for this page view.
      }
    },
  ];
}

/** Two icon buttons that choose between the card grid and a list of rows. */
export function SpaceViewToggle({
  layout,
  onChange,
}: {
  layout: SpacesLayout;
  onChange: (next: SpacesLayout) => void;
}) {
  const { t } = useI18n();
  const choices = [
    { value: "grid", label: t("spaces-view-grid"), Icon: LayoutGrid },
    { value: "list", label: t("spaces-view-list"), Icon: List },
  ] as const;
  return (
    <div role="group" aria-label={t("spaces-view-label")} className="flex items-center gap-1">
      {choices.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          size="icon-sm"
          variant={layout === value ? "secondary" : "ghost"}
          aria-label={label}
          aria-pressed={layout === value}
          title={label}
          onClick={() => onChange(value)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
