# Spec #309: API ops endpoints answer wrong methods with JSON

## Goal
`/healthz`, `/readyz` and `/metrics` in pulse-api answer a wrong method with `405`, content type `application/json` and body `{"error":"method not allowed"}`, like every other API route and as `docs/rest-api.md` documents.

## Scope
Only `pulse-api`. The fix is in the API: kit's `handleOps` only offers a plain-text 405 (`sendWrongMethod`) and no hook, so no kit change is needed.

## Non-goals
- No change to `pulse-kit` or `pulse-status` (status likely has the same text 405; consider a follow-up issue).
- GET behavior (200/503 bodies, content types), unknown-path 404 and other routes stay unchanged.
- HEAD stays unsupported by the API (it gets the JSON 405).

## Required behavior
- For an ops path (query string ignored, same rule as kit: `url.split("?")[0]`) with any method other than GET (POST, PUT, DELETE, HEAD, ...), the API answers `405`, the JSON error body above via the existing `HttpError`/`sendError` path, and header `Allow: GET`. No token needed.
- The `Allow` header is new on these routes: the current code sends none (the issue says "as before", but code and docs show none). Other routes' 405 stay unchanged.
- Metrics (`recordRequest`, route label via `routeOf`) and security headers apply as for other 405s; the route label for these paths stays as today.

## Risks
- Wrong-method check must run before `handleOps` and use the same path matching, else `/healthz?x=1` with POST still gets text.
- Existing tests that read the old plain-text 405 must be updated.

## Acceptance evidence
For each of `/healthz`, `/readyz`, `/metrics` (also with a query string), POST, PUT, DELETE and HEAD answer 405, API JSON content type, body `{"error":"method not allowed"}`, `Allow: GET`. GET is unchanged. The new regression tests fail on current main (text/plain) and pass after the change. `docs/operation.md` and `docs/rest-api.md` agree. `npm test` and lint pass.

## Repository: api
Files: `src/server.ts` (`serveOps`, ~line 266), a server test file (e.g. `src/server.test.ts` or a new ops test), `docs/operation.md` (~line 123), `docs/rest-api.md` (line 22 and the `/healthz` and `/metrics` sections).
- In `serveOps` (or just before it), for ops paths with a method other than GET throw `HttpError(405, "method not allowed")` with `headers: { Allow: "GET" }` (reuse `err.headers` support), handled by the normal error path. Leave `handleOps` for GET.
- Tests: for all three routes, with and without query string, POST/PUT/DELETE/HEAD assert status 405, JSON content type, body, `Allow: GET` (HEAD: status and headers only). Keep GET tests. Update any test expecting text.
- Docs: in `operation.md` drop "with the text `method not allowed`" and "These endpoints come from `pulse-kit`" for wrong methods; state the JSON 405 and `Allow: GET`. In `rest-api.md` state the same for the ops sections. Both must agree; `troubleshooting.md` stays valid.
- Completion: tests fail before the change and pass after; `npm test` and lint pass.
