import { canonicaliseCategories } from "../services/user-profile/profile-category.js";
import type { UserProfileData } from "../services/user-profile/types.js";

const usage = `Usage: om-memory-system profile-normalise-categories [options]

Preview category renames in the active user profile. No model calls are made.
Without --yes, nothing is saved.

Options:
  --yes       Save the category renames through the profile changelog
  --dry-run   Preview only, even with --yes
  --help      Show this help`;

/** Preview or confirm a category-only repair of the current user's profile. */
export async function runProfileNormaliseCategoriesCommand(
  argv: string[],
  print: (line: string) => void = console.log
): Promise<number> {
  for (const option of argv) {
    if (!["--yes", "--dry-run", "--help", "-h"].includes(option)) {
      print(`Unknown option ${option}; use --help`);
      return 1;
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    print(usage);
    return 0;
  }
  const save = argv.includes("--yes") && !argv.includes("--dry-run");
  const { CONFIG, initConfig, initConfigWithLegacyMigration } = await import("../config.js");
  try {
    if (save) initConfigWithLegacyMigration(process.cwd());
    else initConfig(process.cwd());
    const { resolveWebProfileUserId } = await import("../services/profile-identity.js");
    const userId = await resolveWebProfileUserId(CONFIG);
    if (!userId) throw new Error("Unable to resolve user identity");
    const { userProfileManager } = await import("../services/user-profile/user-profile-manager.js");
    const profile = await userProfileManager.getActiveProfile(userId);
    if (!profile) {
      print("No active profile found. Changes: 0");
      return 0;
    }
    const before: UserProfileData = JSON.parse(profile.profileData);
    const after = canonicaliseCategories(before);
    const renames = new Map<string, { old: string; label: string; count: number }>();
    let changes = 0;
    for (const [type, heading] of [
      ["preferences", "Preference"],
      ["patterns", "Pattern"],
    ] as const) {
      const oldItems = before[type];
      const newItems = after[type];
      print(
        `${heading} categories: ${new Set(oldItems.map((item) => item.category)).size} -> ${new Set(newItems.map((item) => item.category)).size}`
      );
      oldItems.forEach((item, index) => {
        const label = newItems[index]!.category;
        if (item.category === label) return;
        const key = JSON.stringify([item.category, label]);
        const rename = renames.get(key) ?? { old: item.category, label, count: 0 };
        rename.count++;
        renames.set(key, rename);
        changes++;
      });
    }
    for (const rename of renames.values()) {
      print(`${JSON.stringify(rename.old)} -> ${JSON.stringify(rename.label)}: ${rename.count}`);
    }
    print(`Changes: ${changes}`);
    if (changes === 0) return 0;
    if (!save) {
      print("Preview only. Run again with --yes to save.");
      return 0;
    }
    const saved = await userProfileManager.updateProfile(
      profile.id,
      after,
      0,
      `Normalised profile categories: ${changes} items renamed`,
      profile.version
    );
    if (!saved) throw new Error("Profile was modified by another session. Please retry.");
    print("Category renames saved. The previous snapshot remains in the profile changelog.");
    return 0;
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (CONFIG.memoryApiKey) message = message.replaceAll(CONFIG.memoryApiKey, "[redacted]");
    print(`Profile category repair failed: ${message}`);
    return 1;
  }
}
