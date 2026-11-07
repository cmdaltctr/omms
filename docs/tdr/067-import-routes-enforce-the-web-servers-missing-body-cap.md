# TDR-067: Import routes enforce the web server's missing body cap

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** web-api, memory-spaces, import, body-limit

## Context

The space import routes must accept an export file of up to 100 MB (design D9). Task 8.1 first checked what body limit the web server already enforces.

### Root Cause Analysis

The web server sets no request body limit anywhere. `Bun.serve` is created without `maxRequestBodySize` (`src/services/web-server.ts`), the Node adapter buffers the body with no cap, and every handler calls `req.json()` directly. So no route has a limit today, and a server-wide limit raised to 100 MB would expose every route to 100 MB bodies.

The upload also cannot be a file upload in the usual sense: the repo has no multipart handling (`formData` appears nowhere in `src/`), so a `multipart/form-data` body would arrive with no parser.

## Decision

The import routes enforce their own cap in `src/services/space-transfer-routes.ts`:

- `IMPORT_MAX_FILE_BYTES` is 100 MB (from `src/services/spaces/import-space.ts`, one constant with the import validation).
- A 64 KB envelope (`IMPORT_ENVELOPE_BYTES`) is added for the JSON around the file: the space name, the project folder and the field names.
- The cap is checked against `content-length` first and against the read body second, so a lying header does not bypass it. A body over the cap answers `413 file-too-large`.
- The upload travels as one JSON body `{ document, ... }`, where `document` is the already-parsed export file. The check route (`POST /api/spaces/import/check`) takes the same shape.

## Consequences

### Positive

- Only the import routes take large bodies; every other route keeps its behaviour.
- The cap lives in one place and is covered by a route test (a 20 MB body passes).
- The web route and the CLI share one document schema, with no upload-specific code path.

### Negative

- The browser page must read and parse the file into JSON before it sends, which costs memory in the tab for a large file.
- The 64 KB envelope is an allowance, not a measured bound.

### Neutral

- A declared `content-length` over the cap is refused before the body is read.

## Alternatives Considered

| Option                         | Rejected Because                                              |
| ------------------------------ | ------------------------------------------------------------- |
| Raise a server-wide body limit | Every route would accept 100 MB bodies                        |
| Add multipart handling         | A new parser for one route is more surface than a JSON body   |
| Stream the upload              | Validation needs the whole JSON document before anything runs |

## How to Recognise / Handle This Again

1. Symptom: a route needs bodies larger than a few MB.
2. Check whether the web server gained a body limit first; until it has one, scope the cap to the route that needs it.
3. Check `tests/web-space-transfer-routes.test.ts` ("accepts a 20 MB body on the import check route") for the pattern.

## Revisit Triggers

- A body limit lands in the web server itself.
- Another route needs large uploads.
- The export format stops being JSON.
