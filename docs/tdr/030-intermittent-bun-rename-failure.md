# TDR-030: Investigate an intermittent Bun rename failure

- **Date:** 2026-10-04
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** Bun, macOS, filesystem, investigation

## Context

One local PR #89 CI run failed in the unchanged atomic lock-replacement test
with `ENOENT` from `renameSync`. Its isolated run, five repeats, and the next
full gate passed. The user requested an investigation before accepting this
as an unexplained failure.

### Findings

A standalone probe uses only `node:fs` and `node:child_process`. It creates a
private temporary directory, writes a PID-suffixed staging file, and renames it
over a target. A separate Node process reads the target continuously. Between
writes, the parent awaits `Promise.resolve()`, matching the original test.

Bun 1.4.2 (`744846f84`) reported `ENOENT` after 73,342 successful iterations,
10.949 seconds into the probe. At the failing iteration, reading the target
returned the new value, `73342`. Directory enumeration listed only the target.
An earlier `existsSync` call reported the staging path present. These snapshots
do not establish the order or number of native rename operations.

The failure occurs without OMMS imports or its test runner. The same probe under
Node completed 139,153 replacements in 20 seconds without failure. Further Bun
runs were also successful: 200,009 replacements in 30 seconds, 136,197 in
20 seconds with `JSC_useJIT=false` requested, and 393,441 in a 60-second run with
native rename tracing. The requested compiler setting was later found ineffective:
Bun's option dump still reported `useJIT=true`. That run is not evidence of
compiler-disabled behaviour. A synchronous writer with the reader still active
completed 136,115 replacements in 20 seconds. These passes do not identify a cause.

### Follow-up after PR #89 merged

Verified the tracer loads and intercepts native `rename` calls in both Bun and
Node. Native call counts matched JavaScript iteration counts in the control runs.
Three further 20-second traced Bun runs completed 404,822 replacements with zero
failures. A forced garbage-collection probe completed 123,773 replacements in
20 seconds without failure.

Repeated the compiler-disabled control with Bun's supported
`BUN_JSC_useJIT=false` setting. The option dump confirmed `useJIT=false`, and the
20-second traced run completed 133,643 replacements without failure. The original
error still has no failing native trace, so neither the compiler nor garbage
collection has been established as its cause.

### Isolated canary comparison

With the maintainer's approval, downloaded the official macOS arm64 canary asset
into `/tmp/omms-bun-canary.reCrnz`. Its SHA-256 matched the published digest:
`d1197c909aeafda36c03d982f0aeee84522a8284aa45d099fc2f8d43230ebe6a`.
The binary reports `1.4.3-canary.1+bb35d1b81`.

Ran three paired, uninstrumented probes, alternating installed Bun 1.4.2 and
canary. Each run allowed 20 seconds and stopped at the first error. Stable Bun
completed 359,528 successful renames across the three runs and failed once with
`ENOENT` after 94,411 iterations (14.132 seconds). Canary completed 395,439
renames across its three full runs without failure. The identical probe and
Node reader were used for both versions.

The installed Bun checksum remained unchanged before and after the comparison:
`35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`.
No project dependency or CI runtime was changed. These results justify further
comparison with upstream changes, but do not prove that canary fixes the fault.

## Decision

Keep the production implementation and original atomicity assertions unchanged
while the runtime mechanism remains unconfirmed. Do not add an `ENOENT` retry,
return success from a caught error, or skip the test.

Commit the independently verified backfill cleanup fix described in TDR-029.
Use fresh GitHub CI to check that fix, but do not treat a green run as a remedy
for this separate rename issue. The maintainer authorised merging PR #89 after
CodeRabbit review and passing CI, then continuing this investigation separately.

## Consequences

### Positive

- A small independent reproduction separates this failure from backfill cleanup.
- The original failure remains visible instead of being hidden by a retry.

### Negative

- No verified fix exists for the intermittent rename failure yet.
- The original test can still fail during CI.

### Neutral

- Local observations implicate the runtime path; they do not prove a Bun or OS defect.

## Alternatives Considered

| Option                                                           | Rejected because                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Retry `ENOENT` or accept matching target contents                | This could conceal a real lost source or another writer's replacement.          |
| Change temporary names or remove the microtask yield immediately | No controlled experiment proves either change fixes this failure.               |
| Attribute it to Bun issue #25551                                 | That issue concerns Linux `Bun.build()` and `ESPIPE`, not this rename sequence. |

## How to Recognise / Handle This Again

1. Preserve the original exception, runtime version, iteration count, and paths.
2. Reproduce with a private directory and no OMMS imports.
3. Compare identical reader/writer probes under Bun and Node.
4. Capture native operation order on a failing run before selecting a workaround.
5. Require a failing regression and a verified remedy before claiming resolution.

## Revisit Triggers

A native trace that captures the failure, a matching upstream fix, or a repeatable
regression should reopen this investigation.

## References

- [Original test](../../tests/web-ensure.test.ts)
- [Atomic replacement implementation](../../src/services/web-ensure.ts)
- [Independent backfill fix](029-wait-for-backfill-test-child-cleanup.md)
- [Node filesystem synchronous API](https://nodejs.org/api/fs.html#synchronous-api)
- [Bun 1.4.2 rename wrapper](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/runtime/node/node_fs.rs)
- [Bun 1.4.2 syscall wrappers](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/sys/lib.rs)
- [Unrelated Bun issue #25551](https://github.com/oven-sh/bun/issues/25551)
