import { useEffect, useState } from "react";
import "../settings/settings.css";
import { MEMORY_SECTIONS, type MemorySectionId } from "$lib/memory-sections";
import { revealPageAnchor } from "$lib/settings-navigation";
import { navigate, ROUTES } from "$lib/router";
import { ImportSection } from "./ImportSection";
import { AutoImportSection } from "./AutoImportSection";
import { ProfileCatchUpSection } from "./ProfileCatchUpSection";
import { MemorySection } from "./MemorySection";
import { DirectoryMapsSection } from "./DirectoryMapsSection";

export function MemoryView() {
  const [profilePreset, setProfilePreset] = useState(0);
  useEffect(() => {
    revealPageAnchor(window.location.hash);
  }, []);
  function reanalyse() {
    setProfilePreset((value) => value + 1);
    navigate(`${ROUTES.memory}#memory-section-import`);
  }
  const cards: Record<MemorySectionId, React.ReactNode> = {
    "memory-section-import": <ImportSection profilePreset={profilePreset} />,
    "memory-section-auto-import": <AutoImportSection />,
    "memory-section-profile": <ProfileCatchUpSection onReanalyse={reanalyse} />,
    "memory-section-limits": <MemorySection />,
    "memory-section-project-folders": <DirectoryMapsSection />,
  };
  return (
    <div className="settings-view space-y-8">
      {MEMORY_SECTIONS.map(({ id }) => (
        <div key={id} id={id} className="scroll-mt-20 md:scroll-mt-4">
          {cards[id]}
        </div>
      ))}
    </div>
  );
}
