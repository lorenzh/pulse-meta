# Spec #163: API: bound and order probe results

## Goal
One probe token must not bypass quorum, and old or replayed results must not rewrite live state. Bound the `POST /results` input, order results per location, harden the token file, and add security headers.

## Scope
Only the `api` target changes (code, tests, docs, `.env.example` stays). `contract` gets no change: the `Result.timestamp` comment has no runtime effect and the bounds live in the API docs (the issue allows leaving it). `probe` needs no change: its reasons are short error or keyword texts, its `attempts` is at most `retries + 1` (`MAX_RETRIES` is 10 in the API config), and `timestamp` is the start of the first attempt.

## Non-goals
- No change to the quorum rules (`quorumStatus`, `applyResult`, window size).
- No migration or cleanup of rows already stored with future timestamps (assumption: none wanted; the docs may mention that an operator can delete them).
- No bound on `certDaysLeft` (not asked).
- The compose demo tokens (`demo-public-token-eu-0001`, `demo-public-token-us-0002`) stay accepted, so the demo stack starts. They appear in neither `.env.example` nor the docs.

## Decisions (made by this plan)
- Constants in `src/server.ts` (exported, used by tests and named in docs):
  - `MAX_FUTURE_SKEW_MS = 60_000`.
  - `MAX_RESULT_AGE_MS = 7 * 86_400_000` (7 days). A retried result is at most one interval old, and a probe may buffer while the API is down, so the bound is well above any realistic interval. Older results are rejected, not stored.
  - `MAX_REASON_LENGTH = 1000`: reject with 400 naming `reason` (no silent truncation, so the contract stays visible). The reason is measured in UTF-16 code units (`string.length`).
  - `MAX_ATTEMPTS = 100` (the probe cap is 11).
  - `MAX_LATENCY_MS = 86_400_000` (optional upper bound; keep it, name it in the docs).
  - `statusCode`: null or integer 100-599.
- `timestamp` check needs a clock: `validateResult(body, now)` takes the current time (`Date.now()` in the server; the service's injected `now` for tests, or a `now` option of the server). Every message names the field, e.g. `timestamp must be an integer (epoch ms)`, `timestamp is more than 60000 ms in the future`, `timestamp is older than 7 days`.
- Late result: strictly older (`<`) than the newest stored result of the same location and check. An equal timestamp is not late (processed as today, ties by id). A late result is inserted into `results` (history) and ingest returns before the `inWindow`/`updateLast`, window evaluation, incident and `updateState` code. It touches neither `checks` state, nor `consecutiveDown`, nor incidents, nor the last timestamp/reason.
- Cross-location guard: a resolve (and open) action never writes a timestamp earlier than the open incident's `openedAt`. When `action === "resolve"` and `result.timestamp < openedAt`, use `max(result.timestamp, openedAt)` for `resolvedAt`, so `resolvedAt >= openedAt` always. Quorum is unchanged; only the stored time is clamped.
- Late rows can enter later windows only as part of the window query, which already picks the newest row per location by timestamp; a late row is by definition not the newest of its location, so it cannot become that location's "latest". Pin this with a test.
- Token file: reject any token containing whitespace (`/\s/`) and a denylist of the documented example tokens (`example-token-change-me-0000`, `example-token-0123456789abcdef`), in addition to the `replace-with-` prefix. Errors never print the token and name `tokens[i]` and the location, as the existing messages do.
- Docs example token: change `example-token-0123456789abcdef` in `docs/rest-api.md` to a value the API accepts (not on the denylist, e.g. `curl` using a `$PULSE_PROBE_TOKEN` shell variable or `0f3c9a7e51b84d26a1c7e9b03d5f8a42`). Do not reintroduce a denylisted value.
- Security headers on every response from one place (the `sendJson`/`sendError` paths, the 204 path and the CORS/OPTIONS path, ideally one `writeHead` wrapper or `res.setHeader` at the top of the request handler, so 401/404/413/500 get them too): `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. Must not overwrite existing headers (CORS, `WWW-Authenticate`).

## Required behavior
1. `POST /results` rejects with 400 and a message naming the field: non-integer timestamp (1.5, string, NaN), timestamp more than 60 s in the future, timestamp older than 7 days; `reason` over 1000; `attempts` not an integer, below 1 or above 100; `latencyMs` not finite, below 0 or above the cap; `statusCode` not null and not an integer 100-599. Edge values (timestamp now+60 s, reason of exactly 1000, attempts 1 and 100, statusCode null, 100, 599, latencyMs 0) are accepted.
2. Late results (as defined above) are stored and visible in the results history but do not change live state. Results of other locations keep their quorum role.
3. `resolvedAt >= openedAt` for every incident.
4. Token file rules as above; clean startup error with exit status as the existing `TokensError` path.
5. Security headers on all responses.

## Risks
- A probe with a clock ahead of the API by more than 60 s gets 400 forever; document in `troubleshooting.md`. The implementer checks what the probe does on 400 (drop and log vs. retry) in `.repos/probe` and states it in the docs.
- `.env.example` is copied to `.env` and the example token is now rejected at start. Intended; docs say "replace the token" and the troubleshooting entry explains the error. Also state that the Compose demo stack (own tokens in `compose.yaml`) still starts.
- The late-result rule changes behavior a test locks in; that test is changed deliberately.

## Acceptance evidence
`npm test`, lint and typecheck (per `AGENTS.md` of api) pass. Every new test fails on the old code:
- server/validation tests: timestamp (1.5, far future, older than max age, boundary ok), reason, attempts, latencyMs, statusCode; each message matches the field name.
- service test: two locations down with an incident open, then a strictly older `up` of the same location: stored in `listResults`, incident stays open, `state` and `consecutiveDown` unchanged. A same-location equal-timestamp result is not late. A different location's result still takes part in quorum. A cross-location resolve with a timestamp older than `openedAt` gives `resolvedAt === openedAt`.
- token tests: `parseTokens` throws `TokensError` for both example tokens and for tokens with space, tab, newline, and leading/trailing whitespace; message has no token; a test reads `.env.example` and all `docs/*.md` for `token` strings (`example-token-*`, `Bearer <value>`, `PULSE_PROBE_TOKEN=<value>`) and asserts none is accepted by `parseTokens` unless it is a demo token; the new docs token is accepted.
- header test: 200, 204, 400, 401, 404, 413 and OPTIONS responses carry all three headers.

## Repository: api
Files:
- `src/server.ts`: constants, `validateResult(body, now)` with new rules (split into small helpers to keep the lint complexity rule satisfied), call site passes the clock, security headers for all responses.
- `src/service.ts`: `ingest`: query the newest stored timestamp of the same location and check (before or after the insert, but compare to previously stored rows; equal is not late); late results return after the insert. Clamp `resolvedAt`.
- `src/tokens.ts`: whitespace check and example-token denylist (exported constant).
- Tests: `src/service.quorum.test.ts` (the test containing "late result at t=150: window sees a up, only" currently asserts `state === "up"`; change it to assert the state stays `down` and the late row is in history), new cases in `service.test.ts`, `server.test.ts`, `server.auth.test.ts` or a new `server.headers.test.ts`, `tokens.test.ts`. Also grep other tests for out-of-order timestamps or timestamps far from the test clock that the new bounds would reject, and fix them.
- Docs: `docs/rest-api.md` (validation rules table with constants, 400 messages, security headers, working example token), `docs/concepts.md` (late results: stored, no state change, per location, tie rule, resolvedAt clamp), `docs/troubleshooting.md` (new token errors, 400 `timestamp` and clock skew), `docs/install.md` and `docs/configuration.md` (the `.env.example` token is rejected, replace it), `docs/development.md` if file descriptions change.
- Compose quick start and CI (added by the approver): `.env.example` and the quick start would now fail at startup, and `scripts/compose-e2e.sh` copies `.env.example`, so the `compose-e2e` CI job would go red. Change `.env.example` to a `replace-with-` placeholder (rejected with the existing clear message), make `scripts/compose-e2e.sh` write a random token into `.env` (e.g. `openssl rand -hex 16` or `node -e`), and show the token generation step in the quick start of `docs/install.md` (and the meta README text is updated by a person later). The `compose-e2e` job must pass.
Completion evidence: all checks pass and the new tests fail when the source changes are reverted.
