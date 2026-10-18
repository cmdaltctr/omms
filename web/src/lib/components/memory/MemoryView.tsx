import { useEffect, useState } from "react";
import "../settings/settings.css";
import { revealPageAnchor } from "$lib/settings-navigation";
import { memoryViewFromPath } from "$lib/routes";
import { navigate, ROUTES, usePath } from "$lib/router";
import { HostView } from "./HostView";
import { MemoryOverview } from "./MemoryOverview";
import { SharedView } from "./SharedView";
import { useHostStatuses } from "./use-host-statuses";

/** The Memory page: the overview, one host's view, or the Shared view, by path. */
export function MemoryView() {
  const view = memoryViewFromPath(usePath().split("#")[0]);
  const statuses = useHostStatuses();
  const [profilePreset, setProfilePreset] = useState(0);
  useEffect(() => {
    revealPageAnchor(window.location.hash);
  }, [view]);
  // Re-analysing chat history starts from the all-hosts import on the overview.
  function reanalyse() {
    setProfilePreset((value) => value + 1);
    navigate(ROUTES.memory);
  }
  return (
    <div className="settings-view">
      {view === null && <MemoryOverview statuses={statuses} profilePreset={profilePreset} />}
      {view === "shared" && <SharedView statuses={statuses} onReanalyse={reanalyse} />}
      {view !== null && view !== "shared" && (
        <HostView host={view} statuses={statuses} profilePreset={profilePreset} />
      )}
    </div>
  );
}
