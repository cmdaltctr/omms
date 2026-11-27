import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { PathMap } from "$lib/external-api-settings";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";

/** What a directory-map save answers: undefined once saved, else the failure message. */
type Save = () => Promise<string | undefined>;

/**
 * Puts the Directory maps saves behind the shared confirm dialog. Save removals lists how many
 * saved maps remain; Ignore and Restore each name the folder in one sentence. `run` is the card's
 * existing save, unchanged, and its failure message reaches the dialog. Render `dialog` once.
 */
export function useDirectoryMapConfirm() {
  const s = useSettingsText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const mapCount = (value: unknown) => {
    const count = Array.isArray(value) ? value.length : 0;
    return count === 1 ? s("1 map") : fill(s("{count} maps"), { count });
  };
  const fields = [{ key: "importPathMaps", label: name("importPathMaps"), print: mapCount }];
  const answer = async (run: Save) => {
    const failure = await run();
    return failure === undefined ? { success: true } : { success: false, error: s(failure) };
  };
  const askFolder = (
    title: string,
    sentence: string,
    confirmLabel: string,
    folder: string,
    run: Save
  ) =>
    ask({
      title,
      body: (
        <p>
          <bdi>{folder}</bdi>. {sentence}
        </p>
      ),
      confirmLabel,
      busyLabel: s("Saving…"),
      run: () => answer(run),
    });

  return {
    dialog,
    /** Save removals: the count of saved maps before and after. */
    askRemovals: (saved: readonly PathMap[], edits: readonly PathMap[], run: Save) =>
      ask({
        title: s("Save removals?"),
        body: (
          <SettingsChangeList
            changes={changes({ importPathMaps: saved }, { importPathMaps: edits }, fields)}
          />
        ),
        confirmLabel: s("Save removals"),
        busyLabel: s("Saving…"),
        run: () => answer(run),
      }),
    askIgnore: (folder: string, run: Save) =>
      askFolder(
        s("Ignore this folder?"),
        s("The folder stays unimported and leaves the unresolved counts."),
        s("Ignore"),
        folder,
        run
      ),
    askRestore: (folder: string, run: Save) =>
      askFolder(
        s("Restore this folder?"),
        s("The folder shows again in each host list that reported it."),
        s("Restore"),
        folder,
        run
      ),
  };
}
