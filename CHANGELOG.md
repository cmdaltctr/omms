# Changelog

Release notes are written by [release-please](https://github.com/googleapis/release-please) from conventional commits. Each release is also on the [GitHub Releases](https://github.com/cmdaltctr/omms/releases) page.

## [3.1.1](https://github.com/cmdaltctr/omms/compare/v3.1.0...v3.1.1) (2026-09-26)


### Bug Fixes

* **import:** never fail an OpenCode import on Windows temp-copy cleanup ([007c28e](https://github.com/cmdaltctr/omms/commit/007c28e7c76870e18de4b9c9359762ebf202c4e7))
* **test:** tolerate late Windows file locks when removing CLI temp dirs ([d2e4c45](https://github.com/cmdaltctr/omms/commit/d2e4c45d7a569d5259a59b896213d2fc0a3e7b59))
* **test:** tolerate late Windows file locks when removing CLI temp dirs ([a9e2c57](https://github.com/cmdaltctr/omms/commit/a9e2c57f8227a0006d8c5cadeba565918fce7e01))

## [3.1.0](https://github.com/cmdaltctr/omms/compare/v3.0.0...v3.1.0) (2026-09-26)


### Features

* **import:** rebuild agent history into shared memory ([8750dfd](https://github.com/cmdaltctr/omms/commit/8750dfd51041d8933e4cdcd723193840a6c4fc01))
* **import:** rebuild agent history into shared memory ([f3418ee](https://github.com/cmdaltctr/omms/commit/f3418ee83b91ddc477390f173b9c2dddb65664af))
* run history imports in-session and share one live-model rule ([583ac2a](https://github.com/cmdaltctr/omms/commit/583ac2ac0519b1b21df0debb7c338dc483b5e508))


### Bug Fixes

* **cli:** run the bin through node_modules/.bin symlinks ([ddde281](https://github.com/cmdaltctr/omms/commit/ddde281638af55ef93b7c5e682c0f6cd00ed1a24))
* **import:** address review findings for history import ([d64d6ab](https://github.com/cmdaltctr/omms/commit/d64d6abfcdcaa49b9c3449d65065626e17dcee62))
* **import:** keep dry-run ledger lookups read-only ([3cc027a](https://github.com/cmdaltctr/omms/commit/3cc027a013b674b17c882f78f2fa5343d9070029))
* **import:** log import report counts, never prompt previews ([f79bf0d](https://github.com/cmdaltctr/omms/commit/f79bf0dfeab3023fdbf38328719dbbab009e8ea2))
* **import:** skip already-imported prompts in the dry-run profile count ([d3a0ae4](https://github.com/cmdaltctr/omms/commit/d3a0ae4c5df3fb1768d6fe8661e0bdec192afb94))


### Documentation

* shorten the README and add guides, CONTRIBUTING and AGENTS rules ([34ce551](https://github.com/cmdaltctr/omms/commit/34ce551ca8b346a3a4781986f51da1b006950eb6))
* track OpenSpec changes, specs and decision records ([375b559](https://github.com/cmdaltctr/omms/commit/375b5590d2e62d60a7bf49b296cee3d5acb9b9b4))

## 3.0.0

First release published to npm as `om-memory-system` (the product is still called omms): a fork of [`opencode-mem`](https://github.com/tickernelz/opencode-mem) with a native OpenCode v2 plugin, a Pi extension sharing one memory store, and the memory explorer web UI.
