import { join } from "node:path";
import { hasEnoughWorkflowSteps } from "../../core/extraction.js";
import { resettable } from "../spaces/store-handles.js";
import { getProfileSettings, getStoragePath } from "../storage/active-space-access.js";
import type { EmbeddingService } from "../embedding.js";
import { log } from "../logger.js";
import {
  openProfileDb,
  USER_PROFILES_DB_NAME,
  type ProfileDb,
  type StoreConnections,
} from "../storage/profiles/connection.js";
import { getChangelogById, getProfileChangelogs } from "../storage/profiles/history.js";
import {
  clearLearnedPromptIds,
  forgetLearnedPromptIds,
  getLearnedPromptIds,
} from "../storage/profiles/learned-prompts.js";
import * as store from "../storage/profiles/profiles.js";
import type {
  UserProfile,
  UserProfileChangelog,
  UserProfileData,
  UserProfileWorkflow,
} from "./types.js";
import type { ColdBuffer, ColdBuffers } from "./profile-cold-buffer.js";
import { getColdBuffer, loadColdBuffers, saveColdBuffers } from "./profile-cold-buffer.js";
import { syncConfidence } from "./profile-confidence.js";
import { decayInMemory } from "./profile-decay.js";
import { detectConflicts } from "./profile-dedupe.js";
import { evolveAndUpdate, evolveDescription } from "./profile-evolve.js";
import type { ProfileHost } from "./profile-host.js";
import { canonicaliseCategories } from "./profile-category.js";
import { mergeProfileData } from "./profile-merge.js";
import { checkConflict, checkSemanticDuplicate } from "./profile-model-checks.js";
import { safeArray } from "./profile-utils.js";

// The manager is a facade. Storage and version history live in the storage port
// (storage/profiles/), merge and dedupe in profile-merge*.ts and profile-dedupe.ts,
// stale-item cleanup in profile-decay.ts, and description rewrites in profile-evolve.ts.

export { USER_PROFILES_DB_NAME };

/** The data a save stores: one label per category key and parsed lists. */
function cleanProfileData(profileData: UserProfileData): UserProfileData {
  return canonicaliseCategories({
    preferences: safeArray(profileData.preferences),
    patterns: safeArray(profileData.patterns),
    workflows: safeArray(profileData.workflows),
    ...(profileData.learning_paths ? { learning_paths: profileData.learning_paths } : {}),
  });
}

/** A first profile skips mergeProfileData, so the step minimum is applied here. */
function cleanNewProfileData(profileData: UserProfileData): UserProfileData {
  return canonicaliseCategories({
    preferences: safeArray(profileData.preferences),
    patterns: safeArray(profileData.patterns),
    workflows: safeArray<UserProfileWorkflow>(profileData.workflows).filter(hasEnoughWorkflowSteps),
    ...(profileData.learning_paths ? { learning_paths: profileData.learning_paths } : {}),
  });
}

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
    private readonly connections?: StoreConnections
  ) {
    this.reset();
  }

  reset(): void {
    this.db = null;
    this.initPromise = null;
    this.dedupCheckedCache.clear();
    this.dbPath = join(this.root ?? (getStoragePath() || ""), USER_PROFILES_DB_NAME);
    this.coldBufferPath = join(this.root ?? (getStoragePath() || ""), "cold-buffer.json");
    this.coldBuffers = loadColdBuffers(this.coldBufferPath);
  }

  private async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        this.dbPath = join(this.root ?? (getStoragePath() || ""), USER_PROFILES_DB_NAME);
        this.coldBufferPath = join(this.root ?? (getStoragePath() || ""), "cold-buffer.json");
        this.db = await openProfileDb(this.dbPath, this.connections);
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
      config: getProfileSettings(),
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
    promptsAnalyzed: number,
    /** Prompt ids this save took in. They are recorded in the same write as the profile. */
    learnedPromptIds: string[] = []
  ): Promise<string> {
    const db = await this.ready();
    return store.createProfile(
      db,
      userId,
      displayName,
      userName,
      userEmail,
      cleanNewProfileData(profileData),
      promptsAnalyzed,
      learnedPromptIds
    );
  }

  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    /** The version the caller read. The save is refused when the stored version differs. */
    expectedVersion: number,
    /** Prompt ids this save took in. They are recorded only when the save lands. */
    learnedPromptIds: string[] = []
  ): Promise<boolean> {
    const db = await this.ready();
    return store.updateProfile(
      db,
      profileId,
      cleanProfileData(profileData),
      additionalPromptsAnalyzed,
      changeSummary,
      expectedVersion,
      getProfileSettings(),
      learnedPromptIds
    );
  }

  /** The ids in `promptIds` that a save of this profile already took in. */
  async getLearnedPromptIds(profileId: string, promptIds: string[]): Promise<string[]> {
    return getLearnedPromptIds(await this.ready(), profileId, promptIds);
  }

  /** Drops the records of prompts that user-prompts.db now marks learned. */
  async clearLearnedPromptIds(profileId: string, promptIds: string[]): Promise<void> {
    await clearLearnedPromptIds(await this.ready(), profileId, promptIds);
  }

  /** Drops every profile's record of prompts that a forced re-analysis will learn again. */
  async forgetLearnedPromptIds(promptIds: string[]): Promise<void> {
    await forgetLearnedPromptIds(await this.ready(), promptIds);
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
    return decayInMemory(data, getProfileSettings());
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
    syncConfidence(item, getProfileSettings());
  }

  private async detectConflicts(items: any[], itemType: string, _profileId: string): Promise<void> {
    return detectConflicts(this.host(), items, itemType, _profileId);
  }

  private async checkSemanticDuplicate(descA: string, descB: string): Promise<boolean> {
    return checkSemanticDuplicate(descA, descB, getProfileSettings());
  }

  private async checkConflict(descA: string, descB: string): Promise<boolean> {
    return checkConflict(descA, descB, getProfileSettings());
  }

  private async evolveDescription(
    item: any,
    itemType: "preference" | "pattern" | "workflow",
    profileId?: string
  ): Promise<string | null> {
    return evolveDescription(getProfileSettings(), item, itemType, profileId);
  }

  async evolveAndUpdate(item: any, itemType: string, profileId?: string): Promise<void> {
    return evolveAndUpdate(this.host(), item, itemType, profileId);
  }
}

export const userProfileManager = resettable("user-profiles", new UserProfileManager());
