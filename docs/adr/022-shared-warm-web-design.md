# ADR-022: Apply warm web design through existing shared owners

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** OMMS maintainer

## Context

OMMS's green terminal palette and global monospace font differed from the
selected OpenChamber-inspired design. The web app already had shared React
controls, semantic CSS variables, theme and language stores, and Radix dialogs.

The trial needed to improve readability across explorer, profile, and settings
without changing routes, save timing, warnings, or host behaviour. Tests and
screenshots needed synthetic data so verification could run without accessing
private memories or the shared backend.

## Decision

Apply the warm light and dark palette through the existing semantic variables
in `web/src/app.css`. Use system sans-serif for interface text and retain
JetBrains Mono for code, commands, identifiers, and paths. Keep separate colour
roles for tinted labels, solid controls, essential boundaries, and focus rings.

Update shared primitives and existing screen presentation owners. Preserve
component composition, state stores, preference keys, legacy migration,
callbacks, navigation, and Arabic document direction. Keep existing Radix and
Lucide dependencies. Import no OpenChamber runtime or theme engine.

Keep dialog content scrollable within the viewport. Translate the existing
close label and position it at the logical end. Apply the separately approved
focus-return correction in the shared dialog owner: remember the opener before
consumer autofocus runs, honour consumer close handlers, and restore only a
connected opener.

Verify the trial with a test-only Vite configuration that disables both API
proxies. Handle declared API operations through synthetic fixtures, keep writes
in memory, and reject unknown routes. Retain matched screenshots, computed
browser measurements, and focused regression evidence.

The maintainer accepts browser mobile-viewport checks for completion and waived
physical-device and emulator testing. Actual software-keyboard behaviour remains
NOT RUN. Browser checks establish behaviour only for their recorded conditions.

Retain OpenChamber's MIT attribution and source revision in the canonical design
skill and `THIRD_PARTY_NOTICES.md`.

## Consequences

### Positive

- Shared tokens and controls carry one design across existing screens.
- Existing state ownership preserves drafts through theme and language changes.
- Synthetic fixtures support repeatable verification without private data.

### Negative

- Existing raw settings controls need scoped presentation alongside shared primitives.
- Contrast depends on rendered background composites and needs browser checks.
- Physical software-keyboard reachability remains unverified under the accepted scope.

### Neutral

- The change introduces no dependency, backend, or preference migration.
- Before and after evidence stays in the repository with the approved trial.

## Alternatives Considered

| Option                                      | Rejected because                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Import OpenChamber's runtime                | A second theme system would change ownership and add dependencies.                  |
| Define palettes per screen                  | Separate values would make shared states and contrast harder to maintain.           |
| Restructure screens during the redesign     | Routes, task flows, and component composition must retain their existing contracts. |
| Keep global monospace and the green palette | This would leave the selected design direction unapplied.                           |
| Verify against the live backend             | Screenshots and mutations could expose or change private data.                      |

## References

- [Visual specification](../../openspec/specs/web-visual-design/spec.md)
- [Archived design](../../openspec/changes/archive/2026-10-04-omms-design-preview/design.md)
- [Verification record](../design-preview/verification.md)
- [Shared foundations](../../web/src/app.css)
- [Dialog owner](../../web/src/lib/components/ui/dialog.tsx)
- [Synthetic Vite configuration](../../web/tests/visual/vite.config.ts)
- [Canonical design skill](../../.agents/skills/omms-design/SKILL.md)
- [OpenChamber attribution](../../THIRD_PARTY_NOTICES.md#openchamber)
