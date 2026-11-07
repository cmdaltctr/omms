import { resolve } from "node:path";
import { resettable } from "./store-handles.js";
import { openSpaceStore } from "./space-store.js";
import type { SpaceReadStore } from "./space-store.js";

const cache = new Map<string, SpaceReadStore>();

/**
 * The process-wide cached read store of a space folder (design D2). A linked space
 * is searched often and its folder rarely changes, so the store is opened once and
 * reused. A reset (a space switch) or an explicit close drops it; the next call
 * reopens the folder.
 */
export function getCachedSpaceReadStore(folder: string): SpaceReadStore {
  const key = resolve(folder);
  let store = cache.get(key);
  if (!store) {
    store = openSpaceStore(key, "read");
    cache.set(key, store);
  }
  return store;
}

/** Closes and forgets the cached read store of one folder, for example before a delete. */
export async function closeCachedSpaceReadStore(folder: string): Promise<void> {
  const key = resolve(folder);
  const store = cache.get(key);
  cache.delete(key);
  if (store) await store.close();
}

/** Closes every cached read store. Registered with `resettable`, so a space switch runs it. */
export async function closeAllCachedSpaceReadStores(): Promise<void> {
  const stores = [...cache.values()];
  cache.clear();
  await Promise.all(stores.map((store) => store.close()));
}

export const spaceReadStoreCache = resettable("space-read-stores", cache, () =>
  closeAllCachedSpaceReadStores()
);
