import { useEffect, useState } from "react";
import { onSpacesChanged } from "$lib/spaces-store";
import { spacesApi, type SpaceRow } from "$lib/spaces-api";
import { useWebStatus } from "$lib/web-status";

/**
 * The spaces for the sidebar tree. The list loads when the active space (from the shared
 * status call) changes, and when the Spaces page announces a change. It has no poll of its own.
 */
export function useSpaceTree() {
  const space = useWebStatus().status?.activeSpace;
  const activeId = space?.id;
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [changes, setChanges] = useState(0);

  useEffect(() => onSpacesChanged(() => setChanges((count) => count + 1)), []);

  useEffect(() => {
    // An older web app sends no active space, and has no spaces to list.
    if (activeId === undefined) return;
    let current = true;
    void spacesApi.list().then((result) => {
      if (current && result.success && result.data) setSpaces(result.data.spaces);
    });
    return () => {
      current = false;
    };
  }, [activeId, changes]);

  return {
    spaces,
    activeId,
    activeName: space?.name,
    customStoragePath: space?.customStoragePath === true,
  };
}
