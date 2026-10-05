# Tasks

## 1. Mapping proposal helpers

- [ ] 1.1 Add test-first coverage and pure review helpers in `web/src/lib/directory-maps.ts` for suggested targets, edited and cleared targets, selected drafts, missing targets, no-directory entries, shared sources, and non-mutating proposal generation; record a failing check before implementation and verify `bun test tests/web-directory-maps.test.ts` passes afterwards.
- [ ] 1.2 Add test-first coverage and a confirmed-map merge that retains saved maps without committing unrelated decisions or pending removals; prove the old save payload violates this isolation, verify the focused helper tests pass, and document the helper's persistence boundary in its public API comment.

## 2. Smart resolve review and save

- [ ] 2.1 Add rendered interaction regression tests and implement the review dialog, host callbacks, and explicit Confirm save in the settings owners; show the old action fails the modal assertion, then verify separate-process focused tests cover all hosts, Cancel and Escape, no maps, manual edits, saved-map refresh, and no import request.
- [ ] 2.2 Add test-first coverage and implement retained unrelated drafts, pending removals, shared-source updates, duplicate-submission prevention, rejected saves, revision-conflict review, and refresh-only recovery after a successful save; verify the interaction tests pass after proving each new assertion detects the broken behaviour.
- [ ] 2.3 Translate dialog text, counts, actions, errors, and save results in English, Chinese, and Arabic; update `docs/web-ui-settings.md` for review and confirmation while preserving manual Save maps, and verify translation tests plus a guide-to-controls review pass.
- [ ] 2.4 Extend the existing synthetic directory-map fixtures and browser checks for long lists, long paths, missing targets, save failures, and retained drafts; verify focus trapping and return, host navigation, 320px width, 200% zoom, and the affected settings theme/language matrix without using the shared backend.

## 3. Memory type, tag, and link badges

- [ ] 3.1 Add rendered regression tests and implement stable coloured outline memory types without coloured fills at both type-badge call sites; cover `analysis`, `bug-fix`, unknown types, repeated renders, and no storage writes, record failures against the current neutral pills, and verify the focused badge tests pass.
- [ ] 3.2 Add regression coverage and implement the Memory type and Tags tooltips using the existing primitive, including keyboard access, trigger description forwarding, unchanged tag colours, and keyword-filter clicks; translate both role texts into all supported languages and verify the tests fail when tooltip wiring or the filter callback is removed, then pass when restored.
- [ ] 3.3 Add rendered regression coverage and colour existing memory and prompt LINKED pills green with semantic success colours; verify linked and unlinked cases, unchanged icons and labels, and unchanged relationships, with a failing assertion before implementation and a passing focused check afterwards.
- [ ] 3.4 Update `docs/web-ui.md` to distinguish memory types, keyword tags, and LINKED status; extend synthetic badge fixtures and verify both themes, repeated colour identity, role tooltips, hover and focus, contrast, Arabic and Chinese wrapping, narrow widths, and 200% zoom against the documented behaviour.

## 4. Integration and OpenSpec verification

- [ ] 4.1 Verify the intended worktree, obtain permission for required installs and the full suite, run the relevant test files in separate processes, `bun --cwd web run check`, `bun run check`, and `bun run ci:local`; record each command and outcome and resolve failures before claiming implementation complete.
- [ ] 4.2 Run `graphify update .` after code changes, run `openspec validate smart-resolve-and-memory-badges --strict`, and use the OpenSpec verify skill to check all delta scenarios and visual evidence; record PASS, FAIL, NOT RUN, or BLOCKED, and resolve verification findings before requesting archive or git actions.
