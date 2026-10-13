# Design

## Context

Preferences and patterns carry a free-text `category`. The analysis prompt asks for `"category": "string"` and gives no list to reuse, so the model invents a spelling each time. `mergeItems` in `user-profile-manager.ts` compares category identity directly in three places: the exact match, candidate threshold selection, and the neighbour fold. The three-way and weak-band paths use those results. Every save goes through `createProfile` or `updateProfile`, including the Settings page edit (`handleUpdateProfileItem`) and the AI cleanup apply.

The live profile has 1,573 distinct category labels. By style: 798 sentence case, 501 lower case or slug, 197 Title Case, 72 with acronyms, 5 with proper names. The pill colour comes from `keywordHue`, which already lower-cases its input.

Workflows have no category and are out of scope.

## Goals / Non-Goals

**Goals:**

- Spelling variants are one category, before and after the repair.
- One visible label per category, with its capitals kept when they carry meaning.
- No `_` slugs on the Settings page.
- A reversible, previewable repair for the stored profile.

**Non-Goals:**

- No meaning-level merging. "Communication" and "Communication style" stay apart. That decision belongs to the experiment `evaluate-memory-decision-models`, and a later proposal acts on its result.
- No merging, removing, or reordering of items. Only the label changes.
- No change to the web UI.
- No automatic repair on start-up or from a web button.
- No enum-constrained model output. See Risks.

## Decisions

**Separate the match key from the visible label.** The key (trim, lower case, `_` and `-` to a space, collapse spaces) decides identity and is never shown. The label is what users see. This follows the usual taxonomy pattern (one preferred label per concept, as in SKOS) and the tag-key rule used by OpenStreetMap (strip, lower case, collapse). Alternative: store only the key and derive the label for display. Rejected, because it loses "UI/UX" and "OpenSpec".

**One label per key, chosen when the profile is saved.** An existing spelling without `_` or `-` takes priority over separator spellings. Among those readable spellings, the most used wins across preferences and patterns. When every spelling has separators, the most used wins. Ties prefer a leading capital, then the first seen. The winner is then tidied. The user approved this revision after the live preview would have changed five spaced labels into hyphenated slugs. Choosing by use among readable labels keeps "Communication style" sticky when new slug variants arrive. Alternative: an alias table. Rejected, because the stored label already is the alias target, and a table needs its own storage and repair.

**Tidy a label lightly, and never rewrite capitals that are there.** `_` becomes a space, spaces collapse, and an all-lower-case label gets a capital first letter. A label with any capital is left as written. Alternative: force lower case, or force sentence case. Rejected: lower case would damage 77 live labels with acronyms or proper names, and sentence case would turn "UI/UX" into "Ui/ux" and "OpenSpec" into "Openspec". Decide the rule once, because changing a labelling convention later is hard.

**Hyphens stay when no readable alternative exists.** The key ignores them, so "Anti-over-engineering" and "Anti over engineering" match. An existing spelling without separators wins when available. Otherwise the winner's hyphens stay. A lone "Anti-over-engineering" is preserved. A hyphen is ambiguous: "Free-tier" is a real hyphen, "communication-style" is a slug.

**A pure module, `profile-category.ts`, with `categoryKey`, `tidyCategory` and `canonicaliseCategories`.** The repository guidance asks for new pure logic in its own module, because many tests stub `src/config.js`. The module imports nothing. `canonicaliseCategories` takes a profile and returns a new one, so the save path and the repair command share it and cannot drift.

**Run `canonicaliseCategories` inside `createProfile` and `updateProfile`.** Two edits cover learning, the Settings page edit and the AI cleanup. The profile heals on its next save, even without the repair command. Alternative: normalise only incoming items in `mergeProfileData`. Rejected, because it misses the manual edit and the AI cleanup, and it leaves stored spellings unmatched.

**Compare by key inside `mergeItems`.** The comparison fix works on profiles that are not yet repaired.

**One list builder, in `src/core/extraction.ts`, used by the shared prompt and by OpenCode.** OpenCode's `buildCategorySummary` lists every category with its count, unbounded and with every bad spelling. For the live profile that is about 750 names a call. The shared builder takes the visible labels, sorts by count, and stops at 40 per type. A fixed constant, with no config key. OpenCode's category section calls the builder, and the rest of its summary stays as it is. Alternative: a second builder for OpenCode. Rejected, because two copies drift and the hosts must match.

**Layer order: key and label rules, then the prompt list, then the experiment.** The key rule is the first arm of the experiment. The prompt list stops most new variants at the source. The experiment then measures what is left, so its test set is smaller and cleaner.

**The repair is a terminal command with a preview and `--yes`.** It follows `profile-catch-up`. It lists each rename, then saves through `updateProfile`, which writes a changelog snapshot, so the old state can be restored. Alternatives: repair on start-up, which would rewrite a user's data without being asked, and a web button, which adds UI and tests for a one-off job.

**Split candidate matching before the third change to `mergeItems`.** The user confirmed that this function already received two edits on this branch. They approved extracting candidate matching into a focused helper before applying the category-key comparisons. Verify the mechanical split against existing merge tests first. Keep merge actions, cold buffering, workflow safeguards and the special `explicit` check unchanged.

## Risks / Trade-offs

- **A wrong first spelling sticks.** If the winner is "Plain english", later variants snap to it. The repair preview shows every rename for review before `--yes`.
- **A manual edit can be undone by the save.** A user who changes one item's category to a new spelling of an existing key sees it snap back to the stored label. Renaming a whole category by hand is not supported. Accepted as a known cost: identity is the key, and one label per key is the point.
- **A separator spelling wins when it is the only form available.** A hyphenated label stays when the profile has no spelling without `_` or `-`. The rule does not guess which hyphens are meaningful. A rare existing readable spelling now wins over a frequent slug; the user chose this cost to protect readable labels.
- **A cap of 40 hides rare categories from the model.** The model may then invent a name for a rare topic. Accepted: the experiment measures the leftovers.
- **Enum-constrained output would be stronger than a prompt list.** It forces the model to pick from a fixed set, but it needs a "new label" option and a schema per host. Kept as a follow-up after layers 1 and 2 are measured.
- Two items in one category can still look like duplicates until the deduplication pass confirms them (5 model checks per pass). The Settings page shows the same pill name twice for a while.
- A blank category becomes "General", which groups unrelated blanks. This matches what the UI already shows for a missing category.
- `profile-catch-up` and the imports call the same save path, so they pick up the rules with no code of their own.
