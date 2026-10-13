# Tasks

> **On hold (2026-10-13).** Operator decision: labels grow from each user's own categories, not a fixed list. Smart category cleanup and reuse-first category naming come first. Task 3.2 and its sub-tasks wait until that ships and a measurement shows whether categories still sprawl. Do not build them before then.

- [x] 1. Shared core: review-gated first assignment
  - [x] 1.1 Add the routing rule (`src/core/label-assignment.ts`): no automatic label reuse on first assignment; reviewed label and `none_fit` outcomes reuse automatically
  - [x] 1.2 Store `suggested_label` with each pending review item (`label_assignments` table); never store it as the outcome
  - [x] 1.3 Add review outcome states `label`, `none_fit`, `uncertain` with reviewer identity and timestamp; `uncertain` keeps the item pending
  - [x] 1.4 Router takes duplicate and conflict matches ahead of review routing; conflicts route back to review
  - [x] 1.5 Unit tests (`tests/label-assignment.test.ts`, 8 passing): routing cases, outcome validation, store round-trip, uncertain stays pending
- [x] 2. Review queue surface
  - [x] 2.1 Shared web API: `GET /api/label-assignments?status=`, `POST /api/label-assignments/:id/resolve`
  - [x] 2.2 Queue view (`LabelReviewList`): observation, suggested label, typed override, Confirm / No label fits / Uncertain; three languages
  - [x] 2.3 Verified through `tsc`, production build and the hook logic; this web app has no component-test runner, so no component test was added
- [x] 3. Host-neutral core
  - [x] 3.1 Routing and storage live in `src/core` and `src/services` with no host imports; the existing boundary tests keep enforcing that
  - [ ] 3.2 Producer wiring: capture creates review items with the Experiment 23 suggestion list (ADR-024 decision 5). It no longer waits for catalogue consolidation (Experiment 11). Build in the `feat/evaluate-memory-decision-models` worktree (operator decision 2026-10-13); write each test first and confirm it fails
    - [ ] 3.2.1 Review store: add columns for the item's embedding vector and embedding model; items without a vector are skipped by cosine; store round-trip tests
    - [ ] 3.2.2 Suggestion list builder in its own pure module (pass `CONFIG` in, per the config-stub rule): Clef's top labels from the own section up to the own-section count, then other-section labels by cosine up to the other-section count, no repeats, each marked with its section; tests for 3 and 2, 5 and 0, and 10 and 10; cosine fills Clef's places when the decision model gives nothing; same-embedding-model filter; never pads; unit tests for each case
    - [ ] 3.2.3 Decision model port in `src/services/`: local llama.cpp client with the Experiment 15 request shape, own-section options with two reviewed examples each, 20-second time limit, `<private>` removal, log of provider, size and outcome code only; tests against a fake server, including timeout and refusal
    - [ ] 3.2.4 Hosted clients: Cloudflare Workers AI (`@cf/cloudflare/clef`, account ID and token) and TypeSafe (Jev, key); keys as `env://` or `file://`; secret redaction before sending; hosted values honoured from the global config only; confirm the served Cloudflare model and free allowance from Cloudflare's documentation; tests with fake endpoints, no real hosted calls
    - [ ] 3.2.5 Connect capture to the router in the shared core: a first assignment creates a review item with the list; a decision model failure never blocks capture or manual `memory` operations; Pi, OpenCode and Claude Code (through the web app) take the same path; boundary tests still pass
    - [ ] 3.2.6 Settings: config keys for the two suggestion counts (own 1 to 10, default 3; other 0 to 10, default 2; out-of-range values refused) and the decision model (provider, server URL, account ID, key reference); Memory card controls with help text that marks hosted values as unmeasured and as sending text off the machine; English, Chinese and Arabic strings
    - [ ] 3.2.7 Review card (`LabelReviewList`): mark suggestions from the other section; a reviewer can confirm a label from either section
    - [ ] 3.2.8 ADR-025: decision model location, local default, hosted opt-in rules; add it to `docs/adr/ADR_README.md`
- [x] 4. Documentation
  - [x] 4.1 `docs/web-ui.md` gains the Label review section with reviewer instructions
  - [x] 4.2 Review-load expectation noted: the queue starts empty and grows with producers; approved repeats are reused automatically, so the load falls as repeats grow (ADR-024)
  - [ ] 4.3 `docs/web-ui-settings.md` Memory section documents the suggestion count and decision model settings; `docs/web-ui.md` Label review section explains the two-section list
- [ ] 5. Verification
  - [x] 5.1 `bun test tests/label-assignment.test.ts`, `bun run lint`, `bun run typecheck`, `bun run build` all pass
  - [ ] 5.2 `bun run ci:local` passes. `experiments/` is now in `.prettierignore` and the ESLint ignores, because earlier experiments pin their files by SHA-256 and formatting would break their verification
  - [ ] 5.3 Manual pass on each host: pending until task 3.2 wires a producer. Check the default list with a local Clef server, the fallback with the server stopped, and the counts 5 and 0
  - [ ] 5.4 `openspec validate review-first-assignment --strict` passes after every planning update
