import { join } from "node:path";
import {
  resettable,
  tursoConnectionManager,
  type TursoConnectionManager,
} from "../turso/connection-manager.js";
import { CONFIG } from "../../config.js";
import type { EmbeddingService } from "../embedding.js";
import { log } from "../logger.js";
import type { UserProfile, UserProfileChangelog, UserProfileData } from "./types.js";
import type { ColdBuffer, ColdBuffers } from "./profile-cold-buffer.js";
import { getColdBuffer, loadColdBuffers, saveColdBuffers } from "./profile-cold-buffer.js";
import { syncConfidence } from "./profile-confidence.js";
import { decayInMemory } from "./profile-decay.js";
import { detectConflicts } from "./profile-dedupe.js";
import { evolveAndUpdate, evolveDescription } from "./profile-evolve.js";
import { getChangelogById, getProfileChangelogs } from "./profile-history.js";
import type { ProfileHost } from "./profile-host.js";
import { mergeProfileData } from "./profile-merge.js";
import { checkConflict, checkSemanticDuplicate } from "./profile-model-checks.js";
import type { ProfileDb } from "./profile-store.js";
import * as store from "./profile-store.js";

// The manager is a facade. Storage and version history live in profile-store.ts and
// profile-history.ts, merge and dedupe in profile-merge*.ts and profile-dedupe.ts,
// stale-item cleanup in profile-decay.ts, and description rewrites in profile-evolve.ts.

export const USER_PROFILES_DB_NAME = "user-profiles.db";

export class UserProfileManager {
  private db: ProfileDb | null = null;
  private dbPath = "";
  private initPromise: Promise<void> | null = null;
  // Cold-start buffers are keyed by profileId so items observed for one user never
  // drain into another user's merge (cross-user contamination). The unattributed bucket
  // (COLD_BUFFER_DEFAULT_KEY) only holds items from merges that ran without a profileId.
  private coldBuffers!: ColdBuffers;
  private coldBufferPath = "";
  private readonly dedupCheckedCache: Set<string> = new Set();

  /** A rooted manager (profile import, design D1) reads and writes only `root`. */
  constructor(
    private readonly root?: string,
    private readonly connections: TursoConnectionManager = tursoConnectionManager
  ) {
    this.reset();
  }

  reset(): void {
    this.db = null;
    this.initPromise = null;
    this.dedupCheckedCache.clear();
    this.dbPath = join(this.root ?? (CONFIG.storagePath || ""), USER_PROFILES_DB_NAME);
    this.coldBufferPath = join(this.root ?? (CONFIG.storagePath || ""), "cold-buffer.json");
    this.coldBuffers = loadColdBuffers(this.coldBufferPath);
  }

  private async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        this.dbPath = join(this.root ?? (CONFIG.storagePath || ""), USER_PROFILES_DB_NAME);
        this.coldBufferPath = join(this.root ?? (CONFIG.storagePath || ""), "cold-buffer.json");
        this.db = await this.connections.getConnection(this.dbPath);
        await store.createProfileTables(this.db);
      } catch (error) {
        this.initPromise = null;
        this.db = null;
        log("user-profile-manager: db init failed", { error: String(error) }, "error");
        throw error;
      }
    })();

    return this.initPromise;
  }

  private async ready(): Promise<ProfileDb> {
    if (!this.db || !this.initPromise) {
      await this.initialize();
    } else {
      await this.initPromise;
    }

    if (!this.db) throw new Error("UserProfileManager: database not initialized");

    return this.db;
  }

  private getColdBuffer(profileId?: string): ColdBuffer {
    return getColdBuffer(this.coldBuffers, profileId);
  }

  private saveColdBuffers(): void {
    saveColdBuffers(this.coldBufferPath, this.coldBuffers);
  }

  /** The callbacks the merge, dedupe and evolve modules use. */
  private host(): ProfileHost {
    return {
      config: CONFIG,
      dedupCheckedCache: this.dedupCheckedCache,
      getColdBuffer: (profileId) => this.getColdBuffer(profileId),
      saveColdBuffers: () => this.saveColdBuffers(),
      detectConflicts: (items, itemType, profileId) =>
        this.detectConflicts(items, itemType, profileId),
      checkConflict: (descA, descB) => this.checkConflict(descA, descB),
      checkSemanticDuplicate: (descA, descB) => this.checkSemanticDuplicate(descA, descB),
      evolveDescription: (item, itemType, profileId) =>
        this.evolveDescription(item, itemType, profileId),
      evolveAndUpdate: (item, itemType, profileId) =>
        this.evolveAndUpdate(item, itemType, profileId),
    };
  }

  async getActiveProfile(userId: string): Promise<UserProfile | null> {
    return store.getActiveProfile(await this.ready(), userId);
  }

  async createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string> {
    const db = await this.ready();
    return store.createProfile(
      db,
      userId,
      displayName,
      userName,
      userEmail,
      profileData,
      promptsAnalyzed
    );
  }

  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    /** The version the caller read. The save is refused when the stored version differs. */
    expectedVersion: number
  ): Promise<boolean> {
    const db = await this.ready();
    return store.updateProfile(
      db,
      profileId,
      profileData,
      additionalPromptsAnalyzed,
      changeSummary,
      expectedVersion,
      CONFIG
    );
  }

  async getProfileChangelogs(
    profileId: string,
    limit: number = 10
  ): Promise<UserProfileChangelog[]> {
    return getProfileChangelogs(await this.ready(), profileId, limit);
  }

  async getChangelogById(id: string): Promise<UserProfileChangelog | undefined> {
    return getChangelogById(await this.ready(), id);
  }

  decayInMemory(data: UserProfileData): { data: UserProfileData; hasChanges: boolean } {
    return decayInMemory(data, CONFIG);
  }

  async deleteProfile(profileId: string): Promise<void> {
    await store.deleteProfile(await this.ready(), profileId);
    if (this.coldBuffers.delete(profileId)) {
      this.saveColdBuffers();
    }
  }

  /** Turn a profile off without deleting it, so its data and changelog stay stored. */
  async deactivateProfile(profileId: string): Promise<boolean> {
    return store.deactivateProfile(await this.ready(), profileId);
  }

  async getProfileById(profileId: string): Promise<UserProfile | null> {
    return store.getProfileById(await this.ready(), profileId);
  }

  async getAllActiveProfiles(): Promise<UserProfile[]> {
    return store.getAllActiveProfiles(await this.ready());
  }

  async mergeProfileData(
    existing: UserProfileData,
    updates: Partial<UserProfileData>,
    embedService?: EmbeddingService,
    profileId?: string
  ): Promise<UserProfileData> {
    return mergeProfileData(this.host(), existing, updates, embedService, profileId);
  }

  syncConfidence(item: any): void {
    syncConfidence(item, CONFIG);
  }

  private async detectConflicts(items: any[], itemType: string, _profileId: string): Promise<void> {
    return detectConflicts(this.host(), items, itemType, _profileId);
  }

  private async checkSemanticDuplicate(descA: string, descB: string): Promise<boolean> {
    return checkSemanticDuplicate(descA, descB, CONFIG);
  }

  private async checkConflict(descA: string, descB: string): Promise<boolean> {
    return checkConflict(descA, descB, CONFIG);
  }

  private async evolveDescription(
    item: any,
    itemType: "preference" | "pattern" | "workflow",
    profileId?: string
  ): Promise<string | null> {
    return evolveDescription(CONFIG, item, itemType, profileId);
  }

  async evolveAndUpdate(item: any, itemType: string, profileId?: string): Promise<void> {
    return evolveAndUpdate(this.host(), item, itemType, profileId);
  }
}

export const userProfileManager = resettable("user-profiles", new UserProfileManager());
