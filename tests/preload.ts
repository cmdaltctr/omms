/**
 * Preloaded into every `bun test` process (bunfig.toml [test] preload).
 *
 * Prevents the automatic one-time legacy store migration from running against
 * the developer's real ~/.opencode-mem during host-bootstrap tests. The
 * migration itself is unit-tested against temp homes in
 * tests/legacy-migration.test.ts (direct runLegacyStoreMigration calls bypass
 * this switch by design) and rehearsed against a copy of the real store.
 */
process.env.OMMS_SKIP_LEGACY_MIGRATION = "1";
