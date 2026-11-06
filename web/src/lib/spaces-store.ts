// The Spaces page and the sidebar tree show the same list. The page announces each change
// (create, archive, rename, delete, restore, switch), so the tree loads the list again
// without a poll of its own.
const listeners = new Set<() => void>();

export function onSpacesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceSpacesChanged(): void {
  for (const listener of listeners) listener();
}
