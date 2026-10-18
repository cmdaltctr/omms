import { HostAvatar, SharedMark } from "$lib/components/memory/HostAvatar";
import type { MemorySidebarSection } from "$lib/components/memory/MemorySidebarLinks";
import { useHostLooks, type HostLooks } from "./host-looks";
import { translateSettings } from "./i18n/settings";
import { MEMORY_SECTIONS, SHARED_ROWS } from "./memory-sections";
import { usePath } from "./router";
import { memoryViewFromPath } from "./routes";
import { useWriteHealthValue } from "./write-health-store";

type Language = "en" | "zh" | "ar";

/**
 * The Memory views under the Memory entry: an icon for each (the host avatar, or
 * the Shared mark), a dot on the hosts while memories cannot be saved, and the
 * contents list of the Shared rows.
 */
export function memorySidebarSections(
  language: Language,
  looks: HostLooks,
  notSaving: boolean
): MemorySidebarSection[] {
  return MEMORY_SECTIONS.map((section) => {
    const label = translateSettings(section.title, language);
    if (section.id === "shared") {
      return {
        id: section.id,
        label,
        avatar: <SharedMark className="size-5 rounded-md" iconClassName="size-3" />,
        items: SHARED_ROWS.map((row) => ({
          id: row.id,
          label: translateSettings(row.title, language),
        })),
      };
    }
    return {
      id: section.id,
      label,
      avatar: (
        <HostAvatar
          host={section.id}
          look={looks[section.id]}
          className="size-5 rounded-md text-[9px]"
        />
      ),
      warning: notSaving,
    };
  });
}

/** What the sidebar needs for the Memory views: the one on screen, the icons and the write-health dot. */
export function useMemorySidebar(language: Language): {
  memoryViewId: string | null;
  memoryWarningLabel: string;
  memorySections: MemorySidebarSection[];
} {
  const { looks } = useHostLooks();
  const health = useWriteHealthValue();
  return {
    memoryViewId: memoryViewFromPath(usePath().split("#")[0]),
    memoryWarningLabel: translateSettings("Memories not saved", language),
    memorySections: memorySidebarSections(language, looks, health?.ok === false),
  };
}
