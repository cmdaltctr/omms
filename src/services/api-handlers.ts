// Route handlers for the web API, one file per route group under ./api/.
// This file keeps the old import path, so web-server.ts and tests need no edits.
export { handleListTags, handleListKeywords, handleStats } from "./api/overview.js";
export { handleListMemories } from "./api/memory-list.js";
export {
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handlePinMemory,
  handleUnpinMemory,
} from "./api/memory-write.js";
export { handleSearch } from "./api/search.js";
export {
  handleRunCleanup,
  handleRunDeduplication,
  handleDetectMigration,
  handleRunMigration,
  handleDetectTagMigration,
  handleGetTagMigrationProgress,
  handleRunTagMigrationBatch,
} from "./api/maintenance.js";
export { handleDeletePrompt, handleBulkDeletePrompts } from "./api/prompts.js";
export {
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleUpdateProfileItem,
} from "./api/profile.js";
export {
  handleCategoryCleanupStart,
  handleCategoryCleanupStatus,
  handleCategoryCleanupApply,
  handleCategoryCleanupUndo,
} from "./api/category-cleanup.js";
