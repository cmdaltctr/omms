# Continuous Integration

OMMS runs routine validation on the maintainer's Apple Silicon Mac. This keeps
ordinary changes out of the expensive GitHub platform matrix.

## Local macOS CI

Prepare the checkout before the first run:

```bash
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)
```

Run the routine gate:

```bash
bun run ci:local
```

The gate checks formatting, linting, TypeScript types, unit tests, and the
production build. The pre-push hook runs only the deterministic checks
(formatting, linting, typecheck) so pushes stay fast and reliable; run the
full gate manually before merging.

## GitHub Actions

| Workflow                       | Trigger         | Runner          | Purpose                                            |
| ------------------------------ | --------------- | --------------- | -------------------------------------------------- |
| Quality                        | Pull request    | `ubuntu-latest` | Independent format, lint, and typecheck check      |
| Embedding Backend Verification | Manual dispatch | `macos-15`      | Native ONNX and embedding smoke tests              |
| Platform Package Smoke         | Manual dispatch | `macos-15`      | Packaged npm artefact and native dependency checks |
| Release                        | `v*` tag push   | `ubuntu-latest` | Publish npm package and create GitHub Release      |

## Disabled automatic coverage

The project does not automatically run embedding or package-smoke checks on
pull requests or pushes to `main`.

The project does not run routine native or package checks on Windows, Linux,
Intel macOS, or macOS 26. Run a manual macOS workflow when a change affects
native dependencies, Bun, Node, the embedding backend, package contents, or
release packaging.

Docker is not part of this policy. A Linux container cannot validate macOS or
Windows native binaries.
