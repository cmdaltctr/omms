# Security triage: normalise-profile-categories

## Scope and status

- Scope: the uncommitted category change against `HEAD` (`1b0a6a3`).
- The user approved investigation of the scanner alerts, then instructed us to ignore further security checks and run task 7.1. Existing detections remain recorded; this instruction does not establish that the repository is secure.
- Raw repo-wide scanner verdict: **BLOCKED**, unchanged.
- Scan counts: 21 CRITICAL, 8 HIGH, 34 MEDIUM, 3 LOW. These are detections, not confirmed vulnerabilities.
- Changed-file Aikido scan: 16 files scanned, zero findings, no skipped paths. The command test was scanned again after its cleanup fix, with zero findings.
- Independent source review remains incomplete. No archive or release approval is given.

## Secret alerts: evidence and proposed classification

No suspected credential values are included below. No credentials were tested against a live service.

| Alerts | Location                                                                       | Evidence                                                                                                                                                                                                                                                                                               | Proposed classification                    |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 1      | `graphify-out/cache/stat-index.json:1`                                         | The generated cache contains numeric file metadata and hexadecimal file hashes. The current cache has 382 hashes; all are hexadecimal digests. It contains no source text or credentials. The cache was refreshed after the original scan, so the original column no longer identifies the same field. | Generated metadata false positive.         |
| 6      | `tests/fixtures/opencode-v2-api-model.json:13,34,55`, current and history      | All three `settings.apiKey` values equal the explicitly named `FAKE_KEY` in the standalone-model test.                                                                                                                                                                                                 | Synthetic fixture values, detected twice.  |
| 2      | `tests/opencode-standalone-models.test.ts:14`, current and history             | The `FAKE_KEY` constant supplies fake model replies through the local test harness.                                                                                                                                                                                                                    | Synthetic fixture value, detected twice.   |
| 2      | `tests/settings-health.test.ts:17`, current and history                        | A synthetic key is passed into `safeHealthError`; the test asserts that the error removes it.                                                                                                                                                                                                          | Redaction test value, detected twice.      |
| 2      | `tests/privacy-malformed-tags.test.ts:4`, current and history                  | A short synthetic key is inserted into malformed private tags; tests assert that storage-facing text removes it.                                                                                                                                                                                       | Privacy test value, detected twice.        |
| 2      | `tests/capture-diagnostics.test.ts:165`, historical line 125                   | The AWS-shaped literal uses a sequential alphabet suffix in the redaction samples.                                                                                                                                                                                                                     | Synthetic redaction value, detected twice. |
| 2      | `tests/capture-diagnostics.test.ts:168`, historical line 128                   | The token-shaped sample has an HS256 header and a public example subject. Its decoded signature is 12 bytes; HS256 signatures require 32 bytes. The test passes it only to the redactor.                                                                                                               | Invalid synthetic token, detected twice.   |
| 1      | Historical `src/services/ai/opencode-provider.ts:75`                           | The matched constant is named `OAUTH_CLIENT_ID`, a public client identifier rather than a client secret.                                                                                                                                                                                               | Public OAuth metadata.                     |
| 1      | Historical `src/services/ai/opencode-provider.ts:77`                           | The matched constant is `OAUTH_REQUIRED_BETAS`, a list of versioned feature headers.                                                                                                                                                                                                                   | Public feature-header metadata.            |
| 2      | Historical `wiki/Auto-Capture-System.md:441` and `wiki/Troubleshooting.md:204` | Both curl examples use an explicit "your API key" placeholder.                                                                                                                                                                                                                                         | Documentation placeholders.                |

The flagged tracked fixture files are unchanged against `HEAD`. Eight detections repeat current fixtures in git history. Four additional detections occur only in historical OAuth code and wiki examples. The generated cache alert is outside the first-party code change.

No live secret has been confirmed by this inspection. This classification does not prove credentials are invalid through an external service; the evidence is their construction and use in the repository.

## Other scanner detections

The researcher completed a bounded advisory check against official GitHub/OSV records through Tavily. Eighteen detections reduce to ten advisories across six package/version pairs. Eight HIGH detections represent five advisories. Affected version ranges were confirmed; exploitation in OMMS was not established.

| Package                                  | Advisory evidence                                                                                                                                                                                                                  | Fixed version                                              | OMMS usage and remaining uncertainty                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime transitive `sharp@0.34.5`        | [GHSA-f88m-g3jw-g9cj](https://osv.dev/vulnerability/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), HIGH | `0.35.0`, `0.35.4`, `0.35.5`, respectively                 | Transformers supplies the dependency. `embedding.ts` uses text feature extraction; no direct image decoding was found. Native deployment conditions were not checked.                                                                     |
| Development `http-cache-semantics@4.2.0` | [CVE-2026-93748 / GHSA-ch52-4w7c-c8xp](https://github.com/advisories/ghsa-ch52-4w7c-c8xp), HIGH                                                                                                                                    | None listed                                                | Dependency chain starts at `@opencode/plugin`. Shared-cache exposure was not established. The maintainer disputes the advisory in [issue 10139](https://github.com/github/advisory-database/issues/10139); its validity remains disputed. |
| Web build `source-map-js@1.2.1`          | [CVE-2026-93749 / GHSA-68fv-2mgg-jv7q](https://github.com/advisories/ghsa-68fv-2mgg-jv7q), HIGH                                                                                                                                    | `1.2.2`                                                    | PostCSS/Vite and Tailwind supply the dependency. Attacker-controlled indexed source maps were not established.                                                                                                                            |
| Runtime transitive `protobufjs@7.6.2`    | [CVE-2026-54269](https://github.com/advisories/GHSA-f38q-mgvj-vph7), [CVE-2026-59877](https://github.com/advisories/GHSA-j3f2-48v5-ccww), MEDIUM                                                                                   | `7.6.3` and `7.6.5`; the 8.x fixes are `8.6.0` and `8.6.6` | Transformers/ONNX Runtime Web and Pi/Google GenAI supply it. Attacker-supplied schema names or `.proto` parsing were not evidenced.                                                                                                       |
| Runtime `hono@4.13.5`                    | [CVE-2026-93981 / GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv), MEDIUM                                                                                                                                  | `4.13.7`                                                   | No Hono JSX use appeared in the bounded `src` search. Affected server rendering remains unverified.                                                                                                                                       |
| Web runtime `dompurify@3.4.14`           | [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [GHSA-p98j-92pf-mc4p](https://osv.dev/vulnerability/GHSA-p98j-92pf-mc4p), currently LOW                                                                  | `3.4.16`                                                   | `markdown.ts` sanitises an HTML string. The required `IN_PLACE` mode and removal hooks were not found. The first advisory was MEDIUM in the scanner report; the researcher's current official record says LOW.                            |

The manifests and lockfiles are unchanged against `HEAD`. No new dependency or affected use was identified in the category change. This does not accept the existing advisories as safe. Deployment behaviour remains unverified, and Context7's supplementary lookup hit its monthly quota.

Research evidence: `/Users/aizat/.pi/agent/omps/runs/01a121c2-1102-74a9-b7fe-c4d2051c0716/20918f98-7283-47cd-bc9b-bca700694a6e/output.md`.

No dependency risk has been accepted. Workflow and other repo-wide detections remain outside the category change's source review; they have not been silently dismissed.

## Verification evidence

- New focused category tests: 33 passed.
- Workflow regression tests passed.
- `bun run ci:local`: first exit 1 from test config leakage; after cleanup was fixed, real exit 0.
- Passing CI log: `/tmp/omms-normalise-profile-categories-ci.qXRHUI`.
- Package checks and strict OpenSpec validation passed.
- Raw scanner reports: `/tmp/omms-category-review.Une0me/`.

## Required next actions

1. Ask the user to approve the evidence-based false-positive classifications above before lowering the scanner verdict.
2. Ask the user whether to handle the existing dependency advisories in separate work or before the category change continues. Keep unverified deployment risks explicit.
3. Resume the independent source review with the raw findings and this triage available.
4. Leave live repair, import, archive and git actions deferred until separately approved.
