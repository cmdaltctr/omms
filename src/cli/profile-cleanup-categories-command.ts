import type { CleanupDeps } from "../services/user-profile/category-cleanup.js";

const usage = `Usage: om-memory-system profile-cleanup-categories [options]

Group profile category names that mean the same thing and preview one name per group.
Without --yes, nothing is saved. Applying only renames categories; no memory is
changed, merged or removed.

Options:
  --yes       Apply every group in the preview
  --undo      Undo the last category cleanup
  --help      Show this help`;

const MERGE_NOTE =
  "After a cleanup more memories share a category, so later learning merges near-duplicate memories more readily.";

/** Preview, apply or undo a meaning-based cleanup of the current user's profile categories. */
export async function runProfileCleanupCategoriesCommand(
  argv: string[],
  print: (line: string) => void = console.log,
  deps?: CleanupDeps
): Promise<number> {
  for (const option of argv) {
    if (!["--yes", "--undo", "--help", "-h"].includes(option)) {
      print(`Unknown option ${option}; use --help`);
      return 1;
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    print(usage);
    return 0;
  }
  const undo = argv.includes("--undo");
  const save = argv.includes("--yes") || undo;
  const { CONFIG, initConfig, initConfigWithLegacyMigration } = await import("../config.js");
  try {
    if (save) initConfigWithLegacyMigration(process.cwd());
    else initConfig(process.cwd());
    const { resolveWebProfileUserId } = await import("../services/profile-identity.js");
    const userId = await resolveWebProfileUserId(CONFIG);
    if (!userId) throw new Error("Unable to resolve user identity");
    const cleanup = await import("../services/user-profile/category-cleanup.js");

    if (undo) {
      const result = await cleanup.undoCategoryCleanup(userId, deps);
      if (result.ok) {
        print(`Restored ${result.restored} items; ${result.notFound} not found.`);
        return 0;
      }
      if (result.error === "nothing_to_undo") {
        print("Nothing to undo.");
        return 0;
      }
      throw new Error("Profile changed. Try the undo again.");
    }

    const preview = await cleanup.previewCategoryCleanup(userId, {
      ...deps,
      onProgress: (done, total) => {
        if (total > 0) print(`Checking groups with the profile model: batch ${done} of ${total}`);
      },
    });
    if (!preview) {
      print("No active profile found.");
      return 0;
    }
    print(`Categories: ${preview.before} -> ${preview.after}`);
    for (const group of preview.groups) {
      const labels = group.labels.map((entry) => `${JSON.stringify(entry.label)} (${entry.count})`);
      print(
        `${JSON.stringify(group.name)} <- ${labels.join(", ")}${group.checked ? "" : " (not checked by the model)"}`
      );
    }
    print(`Groups: ${preview.groups.length}`);
    if (preview.groups.length === 0) return 0;
    print(MERGE_NOTE);
    if (!argv.includes("--yes")) {
      print("Preview only. Run again with --yes to apply every group.");
      return 0;
    }
    const result = await cleanup.applyCategoryCleanup(
      userId,
      {
        groups: preview.groups.map((group) => ({
          labels: group.labels.map((entry) => entry.label),
          name: group.name,
        })),
      },
      deps
    );
    if (!result.ok)
      throw new Error(`Cleanup not applied (${result.error}). Run the command again.`);
    print(`Renamed ${result.renamed} items.`);
    return 0;
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (CONFIG.memoryApiKey) message = message.replaceAll(CONFIG.memoryApiKey, "[redacted]");
    print(`Profile category cleanup failed: ${message}`);
    return 1;
  }
}
