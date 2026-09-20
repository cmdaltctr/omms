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
process.env.OMMS_SKIP_LEGACY_MIGRATION = "1";
process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION = "1";
