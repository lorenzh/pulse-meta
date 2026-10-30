# Issue review: #309 API ops endpoints answer wrong methods with plain text

## Verified current state
- `api/src/server.ts` `serveOps` calls kit `handleOps` without `allowHead`. For `/healthz`, `/readyz`, `/metrics` with any method other than GET, kit answers `405 text/plain` `method not allowed\n` (`kit/src/ops-server.ts`, `sendWrongMethod`).
- Every other API route throws `HttpError(405, "method not allowed")`, which `sendError` renders as JSON. `docs/rest-api.md` (line 22) says another method on a known path gives `405` with `method not allowed`.
- `docs/operation.md` (line 123) says a wrong method on the three paths answers `405` with the text `method not allowed`. This is the text-vs-JSON disagreement.
- Kit offers only `methodNotAllowed: "404" | "405"`. It has no hook for a custom wrong-method response.
- HEAD is not passed as allowed by the API, so HEAD today also gets 405.

## Open points (none blocks the spec)
1. "`Allow` header as before": the current API source has no `Allow` header on any 405 (grep in `src` finds none, and no doc mentions it). The issue premise is not matched by the code. Assumption: send `Allow: GET` on the three ops routes (HEAD is not served by the API) and keep other routes unchanged. If `sendError`/`HttpError` already supports `headers` (it does: `err.headers`), reuse it. The spec should say that the `Allow` header on ops routes is new, and document it.
2. Fix location. Smallest fix is in `pulse-api` only: in `serveOps` (or before it), for an ops path with a method other than GET, throw/send the standard `HttpError(405, "method not allowed")` with the JSON body and return. No kit change is needed. A kit change (hook or option) is the alternative, but would add a dependency chain (kit, then api) for one consumer. Assumption: api only. `targets.json` = `[{"name":"api","dependsOn":[]}]`.
3. Path matching must stay consistent with kit: query strings are ignored (`url.split("?")[0]`). The API check must use the same path rule so `/healthz?x=1` with POST also gets JSON.
4. Metrics: the response goes through the normal server wrapper, so `recordRequest` (route label via `routeOf`) and security headers apply as for other 405s. Check that the route label for these paths stays as today.
5. `pulse-status` also uses kit `handleOps` and likely has the same text 405. It is out of scope for this issue (not named). The spec should not touch it; consider a follow-up issue if its docs promise JSON.
6. Docs: `docs/operation.md` line 123 must drop "with the text `method not allowed`" and the claim that the behavior comes from `pulse-kit` for wrong methods. `docs/rest-api.md` (line 22, and the `/healthz` and `/metrics` sections) must state the JSON 405 body and the `Allow` header. Both docs must agree. `docs/troubleshooting.md` line 101 stays valid.
7. Any other API-side caller that reads the plain-text 405 (tests in `test/`) must be updated for the new body.

## Assumptions
- Behavior for GET is unchanged (200/503 bodies, content types). HEAD stays 405 (now JSON, `Allow: GET`).
- Unknown paths remain 404 JSON, unchanged.
- Body is exactly `{"error":"method not allowed"}` with the API's JSON content type via `sendError`.

## Derived acceptance check
For each of `/healthz`, `/readyz`, `/metrics` (also with a query string), `POST`, `PUT`, `DELETE` and `HEAD` requests to the API answer `405`, `content-type` the API JSON type, body `{"error":"method not allowed"}`, and `Allow: GET`; no token is needed. GET responses are unchanged. Regression tests for all three routes fail on current `main` (text/plain body) and pass after the change. `docs/operation.md` and `docs/rest-api.md` describe the same behavior. `npm test` and lint pass in `pulse-api`.
