import { Info } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { evidenceItems } from "$lib/profile-utils";
import type { ProfileItem } from "$lib/types";

type Props = {
  item: ProfileItem;
  onOpen: () => void;
  /** Lets the dialog find this button again after the card list re-renders. */
  focusKey?: string;
};

/** The "N evidence" count on a profile card. Opens the evidence dialog; hidden without evidence. */
export function ProfileEvidenceButton({ item, onOpen, focusKey }: Props) {
  const { t } = useI18n();
  const count = evidenceItems(item).length;
  if (count === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="-mx-1.5 h-5 cursor-pointer px-1.5 text-xs font-normal text-muted-foreground transition-colors duration-200 ease-in hover:bg-transparent hover:text-primary-label focus-visible:text-primary-label"
      aria-haspopup="dialog"
      data-evidence-key={focusKey}
      aria-label={t("evidence-open-label", { count })}
      onClick={onOpen}
    >
      <Info className="size-3" aria-hidden="true" />
      {t("evidence-count", { count })}
    </Button>
  );
}
