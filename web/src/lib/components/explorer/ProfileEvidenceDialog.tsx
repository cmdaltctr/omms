import { useRef } from "react";
import { PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { ScrollArea } from "$lib/components/ui/scroll-area";
import { useI18n } from "$lib/i18n";
import { evidenceItems } from "$lib/profile-utils";
import type { ProfileItem } from "$lib/types";

type ProfileSection = "preferences" | "patterns" | "workflows";

const SECTION_LABEL = {
  preferences: "profile-preferences",
  patterns: "profile-patterns",
  workflows: "profile-workflows",
} as const;

type BodyProps = { item: ProfileItem; section: ProfileSection };

/** The dialog's content, kept free of the dialog primitive so it renders on its own in tests. */
export function ProfileEvidenceBody({ item, section }: BodyProps) {
  const { t, language } = useI18n();
  const items = evidenceItems(item);
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          {t(SECTION_LABEL[section])}
          {item.category ? ` · ${item.category}` : null}
        </span>
        <p dir="auto" className="text-sm leading-6 break-words">
          {item.description}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("evidence-hit-count", { count: item.frequency || 1 })}
        </p>
      </div>
      {/* Radix scroll areas default to left-to-right, so pass the page direction. */}
      <ScrollArea
        dir={language === "ar" ? "rtl" : "ltr"}
        className="max-h-[50vh] rounded-lg border"
      >
        <ol className="flex flex-col divide-y">
          {items.map((entry, i) => (
            <li key={i} className="flex gap-3 px-3 py-2.5 text-sm leading-6">
              <span className="w-5 shrink-0 text-end text-xs leading-6 text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              {entry.kind === "manual-write" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground italic">
                  <PenLine className="size-3.5" aria-hidden="true" />
                  {t("evidence-manual-write")}
                </span>
              ) : (
                <span dir="auto" className="min-w-0 whitespace-pre-wrap break-words">
                  {entry.text}
                </span>
              )}
            </li>
          ))}
        </ol>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">{t("evidence-note")}</p>
    </div>
  );
}

type Props = {
  item: ProfileItem | null;
  section: ProfileSection;
  /** `data-evidence-key` of the button that opened the dialog. */
  focusKey?: string | null;
  onOpenChange: (open: boolean) => void;
};

/** Lists the evidence behind one profile item. Open while `item` is set. */
export function ProfileEvidenceDialog({ item, section, focusKey, onOpenChange }: Props) {
  const { t } = useI18n();
  // Closing clears `focusKey` before Radix restores focus, so keep the last one.
  const lastFocusKey = useRef<string | null>(null);
  if (focusKey) lastFocusKey.current = focusKey;
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // ProfileView rebuilds its cards when this dialog opens, so the
          // original button is gone; focus its replacement by key.
          const key = lastFocusKey.current;
          const button = key
            ? document.querySelector<HTMLElement>(`[data-evidence-key="${CSS.escape(key)}"]`)
            : null;
          if (!button) return;
          event.preventDefault();
          button.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("evidence-dialog-title")}</DialogTitle>
          <DialogDescription className="sr-only">{item?.description}</DialogDescription>
        </DialogHeader>
        {item ? <ProfileEvidenceBody item={item} section={section} /> : null}
      </DialogContent>
    </Dialog>
  );
}
