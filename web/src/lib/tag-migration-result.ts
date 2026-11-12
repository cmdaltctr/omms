/** The last batch reply of a tagging run (`/api/migration/tags/run-batch`). */
export interface TagMigrationResult {
  processed: number;
  total: number;
  hasMore: boolean;
  tagged?: number;
  failed?: number;
  errorKind?: "no_credit" | "auth" | "other";
  error?: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The words the dialog shows when a run did not tag every memory, or null when
 * it did. A run with failures is never reported as a success.
 */
export function tagMigrationFailure(
  result: TagMigrationResult,
  t: Translate
): { message: string; reason?: string } | null {
  const failed = result.failed ?? 0;
  if (failed === 0) return null;
  const params = { tagged: result.tagged ?? 0, total: result.total, failed };
  const key =
    result.errorKind === "no_credit"
      ? "tag-migration-no-credit"
      : result.errorKind === "auth"
        ? "tag-migration-auth"
        : "tag-migration-partial";
  return {
    message: t(key, params),
    ...(result.error ? { reason: t("tag-migration-reason", { error: result.error }) } : {}),
  };
}
