# Changelog

Release notes are written by [release-please](https://github.com/googleapis/release-please) from conventional commits. Each release is also on the [GitHub Releases](https://github.com/cmdaltctr/omms/releases) page.

## [4.0.0](https://github.com/cmdaltctr/omms/compare/v3.6.2...v4.0.0) (2026-10-01)


### ⚠ BREAKING CHANGES

* an embedding server without embeddingApiKey no longer receives OPENAI_API_KEY. Set "embeddingApiKey": "env://OPENAI_API_KEY" to keep it.
* webServerApiToken is imported once into the API token table as "from config file" with no expiry, then no longer read. Existing callers keep working. Create new tokens on the Settings page. A network-bound web app now starts only with an unexpired token or a browser password.

### Features

* settings keys and access, embedding changes, Claude Code health, and profile learning fixes ([0c3de91](https://github.com/cmdaltctr/omms/commit/0c3de91678a2cea5e13d02ce268ec8bc2a0d668f))


### Bug Fixes

* apply CodeRabbit review and restore docs and the OpenSpec archive ([8cf93ce](https://github.com/cmdaltctr/omms/commit/8cf93ce157df15f6e5f4e71057a8d06a3dc39fa9))

## [3.6.2](https://github.com/cmdaltctr/omms/compare/v3.6.1...v3.6.2) (2026-09-30)


### Bug Fixes

* expect the Windows session order in the Claude reader test ([8a63301](https://github.com/cmdaltctr/omms/commit/8a633019e85ceda56738c424e9aaede1c98ea77d))
* make the six-platform release smoke pass on Windows ([8b44988](https://github.com/cmdaltctr/omms/commit/8b449884fba2e7f25f339c4f77abf8306b7dfbb1))
* point the memory CLI test at its temporary home on Windows ([a5eec7d](https://github.com/cmdaltctr/omms/commit/a5eec7ddf463352dcb8db89939327bf61e8b484e))
* retry the web start lock replace while Windows holds it open ([380607e](https://github.com/cmdaltctr/omms/commit/380607e58210c568f33fee2928220b82cdccdd85))
* run the real-process web tests on Windows ([f3a0733](https://github.com/cmdaltctr/omms/commit/f3a07331fd6d9cd73273593d7368653f25d6a61b))

## [3.6.1](https://github.com/cmdaltctr/omms/compare/v3.6.0...v3.6.1) (2026-09-30)


### Bug Fixes

* make the release smoke tests pass on Windows and slow runners ([17cdedf](https://github.com/cmdaltctr/omms/commit/17cdedf7d8f011a8c7b5e76fafbd243474f249ca))
* make the release smoke tests pass on Windows and slow runners ([8327fdd](https://github.com/cmdaltctr/omms/commit/8327fdd8f55afa0bae45f66b8759830b8c8855b9))

## [3.6.0](https://github.com/cmdaltctr/omms/compare/v3.5.0...v3.6.0) (2026-09-30)


### Features

* add Claude Code host through hooks and the web app ([54f6b52](https://github.com/cmdaltctr/omms/commit/54f6b52fecc5212705659d3b624e7496766db73b))
* add Claude Code host through hooks and the web app ([88fe00c](https://github.com/cmdaltctr/omms/commit/88fe00cfaab828531ce09db984c5b8433c373ace))
* one shared web app for every host, with Restart and Stop ([91f7457](https://github.com/cmdaltctr/omms/commit/91f74578d19b3156b75b85192ea0e4268338387c))
* run one shared web app for every host, with Restart and Stop ([f48b205](https://github.com/cmdaltctr/omms/commit/f48b205bd3f0c768a590ca2673ac2eb9d7c473f2))
* set the Claude Code folder on the Settings page ([3b97eb2](https://github.com/cmdaltctr/omms/commit/3b97eb2eae345dc404c38f66ced1e94d96ef8b25))
* set the Claude Code folder on the Settings page ([c6201da](https://github.com/cmdaltctr/omms/commit/c6201da361290d95ae21290530053f8bc4bfbf47))
* **web:** hand the port to the newer version on web install ([2a8dd86](https://github.com/cmdaltctr/omms/commit/2a8dd86f27c9e4987e279f6511c7f35ba2bf08f7))
* **web:** hand the port to the newer version on web install ([fc68b5d](https://github.com/cmdaltctr/omms/commit/fc68b5dda77d47e4ce6bb05c704b450242984632))


### Bug Fixes

* address review feedback on the Claude Code host ([de4d604](https://github.com/cmdaltctr/omms/commit/de4d6042919007c96af1567c4232b9266fa9f5b2))
* address review on the Claude Code folder setting ([0923b3c](https://github.com/cmdaltctr/omms/commit/0923b3c59eaea77ffc24b51ca1abd547b33a26f3))
* atomic stale-lock takeover, and keep serving when a restart copy fails ([c21601f](https://github.com/cmdaltctr/omms/commit/c21601fab9fe1dcb0d4b091f73073b9998741381))
* check the shared web app in Pi without webServerAutoStart, and run one power action at a time ([79f3d4c](https://github.com/cmdaltctr/omms/commit/79f3d4cd3e062da17aa65b74cbd5ac9ba1e09f7b))
* keep the Claude plugin manifest in release-please format ([17a4834](https://github.com/cmdaltctr/omms/commit/17a483417eda0bef6b753026c62276027db49e05))
* keep the Claude plugin manifest in release-please format ([85421d4](https://github.com/cmdaltctr/omms/commit/85421d40e866e62715c4a5455b29cc05c399fe7e))
* make Claude discovery without a root follow the claudeConfigDir setting ([ba8af28](https://github.com/cmdaltctr/omms/commit/ba8af28970300a5e4f471b89f31f1fe3c2cc6147))
* match the projects folder by letter case on disk ([b5cea33](https://github.com/cmdaltctr/omms/commit/b5cea33611da037dcbb47ea2a1cbb0f92de40b0f))
* restrict the capture route to Claude Code transcripts ([b739828](https://github.com/cmdaltctr/omms/commit/b7398282467d07bcbbcb364469a2a4c20b3ff85b))
* restrict the capture route to Claude Code transcripts ([8f7cedd](https://github.com/cmdaltctr/omms/commit/8f7cedd444db5db5371d36cc4bf06c6ea1690047))
* show memory type in search and list output ([a43cddd](https://github.com/cmdaltctr/omms/commit/a43cdddb563b63b2e3cbbbcdbe3bf8b9c2814882))
* show memory type in search and list output ([9df79c6](https://github.com/cmdaltctr/omms/commit/9df79c6afa09ff6b20c68c3f8a4706b92570b206))
* take over a stale web start lock atomically, and keep serving when a restart copy fails ([41153cc](https://github.com/cmdaltctr/omms/commit/41153ccabbedbc5afc00644e025f9d0fb6f9a50a))
* wait for the Node listen result before the web app owns its port, so a ([88fe00c](https://github.com/cmdaltctr/omms/commit/88fe00cfaab828531ce09db984c5b8433c373ace))
* **web:** take over the port under Node when another web app holds it ([e1aa8eb](https://github.com/cmdaltctr/omms/commit/e1aa8eb5c42cb4eade17414cbd104d9569f27187))
* **web:** take over the port under Node when another web app holds it ([d5829d1](https://github.com/cmdaltctr/omms/commit/d5829d16cdf14a6a04f87349f614d9d34f7f3ee2))


### Documentation

* note that a Claude Code hook can start the web app [skip ci] ([8dd32b3](https://github.com/cmdaltctr/omms/commit/8dd32b36efa03eae7abdb7f25c3e72d0f93fbc3e))
* note that the hook uses only the configured web port ([6a1226a](https://github.com/cmdaltctr/omms/commit/6a1226aa08f62d04fcb78a5a358d4d39d67af7b8))
* **openspec:** propose web-power-button and ADR-014 ([9114619](https://github.com/cmdaltctr/omms/commit/911461943751977fdb0dfad162db93eae7d11ad1))
* **openspec:** propose web-version-handover ([45c2433](https://github.com/cmdaltctr/omms/commit/45c2433b25352bbd49af7f640285d037398e0151))
* say only OpenCode runs a web server inside its session ([373dce6](https://github.com/cmdaltctr/omms/commit/373dce611dbedc90a16c7265433062107fbf1d12))

## [3.5.0](https://github.com/cmdaltctr/omms/compare/v3.4.2...v3.5.0) (2026-09-28)


### Features

* list OpenCode models in the standalone web app ([24e262b](https://github.com/cmdaltctr/omms/commit/24e262ba3fe1509fa27b4b5fe676b19ad90fda4d))
* list OpenCode models in the standalone web app ([123b650](https://github.com/cmdaltctr/omms/commit/123b650ed41f66c1f377b917bac4fadcc919a5b5))
* retry failed live captures from a queue on both hosts ([8fdbe15](https://github.com/cmdaltctr/omms/commit/8fdbe1594a79674f75c892d9033dc9c58b70d173))
* retry failed live captures from a queue on both hosts ([5afbcf5](https://github.com/cmdaltctr/omms/commit/5afbcf523850e25e4cf85ce65d30ba94f38b7d16))


### Bug Fixes

* queue only unreachable-model failures and keep live retry claims ([d7038e9](https://github.com/cmdaltctr/omms/commit/d7038e96cca6b25d89746ecce9a5f37c419963b3))
* **web:** bracket IPv6 hosts in the dashboard URL ([ab39a37](https://github.com/cmdaltctr/omms/commit/ab39a37ac5ea87fbb4cdff6d74e2aa43f384b6d4))
* **web:** bracket IPv6 hosts in the web server URL ([ac64ef6](https://github.com/cmdaltctr/omms/commit/ac64ef6ebde29b6778ce111041a8f233636a7f58))
* **web:** print dashboard URL and use a stable Node path for the login item ([5ee203c](https://github.com/cmdaltctr/omms/commit/5ee203c5d1fe2406d9d375dfddb6ba61d916333c))
* **web:** print dashboard URL and use a stable Node path for the login item ([b088f81](https://github.com/cmdaltctr/omms/commit/b088f81d049e22a59fc446b9c9f447780d3f9385)), closes [#43](https://github.com/cmdaltctr/omms/issues/43)


### Documentation

* **ci:** say how to recover when a release merge starts no Release run ([50e4c96](https://github.com/cmdaltctr/omms/commit/50e4c969a9592f098b631df6d8e80a2938a4f168))
* **ci:** say how to recover when a release merge starts no Release run ([866062b](https://github.com/cmdaltctr/omms/commit/866062b34283dba46af0266ac038f8c140b82e00))

## [3.4.2](https://github.com/cmdaltctr/omms/compare/v3.4.1...v3.4.2) (2026-09-28)


### Bug Fixes

* **ci:** allow 30 seconds per test on Windows ([674c33d](https://github.com/cmdaltctr/omms/commit/674c33d0cd654f0af3e69bc73dfcd9d1f0162f83))
* **test:** allow 30 seconds for profile tool runtime tests ([4c8b099](https://github.com/cmdaltctr/omms/commit/4c8b099b5f83c242d5ae02163d64de6bd6ccf618))
* **test:** compare the saved key path as JSON on Windows ([2906c78](https://github.com/cmdaltctr/omms/commit/2906c78b8e76ead43043acafcc5cde7c4a3063d3))
* **test:** compare the saved key path as JSON on Windows ([c8b566c](https://github.com/cmdaltctr/omms/commit/c8b566c67b64af7fb2361ddddf52e536e3ce4c4a))

## [3.4.1](https://github.com/cmdaltctr/omms/compare/v3.4.0...v3.4.1) (2026-09-28)


### Bug Fixes

* **test:** tolerate a locked temp folder on Windows in map suggestion tests ([a04b5be](https://github.com/cmdaltctr/omms/commit/a04b5be5bb4548113e47e1a74c29c087205619f5))
* **test:** tolerate a locked temp folder on Windows in map suggestion tests ([8bf3482](https://github.com/cmdaltctr/omms/commit/8bf34823e7bfd50d3261ef824972958b253aac7a))

## [3.4.0](https://github.com/cmdaltctr/omms/compare/v3.3.1...v3.4.0) (2026-09-28)


### Features

* external API, saved directory maps, and import progress ([cbf2fec](https://github.com/cmdaltctr/omms/commit/cbf2fec739a235526ad84f30614f24a41ea3e151))
* external API, saved directory maps, and import progress ([8d09784](https://github.com/cmdaltctr/omms/commit/8d0978419381e4cf41412d2fcb530eb418c9f218))


### Bug Fixes

* address review findings in backfill controls, maps, and key files ([2ee8061](https://github.com/cmdaltctr/omms/commit/2ee8061b4aa2df1b2bd21d839933db6b7d8542cc))
* **opencode:** keep profile fallback and import model registry ready ([c847d3b](https://github.com/cmdaltctr/omms/commit/c847d3b43655939ca98db55c68ff51d386fbb91d))
* **web:** address review findings in the explorer and Settings page ([dbeb25b](https://github.com/cmdaltctr/omms/commit/dbeb25b03158cb0f9da1e19b7154380a3bdbdc23))
* **web:** save migrated tags and vectors in one update ([e95d1c7](https://github.com/cmdaltctr/omms/commit/e95d1c7c3960c52c7104b319c2ff86161eb13af7))
* **web:** tag migration touches only untagged memories ([72d1722](https://github.com/cmdaltctr/omms/commit/72d1722bcac25f484376bd95a0ff11752a9f7f37))


### Documentation

* archive a completed OpenSpec change before opening its pull request ([b77ae14](https://github.com/cmdaltctr/omms/commit/b77ae14b0de466fd4b4eca1ea9c10278415de105))
* archive auto-backfill-and-web-autostart OpenSpec change ([f242b65](https://github.com/cmdaltctr/omms/commit/f242b65df17e81de7bf1c44350d633f6e46f83f4))
* archive auto-backfill-and-web-autostart OpenSpec change ([290ca79](https://github.com/cmdaltctr/omms/commit/290ca7925c644f4ac1eb4c134355c6d7ca632529))
* **openspec:** archive external-api-backfill-maps-progress ([e71e8f1](https://github.com/cmdaltctr/omms/commit/e71e8f11d0d53010fa0d752d99272397e2e36a7e))
* **openspec:** propose moving OpenCode model code into its adapter ([148658d](https://github.com/cmdaltctr/omms/commit/148658dd17a7277a834f495e57462241d8a2851b))
* settings page guide and plain-language docs audit ([56cc36a](https://github.com/cmdaltctr/omms/commit/56cc36a92119a2b0d608c493acf6a53d7201d772))
* settings page guide, docs audit, and OpenSpec archive ([751d12b](https://github.com/cmdaltctr/omms/commit/751d12b73a05c49718e35cb7a0d267ead87105ab))

## [3.3.1](https://github.com/cmdaltctr/omms/compare/v3.3.0...v3.3.1) (2026-09-27)


### Bug Fixes

* match native Windows import source paths ([c20930f](https://github.com/cmdaltctr/omms/commit/c20930f7d2260e4179423a6e70dbbf2652252a10))
* match Windows paths in web autostart tests ([96230f6](https://github.com/cmdaltctr/omms/commit/96230f60d6f07e3c4e4de243a6876fe0cac53011))
* protect capture traces with Windows ACLs ([a3ab30e](https://github.com/cmdaltctr/omms/commit/a3ab30e66882868ee9eaf3fb7f3426059e6eefcc))
* protect capture traces with Windows ACLs ([1eb4d22](https://github.com/cmdaltctr/omms/commit/1eb4d2291b9917ae5d150bdae66c1386647f01d2))
* reject foreign trace owners and secure retained files ([782fd7d](https://github.com/cmdaltctr/omms/commit/782fd7d6ed3e53ec716b0934a9eef6dcf958c57e))
* restore Windows release smoke tests ([84eac3d](https://github.com/cmdaltctr/omms/commit/84eac3d99e0c5e9453ce105d8a2988fd38e1995c))
* run Windows Git wrapper test without a shell ([532b0b1](https://github.com/cmdaltctr/omms/commit/532b0b1fd26171d46db68f70c16bde22b748bea8))

## [3.3.0](https://github.com/cmdaltctr/omms/compare/v3.2.0...v3.3.0) (2026-09-27)


### Features

* enable automatic history backfill and login web app ([00a6195](https://github.com/cmdaltctr/omms/commit/00a61951007b825895e81c44d5161432c72b5ab7))
* enable automatic history backfill and login web app ([00a6195](https://github.com/cmdaltctr/omms/commit/00a61951007b825895e81c44d5161432c72b5ab7))
* enable automatic history backfill and login web app ([cac7182](https://github.com/cmdaltctr/omms/commit/cac7182734a94a970cb3727f3528bafc15f8bcad))


### Bug Fixes

* **test:** give each isolated test run its own log directory ([e5952ca](https://github.com/cmdaltctr/omms/commit/e5952ca57238157fc6e7702116fe0e136f4c3585))
* **test:** keep test logs, traces, and migrations out of the real ~/.omms ([64105ee](https://github.com/cmdaltctr/omms/commit/64105eea3a47ac3b7e3d63ce70e2a770dbca15d6))
* **test:** keep test logs, traces, and migrations out of the real ~/.omms ([4f02673](https://github.com/cmdaltctr/omms/commit/4f026732e52943bfc06a60159bd6fa5981669777))


### Documentation

* propose automatic history backfill and starting the web app at login ([8f63529](https://github.com/cmdaltctr/omms/commit/8f6352928e17ebd56f8e75cb2aae4cf8a9809258))

## [3.2.0](https://github.com/cmdaltctr/omms/compare/v3.1.1...v3.2.0) (2026-09-27)


### Features

* log every capture attempt and add opt-in capture traces ([fbfffaf](https://github.com/cmdaltctr/omms/commit/fbfffafff6a4c2f9d19a3c01242d5f39b4f43772))
* log every capture attempt and add opt-in capture traces ([5d85f99](https://github.com/cmdaltctr/omms/commit/5d85f993263cf18305731b5b70d21549c15d2691))
* **web:** add a Settings page for models, diagnostics, health, imports, and logs ([e4c7d21](https://github.com/cmdaltctr/omms/commit/e4c7d215ed75cb353393fa20cb34a7975783ef41))
* **web:** choose the language from a sidebar menu ([d4eb823](https://github.com/cmdaltctr/omms/commit/d4eb823811209707c84086478067969703f014e9))
* **web:** Settings page with session-first imports, and a language menu ([08c7aaa](https://github.com/cmdaltctr/omms/commit/08c7aaae46bd6d830960fb293ffd3e8903efdd82))


### Bug Fixes

* address review findings on capture traces and v2 idle events ([a5a74c7](https://github.com/cmdaltctr/omms/commit/a5a74c74a5796a3fa6a7e91fdf708e638c304b13))
* address review findings on web settings, imports, and the language menu ([fed0554](https://github.com/cmdaltctr/omms/commit/fed0554100e0bd8eef202e7e397e593e373a5696))
* **opencode:** list OpenCode models on the Settings page under the v2 plugin ([a694124](https://github.com/cmdaltctr/omms/commit/a69412498240a9343e72f02f07e4b3f324e2c3d3))
* **opencode:** start v2 capture on session.execution.succeeded, since OpenCode 2.0.14 no longer emits session.idle ([5d85f99](https://github.com/cmdaltctr/omms/commit/5d85f993263cf18305731b5b70d21549c15d2691))
* **opencode:** use the v2 plugin's session client for structured output when no server URL is known ([5d85f99](https://github.com/cmdaltctr/omms/commit/5d85f993263cf18305731b5b70d21549c15d2691))
* **pi:** ask the capture model for a single JSON object; the prompt never did, so models answered in key="value" form ([5d85f99](https://github.com/cmdaltctr/omms/commit/5d85f993263cf18305731b5b70d21549c15d2691))
* problems found testing 3.2.0-next against real OpenCode and Pi ([d3c8e2d](https://github.com/cmdaltctr/omms/commit/d3c8e2ddc52a2bb9db1cbbb7cf12a90bc8c4f149))
* stop provider error logs from quoting model replies ([5d85f99](https://github.com/cmdaltctr/omms/commit/5d85f993263cf18305731b5b70d21549c15d2691))
* **web:** ignore stale settings reads and never republish a pre-save snapshot ([442986b](https://github.com/cmdaltctr/omms/commit/442986befb9bf8527a04bcbc35a200e8b484cf62))
* **web:** make trace deletion, cross-section saves, and deep Pi folders work ([3245dd6](https://github.com/cmdaltctr/omms/commit/3245dd63ef90c0792e8846b3adc308d6d1f43f7e))


### Documentation

* add the log section, save conflicts, and project trace opt-out to the web-settings proposal ([a5a74c7](https://github.com/cmdaltctr/omms/commit/a5a74c74a5796a3fa6a7e91fdf708e638c304b13))
* add the web-settings proposal and the CLAUDE.md link to AGENTS.md ([4c32fb7](https://github.com/cmdaltctr/omms/commit/4c32fb7bd28aaa2b62ffd07861ce1f49090d7f20))
* archive the capture-diagnostics change and sync its specs ([6e4301b](https://github.com/cmdaltctr/omms/commit/6e4301b975426b78392a0034b3efcc517eaf6e2c))
* archive the capture-diagnostics change and sync its specs ([4250195](https://github.com/cmdaltctr/omms/commit/42501956512d7f206071e3c746d171ef3571827c))
* archive the release-publishing change after the first CI release ([021ca6b](https://github.com/cmdaltctr/omms/commit/021ca6bf2a0df4bc49602dfed1842b9654b5771d))
* archive the release-publishing change after the first CI release ([ba94ce8](https://github.com/cmdaltctr/omms/commit/ba94ce8eb25c8f466cb5e0d4a5470db30ab01e51))
* archive the web-settings and select-language-from-menu changes and sync their specs ([105688f](https://github.com/cmdaltctr/omms/commit/105688ffffc7d2b8493340198301e74988bedc8a))
* record how release tasks 3.2 and 6.4 were verified ([fcc8c88](https://github.com/cmdaltctr/omms/commit/fcc8c88b8bb5696103be7fe01d890540d6c9f75c))

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
