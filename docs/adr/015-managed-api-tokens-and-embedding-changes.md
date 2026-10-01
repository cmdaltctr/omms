# ADR-015: Managed API tokens and a tested embedding change

**Date:** 2026-09-30
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

Two settings could be changed only in `omms.jsonc`, and both could break OMMS in a way the user did not see.

**The API token.** A web app on a non-loopback `webServerHost` needed `webServerApiToken`. It was one fixed string in the config file. It had no name, no expiry, and no revoke. The server compared it with `===`. To change it, the user edited the file and updated every script that used it. The browser password (`webServerAuthPassword`) could also be set only by hand.

**The embedder.** The embedder turns memory text into search vectors. Each shard stores vectors from one model. A change of `embeddingModel` to a model with a different vector size blocked writes until a re-embed. A change to another model with the same size was not detected at all, so search compared vectors from two models and gave poor results. An embedding server also needed `embeddingApiKey`, so a local Ollama or llama.cpp server needed a made-up key.

The Settings page could show neither setting safely, and could change neither.

## Decision

### API tokens

1. A token table replaces the config key. `src/services/api-tokens.ts` keeps `~/.omms/api-tokens.json` with mode `0600`.
2. A token is `omms_` plus 32 random bytes in base64url. The page shows the value once. The file keeps only a SHA-256 hash, the name, the creation time, the expiry (7, 30, or 90 days, or never), and the last-used time.
3. The server compares hashes with `timingSafeEqual`. It writes the last-used time at most once a minute for each token.
4. A token authorises a request as a bearer token or in the `x-omms-token` header. An expired or revoked token gets `401`.
5. Only a caller on this machine with the local token file (`~/.omms/.auth-token`) can list, create, or revoke tokens. Another machine gets `403`. A local caller without the local token gets `401`.
6. At web app start, OMMS imports `webServerApiToken` once as a token named `from config file` with no expiry. It does not change the config file. From then on, OMMS does not read the key.
7. A web app on a non-loopback host starts only when an unexpired token exists or a browser password is set.
8. `om-memory-system web status` and `web install`, and the start probe, use the local token file. They talk only to a web app on this machine.
9. The page saves the browser password to `~/.config/omms/secrets/web-password.key` (mode `0600`) and writes a `file://` reference to `webServerAuthPassword`.

A SHA-256 hash is enough. The value has 256 bits of entropy, so a slow password hash adds no protection.

The one-time import keeps every current caller working with no action. A config that still sets the key after the import does nothing, so the Keys and access card warns about it.

### Embedding change

1. `embeddingApiUrl` alone selects an embedding server. OMMS sends `embeddingApiKey` as a bearer token only when it is set.
2. The re-embed check flags a shard when its stored `embedding_model` differs from `embeddingModel`, as well as on a size mismatch. A shard with an unknown or `legacy-unknown` model is flagged only on size, so an old store does not need a re-embed after an upgrade.
3. The Embedding card changes the embedder in three steps: test, apply, re-embed.
   - **Test** builds a one-off embedder from the candidate values, embeds one fixed sentence, and returns the vector size. The shared embedder does not change.
   - **Apply** needs a caller on this machine with the local token, and a passing test of the same values in the last 10 minutes. It writes `embeddingApiUrl`, `embeddingModel`, `embeddingDimensions`, and `embeddingApiKey` in one config write. It resets the embedding service and starts the re-embed. It answers `202`.
   - **Re-embed** runs through `MigrationService`. The card shows progress. A retry redoes only the shards that are still out of date.
4. The general settings save refuses the four embedding keys. An embedder change therefore always goes through the test and the re-embed.

An embedder change must re-embed, because vectors from two models cannot be compared. The test stops a wrong URL, model name, or key before OMMS writes the config and starts a long run.

## Consequences

### Positive

- The user can create, name, expire, and revoke tokens without editing files. A leaked token can be revoked alone.
- A lost or stolen token file holds no usable token.
- Current callers keep working after the upgrade.
- A local embedding server works with no key.
- A same-size model change is now detected and re-embedded.
- A bad embedder value fails at **Test**, before OMMS changes the config.

### Negative

- This is a breaking change. A config-as-code setup that changes `webServerApiToken` later has no effect. The user must use the token table.
- If `~/.omms/api-tokens.json` is lost, every token stops working. The local token file still opens the page, and the user generates new tokens.
- A re-embed on a hosted server calls the server once for each memory, which can cost money. Search results are poor until the run ends.
- Running OpenCode and Pi sessions keep their old embedder until they restart.

### Neutral

- Tokens have no scopes. A token grants the same access as the old config key.
- `webServerHost` still cannot be changed on the page.
- Rollback: the previous version reads `webServerApiToken` again, because the import left it in the config file.

## Alternatives Considered

| Option                                                        | Rejected Because                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Keep `webServerApiToken` and let the page edit it             | One shared secret still has no expiry or revoke, and the page would have to show or store the value. |
| Read both the config key and the table                        | Two sources for one secret. A revoke in the table would not stop a key that stays in the config.     |
| Store tokens with a slow password hash                        | The value has 256 bits of entropy. A slow hash adds cost to every request and no protection.         |
| Let the general settings save change the embedding keys       | A save without a re-embed leaves vectors from two models in the store and breaks search.             |
| Apply without a test                                          | A wrong URL or model name starts a long re-embed that fails on every memory.                         |
| A new `embeddingApiKeyRequired` key set by the preset         | It adds state that can drift from the URL. The Keys card decides from the URL host instead.          |
| Flag every shard with an unknown stored model after upgrading | It forces a paid re-embed on old stores that are already correct.                                    |

## References

- OpenSpec change `settings-keys-embedding-claude`
- `src/services/api-tokens.ts`, `src/services/web-api-auth.ts`, `src/services/web-password.ts`
- `src/services/embedding.ts`, `src/services/embedding-change.ts`, `src/services/migration-service.ts`
- `tests/api-tokens.test.ts`, `tests/embedding-server-key.test.ts`, `tests/turso-reembed-migration.test.ts`
- ADR-007: Edit the global config from the web UI
- ADR-010: Save a pasted external API key to a private key file
- [Upgrading: API tokens](../upgrading.md#api-tokens-replace-webserverapitoken)
