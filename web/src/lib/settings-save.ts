import { reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";

/** What a save answers: success or the server's reason, and the revision of the reloaded file. */
export type SaveResult = { success: boolean; error?: string; revision?: string };

/**
 * Save changed keys to the global config. A `null` value removes its key. The snapshot is
 * reloaded after the save, whether it worked or not, so the next save carries the current
 * revision and a conflict shows the file as it is now.
 */
export async function saveSettingEdits(
  revision: string,
  edits: Record<string, unknown>
): Promise<SaveResult> {
  let failure: string | undefined;
  try {
    await settingsRequest("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ revision, edits }),
    });
  } catch (cause) {
    failure = (cause as Error).message;
  }
  const reloaded = await reloadSettingsSnapshot<{ revision?: string }>();
  const fresh = reloaded?.revision;
  return failure === undefined
    ? { success: true, revision: fresh }
    : { success: false, error: failure, revision: fresh };
}
