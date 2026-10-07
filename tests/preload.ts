/**
 * Preloaded into every `bun test` process (bunfig.toml [test] preload).
 *
 * Prevents the automatic one-time migrations from running against the
 * developer's real home during host-bootstrap tests. The directory migration
 * itself is unit-tested against temp homes in tests/legacy-migration.test.ts
 * (direct runLegacyStoreMigration calls bypass this switch by design) and the
 * tag prefix migration against temp stores in tests/tag-prefix-migration.test.ts
 * (likewise via direct runTagPrefixMigration calls). Both are rehearsed
 * against copies of the real store.
 */
import { homedir } from "node:os";

// Refuse to run outside scripts/run-tests-isolated.sh, or with the real home folder.
// Bun reads the home folder once at process start, so only the runner can keep
// tests away from the real ~/.omms store. A plain `bun test` once deleted the real
// user-prompts.db rows. A test may start a child with its own temporary home.
if (!process.env.OMMS_TEST_HOME || homedir() === process.env.OMMS_REAL_HOME) {
  throw new Error(
    "Run tests through the isolated runner so they never touch your real ~/.omms store:\n" +
      "  bash scripts/run-tests-isolated.sh tests/<file>.test.ts\n" +
      "  bun run ci:local"
  );
}

process.env.OMMS_SKIP_LEGACY_MIGRATION = "1";
process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION = "1";
