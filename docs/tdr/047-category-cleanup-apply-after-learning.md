# TDR-047: Category cleanup applies after profile learning

**Date:** 2026-10-15
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** profile-learning, categories, smart-category-cleanup

## Context

The web app showed "Profile changed since the preview. Build a new preview." on every Apply. Two rebuilt previews gave the same message, and nothing changed in the profile.

### Root Cause Analysis

A preview on a large profile takes about 30 minutes (TDR-044). It recorded the profile version when it started. Claude Code profile learning saves a new version about every 5 minutes (`omms-2026-10-14.log`). Apply compared the stored version with the recorded one and refused on any difference. A 30-minute preview therefore always met a newer version. A rebuild did the same. `om-memory-system profile-cleanup-categories --yes` previews and applies in one run, so it had the same fault.

## Decision

Apply no longer compares against the version from the preview. It reads the profile at apply time, renames by label, and saves with the version it just read. `updateProfile` refuses that save when another save landed in between, so two writers still cannot overwrite each other. The apply request and the preview no longer carry `version`. The message for the remaining race is "Profile saved at the same moment. Try Apply again."

A rename goes by label, so a newer profile is safe. An item that learning added under an accepted label is renamed too. An item that learning moved to another label is left alone. A label that no longer exists renames nothing and writes no changelog entry.

## Consequences

### Positive

- Apply works while learning runs.
- The CLI `--yes` path works for the same reason.

### Negative

- The category counts in the preview are a snapshot. The toast reports the real number of items renamed.
