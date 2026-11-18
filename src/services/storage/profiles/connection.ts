import {
  tursoConnectionManager,
  type TursoConnectionManager,
} from "../../turso/connection-manager.js";
import type { TursoDb } from "../../turso/turso-db.js";

export const USER_PROFILES_DB_NAME = "user-profiles.db";

/** The database handle the profile store and changelog use. */
export type ProfileDb = TursoDb;

/**
 * The connection pool a store opens its files through. Callers treat it as opaque: they get one
 * from a space store and pass it on, so a rooted manager opens files only under its own root.
 */
export type StoreConnections = TursoConnectionManager;

/** Opens `user-profiles.db` at `dbPath`, through `connections` or the shared pool. */
export function openProfileDb(dbPath: string, connections?: StoreConnections): Promise<ProfileDb> {
  return (connections ?? tursoConnectionManager).getConnection(dbPath);
}
