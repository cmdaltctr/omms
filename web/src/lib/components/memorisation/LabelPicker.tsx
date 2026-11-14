import { useState } from "react";
import { ListFilter } from "lucide-react";
import { LabelPickerDialog } from "./LabelPickerDialog";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

/**
 * The **Filter by label** button above the list. It opens the picker with the current filter and
 * hands the new filter back on Apply.
 */
export function LabelPicker({
  labels,
  onApply,
}: {
  labels: readonly string[];
  onApply: (labels: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListFilter aria-hidden="true" />
        {t("memorisation-picker-open")}
      </Button>
      {open ? (
        <LabelPickerDialog
          labels={labels}
          onApply={(next) => {
            onApply(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
