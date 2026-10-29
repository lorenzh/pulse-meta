# Spec: Keyword check for HTTP checks (#151)

## Goal
An HTTP check can name a `keyword`. A 2xx answer whose body does not contain it is `down`, and the status page shows why.

## Scope
contract (field), probe (body match), api (config, persistence, `GET /checks`), status (check detail). notify is unaffected and not changed.

## Non-goals
No regular expressions, no case-insensitive option, no negative match, no keyword for TLS checks.

## Decisions (from the issue review)
- Match: plain string, case-sensitive substring, on the body of the final response (redirects followed, as today). No content-type filter; fetch decompresses; decoding is UTF-8.
- Size limit: **1 MiB (1,048,576 bytes)**, a named constant in probe. The body is read as a stream only when `keyword` is set, up to the limit; reading stops early when the keyword is found and the rest is cancelled. A keyword not found within the limit (including one straddling it) counts as not found.
- Down result: `status: down`, `statusCode` = the 2xx code received, `reason` = `keyword "<text>" not found` (keyword verbatim). Non-2xx keeps `HTTP <code>`. Timeout or read error while reading the body keeps the existing timeout/error reason.
- Retries apply as for any failed attempt. A keyword failure is `down`, never `degraded`; a found keyword leaves `up`, which latency may still turn `degraded`. Latency includes body reading (documented).
- api keyword validation: must be a non-empty string; rejected on TLS checks (even if empty) and for non-strings, with a `ConfigError` naming the check. No trimming, no length limit.
- `GET /checks` serves `keyword` for HTTP checks and omits it when unset.

## Risks
- api stores checks in SQLite: needs a nullable column and migration, not only config validation; old databases must keep working.
- Pins differ today (probe/notify `c78f73b`, api/status `78c86dc`). Consumers must pin the merged contract commit SHA, not a branch.
- Reading bodies costs memory/time: bounded by the limit and the existing timeout.

## Acceptance evidence
- Each repository: lint, typecheck and tests pass; docs updated.
- End to end: an HTTP check with keyword against a server answering 200 with a maintenance page shows `down` with `keyword "x" not found` on the status page; with the keyword present it shows `up`.

## Repository: contract
- Files: `src/index.ts`, `docs/index.md` (and `dist` if the repo commits it, per its AGENTS.md).
- Add optional `keyword?: string` to `HttpCheck`. Comment: plain case-sensitive substring; the check is `down` when a 2xx answer body does not contain it (within the probe's body size limit); the probe writes `reason` `keyword "<text>" not found` with the 2xx `statusCode`. Not on `TlsCheck`.
- Docs describe the field. Add a test if the repo has type/shape tests.
- Done when: checks pass and the change is merged to `main`; the merged commit SHA is what the other repositories pin.

## Repository: probe
- Files: `src/check.ts` (`attemptHttp`), `src/check.test.ts`, `package.json`/`package-lock.json`, `docs/configuration.md`.
- Pin `@lorenzh/pulse-contract` to the merged contract commit SHA.
- With `keyword`, read the 2xx body as a stream up to a `MAX_KEYWORD_BODY_BYTES` constant (1 MiB), keep the timeout signal active, stop on match and cancel the rest. Without `keyword` the body is not read (still cancelled). TLS checks ignore it.
- Tests with a fake fetch: keyword present -> up; absent -> down with statusCode 200, reason `keyword "<text>" not found`, retried `retries` times with `attempts` counted; 503 -> `HTTP 503`; different case -> not found; keyword beyond the limit -> not found; no keyword -> body not read; body timeout/error keeps its reason.
- Docs: field, example, the 1 MiB limit, latency including body reading.
- Done when: lint, typecheck and tests pass.

## Repository: api
- Files: `src/config.ts`, `src/db.ts` (new nullable `keyword` column via `addCheckColumn`), `src/service.ts` (upsert and read-back), `src/server.ts` if the response is built there, tests, `checks.example.json`, `package.json`/lockfile, `docs/configuration.md`, `docs/rest-api.md`, `docs/concepts.md` where fields are listed.
- Pin `@lorenzh/pulse-contract` to the merged contract commit SHA.
- Config accepts `keyword` on HTTP checks; rejects on TLS checks, empty string and non-strings with a `ConfigError` naming the check (same `where`/id prefix as other errors).
- Persist and serve it; value cleared when the check is removed or the keyword dropped from the file; existing databases get the column by migration.
- Tests: valid load and `GET /checks` output; persists across restart; migration of a DB created before the change; the three rejection cases; omitted when unset.
- Docs: field, example, note that the probe matches within the first 1 MiB of the body.
- Done when: lint, typecheck and tests pass.

## Repository: status
- Files: `src/render.ts`, `src/validate.ts` (pass `keyword` through from `GET /checks`), `src/poller.ts` if it maps fields, tests, `package.json`/lockfile, `docs/configuration.md` (or the page describing check display).
- Pin `@lorenzh/pulse-contract` to the merged contract commit SHA.
- Check detail shows `keyword "<text>"` (HTML-escaped) next to the latency for HTTP checks with a keyword, in any state. A down check's reason renders as today. Checks without keyword render unchanged.
- Tests: keyword shown and escaped; down check shows reason and keyword; no keyword -> unchanged; validation accepts and passes the field.
- Docs: describe the display, example, the 1 MiB limit note.
- Done when: lint, typecheck and tests pass.
