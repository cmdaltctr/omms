## Context

GitHub currently exposes `cmdaltctr/opencode-mem` with an OpenCode-only description. The package is named `omms`, but its repository URL still points to the upstream repository. The web bundle also exposes an `opencode-mem` asset name.

## Goals / Non-Goals

**Goals:**

- Make `cmdaltctr/omms` the canonical GitHub repository URL.
- Set the repository description to `OMMS - Opinionated Modular Memory System`.
- Make packaged metadata and user-facing repository links use the canonical URL.
- Preserve legacy runtime configuration names where they are compatibility contracts.

**Non-Goals:**

- Publishing the package to npm.
- Renaming OpenCode integration APIs, legacy data paths, or compatibility environment variables.
- Changing the current `3.0.0` package version.

## Decisions

### Rename the GitHub repository to the package name

Use GitHub slug `omms`. GitHub repository names cannot carry the full product title reliably in URLs. The repository description carries the official expanded name.

### Update canonical links, retain compatibility references

Update links and metadata that identify the repository. Keep references to `opencode-mem` when they name an upstream package, legacy path, configuration file, API header, or migration source.

### Rename the bundled web asset

Rename the icon file and its application reference to avoid serving an old public product name from the OMMS package.

## Risks / Trade-offs

- [External references may retain the old URL] → GitHub redirects the old repository URL; update all controlled links.
- [Renaming legacy identifiers breaks installed users] → Limit replacements to public branding and repository metadata.
- [A local clone still uses the old remote URL] → Set `origin` to the renamed repository after the GitHub operation.

## Migration Plan

1. Rename the GitHub repository and set its description.
2. Update the local remote URL.
3. Apply the controlled repository-link and asset rename changes in a feature worktree.
4. Verify the package contents, links, and focused checks.
5. Merge the reviewed feature branch, then create tag `v3.0.0` only after npm release credentials are configured.
