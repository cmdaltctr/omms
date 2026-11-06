import { useEffect, useState } from "react";
import { useWebStatus } from "$lib/web-status";
import type { useMemoriesExplorer } from "./useMemoriesExplorer";
import type { useUserProfile } from "./useUserProfile";

type Explorer = Pick<
  ReturnType<typeof useMemoriesExplorer>,
  "loadTags" | "loadStats" | "checkMigrationStatus" | "onTagFilterChange"
>;
type Profile = Pick<ReturnType<typeof useUserProfile>, "userProfile" | "loadUserProfile">;

/**
 * Reloads the memories, the tag list and the profile when the active space changes, whether
 * the switch came from this page or from the CLI. Returns a number that changes with each
 * switch; use it as a `key` to remount a view that loads its own data, such as Chat.
 */
export function useSpaceReload(explorer: Explorer, profile: Profile): number {
  const id = useWebStatus().status?.activeSpace?.id;
  const [seen, setSeen] = useState<string | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (id === undefined || id === seen) return;
    setSeen(id);
    // The first answer only records the space. Later changes are switches.
    if (seen === undefined) return;
    setEpoch((value) => value + 1);
    void explorer.loadTags();
    void explorer.loadStats();
    void explorer.checkMigrationStatus();
    // Drops the tag, search and page of the old space, then loads the first page again.
    explorer.onTagFilterChange("");
    if (profile.userProfile) void profile.loadUserProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the space id only
  }, [id]);

  return epoch;
}
