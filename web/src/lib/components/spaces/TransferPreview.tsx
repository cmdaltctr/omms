import { useI18n } from "$lib/i18n";

export type TransferPreviewGroup = { name: string; count: number };
export type TransferPreviewExample = { id: string; text: string };
/** The `data.preview` of `POST /api/spaces/transfer/preview`: what this filter would transfer. */
export type TransferPreviewData = {
  /** Source rows that match the filter. */
  matched: number;
  /** Rows a copy would write: matched minus exact duplicates. */
  toCopy: number;
  /** Exact duplicates the target already holds; a transfer skips them. */
  duplicates: number;
  groups: TransferPreviewGroup[];
  examples: TransferPreviewExample[];
};

/**
 * The preview of one transfer filter: the match count, the source projects with a count each, up
 * to five examples and the duplicates that would be skipped. Shown inside the TransferDialog;
 * a preview never changes either space.
 */
export function TransferPreview({ preview }: { preview: TransferPreviewData }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm" data-slot="transfer-preview">
      <p className="font-medium">
        {preview.matched === 0
          ? t("spaces-transfer-preview-empty")
          : t("spaces-transfer-preview-count", { count: preview.matched })}
      </p>
      {preview.groups.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("spaces-transfer-preview-projects-label")}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {preview.groups.map((group) => (
              <li key={group.name} className="break-words">
                <bdi>
                  {t("spaces-transfer-preview-project-count", {
                    project: group.name,
                    count: group.count,
                  })}
                </bdi>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.examples.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("spaces-transfer-preview-examples-label")}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {preview.examples.map((example) => (
              <li key={example.id} className="break-words">
                <bdi>{example.text}</bdi>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("spaces-transfer-preview-duplicates", { count: preview.duplicates })}
      </p>
    </div>
  );
}
