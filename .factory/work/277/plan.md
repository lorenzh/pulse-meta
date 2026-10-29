# Spec #277: contract on zod, enforced ranges, timer caps

Step S1 of #166. Review: `.factory/work/277/issue-review.md`.

## Goal
One source for contract types and validators (zod 4 schemas, types via `z.infer`), every documented range enforced, and no layer lets a timer delay exceed 2,147,483,647 ms (`MAX_TIMER_MS`, 2^31-1), the value Node clamps to 1 ms.

## Non-goals
No pulse-kit (S4), no shared API client (S2), no zod parsers for notify/status config (S5). Wire format, `WIRE_VERSION` and the header do not change. `config` and `kit` are untouched.

## Bounds table (single source; contract docs, each repo's docs name the ones it enforces)
| Field | Rule |
|---|---|
| `intervalMs` (http, tls) | integer 1..2147483647 (today: any positive number) |
| `timeoutMs` | integer 1..2147483647 |
| `latencyObjectiveMs` | integer 1..2147483647 |
| `retries` | integer 0..10 |
| `retryDelayMs` | integer 0..60000 |
| tls `port` | integer 1..65535 |
| tls `warnDays` | integer >= 0, no upper bound (none is documented; the api default is 14). Contract and api enforce the same rule |
| heartbeat `period` | integer 1000..86400000 (already) |
| heartbeat `grace` | integer 0..86400000 (already) |
| `uptime` (day and total) | null or number 0..100 |
| `UptimeDay.date` | `YYYY-MM-DD`, a real calendar date (02-30 rejected, no rollover, leap years right) |
| maintenance `end` | greater than `start` |
| `PULSE_CHECKS_RELOAD_MS` | integer 5000..2147483647 |
Where the implementer finds an existing doc range that differs from this table, the doc wins and the table in the PR is corrected. Existing files with out-of-range values are rejected from now on; each repo's docs say so.

## Required behavior across repos
- Validator API stays compatible: same exported names, `{ ok: true, value } | { ok: false, error }`, never throws, returns the same object (not a zod clone), extra fields kept (loose objects), error text `<path>: <problem>` with a stable path formatter (`checks[2].intervalMs`, same style as today; first error only). `Object.hasOwn` semantics: inherited names (`constructor`, `__proto__`) never count as present or as allowed keys. Message texts may change; every consumer test that matched a message is updated.
- api future-skew limit: `min(intervalMs of the check, 60000)`; heartbeat checks and unknown check ids use 60000.
- Probe and api timers: delays above `MAX_TIMER_MS` are never passed to `setTimeout`.

## Risks
- Status browser: `poller.ts` is served to the browser and imports `validate*` from the contract, so the browser needs zod. See status section.
- `dist/*.d.ts` must not leak awkward zod types: export explicit interfaces/types via `z.infer` aliases with the existing names; check the emitted d.ts and a consumer typecheck.
- Zod error formats differ from today; the path formatter must be tested.
- Contract `dist` is committed and checked by test/CI.

## Acceptance evidence
As in the issue review: out-of-range check/uptime/date/window rejected by contract and api with path-named errors; `PULSE_CHECKS_RELOAD_MS=3000000000` fails probe startup naming it; a 10 s check with a timestamp 30 s ahead is rejected by the api; status renders in the browser with the CSP intact; all repo tests and `compose-e2e` green; each new test fails on old code.

## Repository: contract
- Add `zod` (4.x, exact version, no caret) as the first runtime `dependency`; update lockfile. Use full `zod`, not `zod/mini`, unless the status section forces otherwise (it does not: serving is the same either way).
- Rewrite `src/index.ts` types as zod schemas (new `src/schema.ts` or in place) with `z.infer` types of the same names; keep doc comments. Export `MAX_TIMER_MS = 2147483647`.
- Rewrite `src/validate.ts` on the schemas with the stable path formatter, loose objects, same-object return, `Object.hasOwn` semantics (heartbeat unknown-key rule stays: keys outside the heartbeat and state shapes are rejected). State fields on `validateCheck` stay ignored; `CheckWithState` validates them.
- Enforce the bounds table; calendar-date check helper (round-trip via UTC `Date`, rejects rollover); maintenance `end > start` with the error on `maintenance.end`.
- `WIRE_VERSION`, header: unchanged. Run `npm run build` and commit `dist/` (including zod import in `dist/validate.js`); `dist` stays ESM, importable under Node >= 24 and from the browser given same-origin serving.
- Tests (fail on old code): each bound at limit and limit+1, `2030-02-30`, leap day 2028-02-29 ok, uptime 101 and -1, end <= start, `__proto__`/`constructor` keys, extra fields kept, path strings, `intervalMs` 2147483648.
- Docs/README/AGENTS: name the bounds, the zod dependency, the error format. Evidence: `npm run check` green, dist matches build. Merge first; consumers pin its commit.

## Repository: status
- Bump `@lorenzh/pulse-contract` pin to the merged contract commit; `npm ci`.
- The browser imports contract `validate.js`, which imports `zod`. Extend `server.ts` serving: allow-list contract files as today, rewrite `from "zod"` in served contract files to a same-origin path (e.g. `/pulse-contract/zod/index.js`), and serve only `.js` files from inside the resolved zod package dir under that prefix (normalized path, no traversal, no other extensions) so zod's relative imports resolve. CSP stays `script-src 'self'`, no import map inline, no new origins. If zod's full build is too many files or too heavy for this, the implementer may switch the contract to `zod/mini` only with a note in the PR; default is full zod.
- Tests: the served `validate.js` has no bare `zod` specifier; `/pulse-contract/zod/...` serves, path traversal and non-js 404; a smoke test imports the served modules in Node from a local server (or evaluates their import graph) to prove every import resolves. Update message-matching tests. Docs name the served paths and bounds.
- Evidence: `npm run check` green, CSP header test unchanged.

## Repository: probe
- Bump the contract pin.
- `reload-interval.ts`: add `MAX_RELOAD_MS = 2147483647`; `parseReloadMs` rejects above it with an error naming `PULSE_CHECKS_RELOAD_MS` and the range; startup (settings/main) exits with that error.
- `scheduler.ts` and `reloader.ts`: clamp the delay to `MAX_TIMER_MS` at the `setTimeout` use sites (checks from the api are contract-validated too, so out-of-range checks are rejected by the validator; the clamp is the defense in depth). Fake-timer tests assert no delay > 2^31-1 is passed.
- Tests: `PULSE_CHECKS_RELOAD_MS=3000000000` and `2147483648` fail with the variable named, `2147483647` accepted; scheduler with `intervalMs` 2^31+ never loops without pause. Docs list the bound. Update message tests. Evidence: `npm run check` green.

## Repository: notify
- Bump the contract pin only (it uses `validate*` through `api.ts`); `npm ci`; fix any tests matching validator messages or using out-of-range fixtures. Docs mention the bounds only if it documents contract validation. Evidence: all tests green; a test that a response with an out-of-range check is rejected where notify validates responses.

## Repository: api
- Bump the contract pin (after contract merge). Dependency order: api runs after contract, status, probe and notify, so it may assume `main` of status, probe and notify is already on the new contract; its `compose-e2e` (which builds those three from `main`) therefore tests the whole stack, including the new skew rule against the probe at the new contract.
- `config.ts`: checks-file `intervalMs`, `timeoutMs` capped at 2147483647 (messages name the cap), `period`/`grace` keep 1000..86400000 and `grace` its range; also enforce the bounds table where the file sets `retries`, `retryDelayMs`, `port`, `warnDays`. Date parsing: `parseInstant` and any date-only parse reject rollover (validate the Y-M-D-h-m-s components against the parsed UTC/offset result by recomputing, e.g. day <= days in month, hour 0..23, minute/second 0..59, leap years); `2030-02-30T00:00:00Z` throws a `ConfigError` naming the field. Maintenance: `end` must be after `start` (already check; keep and test).
- `server.ts`: replace the fixed `MAX_FUTURE_SKEW_MS` for POST /results by a function `maxFutureSkewMs(check) = min(check.intervalMs, 60000)`, with 60000 for heartbeat checks and unknown ids; the error message states the limit used. `validateResult` takes the check lookup. A 10 s check rejects a timestamp 30 s ahead; a 60 s+ check still allows up to 60 s.
- Tests (fail on old code): each cap +1, `2030-02-30`, `2028-02-29` ok, skew per interval, unknown id fallback. Docs name the bounds and skew rule; mention that existing checks files outside the bounds fail to load.
- Evidence: `npm run check` green and `compose-e2e` green.
