# Spec #288: Shared API client (`fetchJson`) in pulse-contract

Step S2 of #166. Inputs: the issue and `.factory/work/288/issue-review.md` (findings and open points; this plan decides them).

## Goal

One JSON API client in pulse-contract, next to the validators it calls. probe, status (server side and browser poller) and notify replace their own timeout, size-cap and wire-check code with it.

## Scope and non-goals

- In scope: contract (new module + export + docs), probe `src/client.ts` (`loadChecks`), status `src/poller.ts`, `src/api-poll.ts`, `src/server.ts` (`fetchUpstream`, contract-module allow-list), notify `src/api.ts` (and `src/timeout.ts` only for the API call path).
- Out of scope: pulse-kit (S4), pulse-api, config. probe `postResult` (POST without body) and notify outgoing channels (`channels/http-post.ts`, which still uses `fetchWithTimeout`) are not API GETs: `src/timeout.ts` stays in notify for them.
- No new dependency in any repository.

## Decisions (resolving the open points of the review)

1. **Name and file**: `fetchJson` in `src/client.ts` of contract, exported from `src/index.ts` with its types. No `node:` imports, only web APIs (`fetch` type, `AbortSignal`, `AbortController`, `Response.body` reader, `TextDecoder`). Package `exports` stays `.`.
2. **Signature** (single options object):
   ```ts
   fetchJson<T>(url: string | URL, options: {
     fetch: typeof fetch;                       // injected
     validate: (raw: unknown) => Validation<T>; // contract validator, e.g. (raw) => validateCheckList(raw)
     timeoutMs: number;                         // covers headers AND body
     signal?: AbortSignal;                      // combined with the timeout via AbortSignal.any
     maxBytes?: number;                         // default DEFAULT_MAX_BODY_BYTES = 5 MiB (5 * 1024 * 1024), exported + documented
     headers?: HeadersInit;
     onWireAbsent?: () => void;                 // called per response when the header is absent
     schedule?: (fn: () => void, ms: number) => () => void; // optional timer injection (returns cancel); default setTimeout/clearTimeout
   }): Promise<FetchJsonResult<T>>
   ```
   Result never throws for expected failures:
   `{ ok: true; value: T; wire: "ok" | "absent" } | { ok: false; error: FetchJsonError }`.
   `FetchJsonError` is a union on `kind`: `timeout {timeoutMs}`, `aborted {reason}`, `network {cause}` (fetch rejects for another reason; `cause` preserved so notify can copy `code`), `http {status}`, `too-large {maxBytes}`, `invalid-json {message}`, `wire-mismatch {message}` (the text of `checkWireVersion`), `validation {message, path?}` (message from the validator, which already contains the path).
3. **Timeout**: the timeout is enforced by a timer (own `AbortController` aborted by the timer, combined with the caller's `signal` through `AbortSignal.any`) AND by racing the whole operation (headers + body read) against the timer, so a stalled `fetch` that ignores the signal still times out. Timeout vs caller abort is told by the own timer flag, not by `signal.reason`: if the caller signal is aborted first the error is `aborted`. `schedule` is the injection point; it keeps notify's and status's fake-timer tests working (probe's `timeoutSignal` injection maps onto it or is replaced in its test). The timer is always cleared.
4. **Size cap**: bytes. Check `Content-Length` first (too large before reading); then stream with the body reader and count bytes, abort at `maxBytes` (`too-large`). If `response.body` is missing, read `text()` and compare the UTF-8 byte length. No content-type check in the client.
5. **Order of checks**: HTTP status first, then wire header, then size/body, JSON, validation. (Notify today checks the wire before status.) Difference accepted and documented: a non-2xx response with a mismatching header yields `http` in notify instead of the wire error. To keep information, the `http` error also carries `wire: WireVersionCheck`, so a consumer (status proxy) can still see a mismatch on a non-OK response.
6. **Wire**: `absent` is tolerated, `onWireAbsent` is called on every such response; consumers keep their own once-per-logger/poller logic. `mismatch` is the typed error `wire-mismatch`.
7. **Validator with item skipping**: probe and notify pass an array-level validator (`Array.isArray`, returning the `unknown[]`) and then run `validateCheck` per item themselves, skipping and logging as today. Status validates whole responses with the contract validators as today.
8. **Status proxy** (`fetchUpstream`): uses `fetchJson` with a pass-through validator (`unknown`) for timeout, cap and wire check. It keeps itself: the `application/json` content-type check (done on the response through a thin wrapper around the injected `fetch` that records the content-type, or by checking the header inside the wrapper), `filterApiBody`, forwarding of non-OK statuses, and forwarding of the upstream wire header. Wire mismatch from upstream must still reach the page so that the page poller shows `version` (do not turn it into 502): the proxy reads the wire info from `FetchJsonResult.wire` / the error's `wire-mismatch` and `http` variants and forwards the original header value. Behavior changes documented: bodies above the cap give 502 `invalid API response`-style error; order of status and wire.
9. **Status browser poller** (`src/poller.ts`, served as `/poller.js`): uses `fetchJson` imported from the served contract module. `server.ts` `contractModules` allow-list (`index,schema,validate,version`) gets `client`, and `server.contract-modules.test.ts` is extended. `AbortSignal.any` is required: document the browser floor (Chrome 116, Firefox 124, Safari 17.4) in status docs. `withPlaceholders`, optional-endpoint swallow logic and error kinds `version` / `invalid` / `unreachable` stay in status and are mapped from the typed errors (`wire-mismatch` -> `WireVersionError` -> `version`; `validation`/`invalid-json`/`too-large` -> `invalid`; `timeout`/`network`/`http`/`aborted` -> `unreachable`). Optional endpoints keep swallowing everything except wire mismatch.
10. **Status readiness poll** (`src/api-poll.ts`): already checks the wire header and records `mismatch`; it now goes through `fetchJson` (pass-through validator, since it only needs reachability), gaining the body cap, the shared timeout and the same typed errors; its metrics (`ok`/`mismatch`/etc.) and the once-only absent log stay.
11. **Error messages**: each consumer maps typed errors to its current messages: probe `timed out after 10000ms`, `HTTP <n>`, `contract version mismatch: ...`; notify `timeout after <n>ms`, `GET <path> returned <n>`, `GET <path> response is larger than <n> bytes`, with its API-URL redaction and `code` copying from `cause`; status `<url> returned HTTP <n>`. Probe maps `aborted` to `StartupAbortedError` as today.
12. **Behavior differences accepted and documented**: probe and status gain the 5 MiB cap; status/probe/notify share one status-before-wire order; the readiness poll validates the body shape only as far as JSON parse and cap.
13. **Pinning**: contract is merged first. Each consumer pins the merged contract commit in `package.json` and lockfile (`github:lorenzh/pulse-contract#<sha>`), replacing `c98a2d45…`. The consumers do not depend on each other.

## Risks

- Fake-timer tests in notify and status break if the timer is not injectable: hence `schedule`.
- The browser module must stay free of Node imports and be in the status allow-list, otherwise `/poller.js` fails to import in the page.
- Raced timeouts leave a pending `fetch`: the own `AbortController` must be aborted on timeout and on cap.
- Coverage gate in contract (80% lines).

## Acceptance evidence

- contract tests: stalled headers -> `timeout`; stalled body -> `timeout`; fetch that ignores the signal -> `timeout`; cap with and without `Content-Length`; wire ok / absent (callback called) / mismatch; HTTP status; invalid JSON; validation error with path; caller abort -> `aborted` vs timeout; `package.json` dependencies unchanged; no `node:` import in `src/client.ts`.
- In probe, status and notify: `grep` finds no `abortable`, no `abortion` and no own size/wire code in the API paths and finds `fetchJson`; existing behavior tests pass, with only the documented message/order differences adapted.
- status: readiness poll records `mismatch` via the shared client; `server.contract-modules.test.ts` covers `client.js`.
- Each consumer pins the merged contract commit; `npm run` checks (lint, typecheck, test) are green in each repo.

## Repository: contract

Files: new `src/client.ts` (client, `DEFAULT_MAX_BODY_BYTES`, `FetchJsonError`, `FetchJsonResult`, options type), `src/index.ts` export, new `test/client.test.ts`, `README.md` and `docs/index.md` (API, defaults, error kinds, order of checks, browser floor for `AbortSignal.any`), and the type fixture `test/types.fixture.ts` if it lists exports.
Behavior: as in decisions 1 to 6. Checks: lint, typecheck, build (`dist` contains the client), tests with the coverage gate.
Completion: PR merged to main; the merged commit sha is what consumers pin.

## Repository: probe

Files: `src/client.ts` (`loadChecks` uses `fetchJson`; delete `abortable`, own timeout and wire handling), `src/client.test.ts` (adapt the injection of the timeout; add a test for the size cap), `package.json` + lockfile (pin), docs (`README.md`/`docs/`: cap, timeout, shared client).
Behavior: decisions 7, 11, 12. Invalid items are still skipped and logged, heartbeats dropped, the absent header still logged once per logger, shutdown `signal` still yields `StartupAbortedError`. `postResult` unchanged.
Completion: checks green, PR with `Closes lorenzh/pulse-meta#<child>`.

## Repository: status

Files: `src/poller.ts`, `src/api-poll.ts`, `src/server.ts` (`fetchUpstream`, `contractModules` allow-list), `src/server.contract-modules.test.ts`, `src/poller.test.ts`, `src/api-poll.test.ts`, `src/server*.test.ts` (cap and wire-forwarding tests), `package.json` + lockfile, docs (cap, browser floor, shared client, order change).
Behavior: decisions 8, 9, 10, 11, 12. Error kinds and metrics unchanged; the proxy keeps content-type check, filter, status and wire-header forwarding.
Completion: checks green, the page poller loads the new contract module (allow-list test), PR with `Closes lorenzh/pulse-meta#<child>`.

## Repository: notify

Files: `src/api.ts` (use `fetchJson`; delete own `readJson`, size and wire code), `src/timeout.ts` (keep `fetchWithTimeout` for `channels/http-post.ts`; remove only what the API path alone used), tests in `test/` and next to the sources (messages, redaction, fake-timer schedule via `schedule`, cap), `package.json` + lockfile, docs.
Behavior: decisions 7, 11, 12. Error texts, URL redaction, `code` copying, 5 MiB default and metrics unchanged; the status-before-wire order change is documented.
Completion: checks green, PR with `Closes lorenzh/pulse-meta#<child>`.
