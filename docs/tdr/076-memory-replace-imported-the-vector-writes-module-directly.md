# TDR-076: memory-replace imported the vector writes module directly

**Date:** 2026-11-10
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memorisation, tests, module-linking

## Context

`src/services/memory-replace.ts` swaps a stored row for a new one in one transaction. Its first version imported `insertVectorInTransaction` from `src/services/turso/vector-writes.ts`. Tests that replace `vector-utils.js` with `mock.module` then failed before any test ran.

### Root Cause Analysis

1. `vector-writes.ts` imports `vectorToJson` from `vector-utils.js`.
2. A test stub of `vector-utils.js` does not export `vectorToJson`.
3. Bun links ES module imports when it loads the module. A missing export is a link error at module load, not a failure inside a test. Every test that loaded `memory-replace.ts` through its import chain failed.
4. The other callers reach the insert through `tursoVectorSearch.insertVectorInTransaction`. That path loads `vector-search.ts`, which the stubs already cover.

## Decision

`memory-replace.ts` calls `tursoVectorSearch.insertVectorInTransaction(tx, record)` and no longer imports `turso/vector-writes.ts`:

```ts
import { tursoVectorSearch } from "./turso/vector-search.js";
// ...
await tursoVectorSearch.insertVectorInTransaction(tx, record);
```

No new test file. The existing replace tests (`tests/memory-operations-memorise.test.ts`) and every test that stubs `vector-utils.js` cover it. They fail at module load when the direct import returns.

## Consequences

### Positive

- Tests that stub `vector-utils.js` load the module again.
- `memory-replace.ts` follows the same path as every other caller.

### Negative

- The module depends on the `tursoVectorSearch` object and not on the write function alone.

### Neutral

- The insert and the delete still run in one transaction.

## Alternatives Considered

| Option                                   | Rejected Because                                            |
| ---------------------------------------- | ----------------------------------------------------------- |
| Add `vectorToJson` to every test stub    | Many files, and every new stub would need the same line.    |
| Dynamic `import()` of `vector-writes.ts` | It hides the dependency and differs from the other callers. |

## How to Recognise / Handle This Again

1. Symptom: a test file fails at load with a Bun link error that names a missing export such as `vectorToJson`.
2. Check the import chain for a module that imports `turso/vector-writes.ts` or another helper that the stub replaces.
3. Reach the function through `tursoVectorSearch`, as the other callers do.

## Revisit Triggers

- `vector-writes.ts` stops importing `vector-utils.js`.
- The tests stop stubbing `vector-utils.js`.

## References

- [ADR-047](../adr/047-memorisations-are-a-record-kind-in-the-memory-store.md)
- `src/services/memory-replace.ts`, `src/services/turso/vector-writes.ts`, `src/services/turso/vector-search.ts`
- `tests/memory-operations-memorise.test.ts`
