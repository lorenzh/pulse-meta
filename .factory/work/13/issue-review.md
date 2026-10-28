# Issue review: Retries for failed probe attempts (#13)

## Current state (inspected in the clones)

- contract: `HttpCheck`/`TlsCheck` have `intervalMs`, optional `timeoutMs`; no retry fields. `Result` has no attempts field. `dist/` is committed and must be rebuilt.
- probe `runCheck(check, {fetch, now, location})` makes exactly one GET with `AbortSignal.timeout(timeoutMs)`; any non-2xx, timeout or network error is `down`. `timestamp` = start, `latencyMs` = now() - start.
- probe `startScheduler` runs a check, awaits it, then schedules the next run after `max(0, intervalMs - elapsed)`. It uses an injected `Timer` and `now`, so a check never overlaps itself as long as the whole run (including retries) is awaited inside `run`.
- probe `fetchChecks` rebuilds each `Check` from only `id,name,url,intervalMs,timeoutMs`; new fields would be dropped. It also ignores `type`, and `runCheck` has no TLS path, so TLS checks are not supported by the probe today.
- probe `main.ts` wires `run: runCheck(...)`; there is no injectable sleep in `CheckDeps`.
- api `parseChecks` validates and copies only known fields (unknown fields are dropped); the `checks` table has no retry columns; `results` has no attempts column; `validateResult` builds the `Result` from known fields only; `migrate()` in `db.ts` adds columns with ALTER. The API serves checks via `GET /checks` from the DB rows (service.ts maps row to Check).
- Probe AGENTS.md: node:test, injectable clock, no real timers in tests, network tests only against local in-test servers.
- pulse-status shows results and reasons; it needs no change for this (attempts display is optional).

## Assumptions

- Field names: check `retries` (non-negative integer, default 0, absent means 0) and `retryDelayMs` (non-negative integer; default assumed 1000 ms if absent, 0 allowed). Result gets `attempts` (integer >= 1).
- Fields are added to the HTTP check only; TLS checks are out of scope (the probe has no TLS path). The contract may put them on a shared base or just `HttpCheck`; the spec decides, and the probe must then forward them.
- `Result.attempts` is required in the contract for new results, but the API must accept legacy posts without it (treat as 1) and old DB rows read as 1 (`ALTER TABLE results ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1`).
- A retry happens on any failed attempt (non-2xx, timeout, network error), same definition of failure as today.
- The reported result is that of the last attempt: status, statusCode, reason, latencyMs (see open points), `attempts` = number of attempts made (1 to retries + 1). Success on any attempt stops the loop and reports up.
- Delay waits use an injected `sleep` in `CheckDeps` (tests pass a fake that records or advances the injected clock); `now` stays the clock for timestamps. No real timers in tests.
- The configured checks file (pulse-api) is the source of the new fields, flowing api to probe through `GET /checks`.

## Open points (non-blocking, spec should pick)

- Overlap constraint: scheduler already waits for the full `run` before arming the next timer, so overlap is impossible by construction. But the worst case total run time is `(retries+1) * timeoutMs + retries * retryDelayMs`; if it exceeds `intervalMs` the next run starts immediately after (delay 0) and effective cadence drifts. Options: (a) accept the drift, (b) validate in the API config that the worst case fits in `intervalMs` (ConfigError), (c) cap retries at runtime by a deadline of `intervalMs` from the start. Recommended: (b) in the config plus (c) as a probe-side safety guard, since config may come from elsewhere. Spec must decide and test it with the fake clock.
- `timestamp`: keep as start of the first attempt (matches the API's quorum window which classifies by result timestamp). `latencyMs`: the last attempt's latency vs. total span. Recommended: the last attempt's latency, so a slow retry chain doesn't look like a slow endpoint; document it.
- `reason` after exhausted retries: reason of the last attempt, without an "after N attempts" suffix, to keep the API's incident reason stable. `attempts` carries the count.
- Validation limits: upper bound for `retries` (e.g. 10) and `retryDelayMs`; non-integers and negatives rejected with ConfigError messages like existing ones.
- API `consecutiveDown`/incident logic is unchanged: one result per scheduled run, so one lost packet no longer counts as a down. Confirm no API change in state computation.
- Scope per repo: contract (types + dist rebuild), api (config parse, DB columns for retries/retry delay, serve them in `GET /checks`, validate and store `attempts` on `POST /results`, migrations, `checks.example.json`/README), probe (client forwards fields, retry loop in `runCheck`, README). Status: none. Merge order: contract first; probe and api pin the contract commit, so they need a dependency bump to the new commit.
- Existing check upsert in the API (`INSERT ... ON CONFLICT`) must update the retry columns when the config changes.
- Whether `attempts` should be exposed in `GET /checks/:id/results` (yes, as part of `Result`) and displayed in the status page (not required).
- Abort handling: scheduler `stop()` during a retry wait should not post a result; the retry sleep should be cancellable or the result dropped (the scheduler already drops when `stopped`). Minor.

## Derived acceptance check

1. contract: `HttpCheck` has optional `retries` and `retryDelayMs`; `Result` has `attempts`; `dist` rebuilt and committed.
2. api config: `retries` omitted means 0; invalid values (negative, non-integer, above the limit) throw `ConfigError`; values reach `GET /checks`; `POST /results` stores and returns `attempts` (missing means 1); old databases migrate.
3. probe, default retries 0: against a local test server that always fails, `runCheck` makes exactly 1 request and returns `down` with `attempts: 1`.
4. probe, `retries: 1` with a local test server that fails (e.g. HTTP 500 or dropped connection) on the first request and answers 200 on the second: `runCheck` returns `up`, `statusCode` 200, `reason` null, `attempts: 2`, server saw exactly 2 requests.
5. probe, `retries: 1`, server fails every time: `down`, `attempts: 2`, reason of the last failure.
6. The wait between attempts is exactly `retryDelayMs`, performed through the injected sleep/clock (the test uses a fake and no real timers); no wait before the first attempt or after the last.
7. Scheduler test with the fake timer and clock: the next run of a check is scheduled only after the retrying run finished (no overlap), and a run that overruns the interval is scheduled with delay 0 or bounded per the spec's chosen rule.
8. `fetchChecks` forwards `retries` and `retryDelayMs` from the API response.
9. In all repos `npm run check` passes.

No blocking questions: the open points have reasonable defaults listed above.
