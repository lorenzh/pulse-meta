# Spec #860: api — log late request failures and remove redundant result checks

## Goal

Fix two P3 quality findings in `src/server.ts` of pulse-api (quality-api-2026-11-06-2 and quality-api-2026-11-06-3):

1. Sometimes a request handler fails after the response headers were sent. Today that failure leaves no log entry: the `res.headersSent` branch destroys the response and returns before `logError`. After this change, every unexpected request failure produces exactly one `request failed` error log, whether or not headers were sent. The response is still closed without a second answer.
2. `validateResult` repeats checks that the pinned contract validator `validatePostResultRequest` already makes, so those branches can never run. Remove them and keep every API-specific rule. Correct the documentation, which lists the unreachable message `reason must be at most 1000 characters`.

Every validation outcome (accept or reject, the exact message, and which error is reported first) and every response stays the same.

## Decisions carried from the issue, its comments and the issue review

The only comment on #860 is the Factory issue-review run. `.factory/work/860/issue-review.md` found no blocking question. This spec adopts its resolved assumptions:

- **What counts as unexpected.** A failure is expected when it is an `HttpError` or a `ManualRouteError` (`src/server.ts:79-87`, `src/manual-incident-routes.ts`). Every other failure is unexpected. An unexpected failure calls the existing `logError` hook exactly once, with the literal message `request failed` and the original thrown value, before or after headers. Expected errors never reach this hook, also not after headers. Do not add access logs, change the log format or the logger wiring (`src/start.ts:562-563`), or handle a logger that throws.
- **What the client sees.**
  - After headers were sent, the response is destroyed, as today. No second status line, header or JSON error body follows. A finished 204 stays a bodyless 204, and a response that was still being written ends unfinished.
  - Before headers were sent, the typed error mapping and the generic private `500 {"error":"internal error"}` stay unchanged.
- **Which checks go.** All post-contract checks that the pinned schema (`postResultRequestSchema`, contract `1b5e7d3e` `src/schema.ts:520-532`) already guarantees: object shape, non-empty `checkId`, integer `timestamp`, allowed `status`, `statusCode` null or an integer 100..599, `latencyMs` an integer 0..`MAX_TIMER_MS`, `reason` null or a string of at most `MAX_REASON_LENGTH` UTF-16 code units, `location` a string when present, `attempts` an integer >= 1 when present, `certDaysLeft` null or an integer when present.
- **Which checks stay, with their exact text and order:**
  - the own-accessor guard before the copy;
  - rounding a finite latency >= 0 before contract validation;
  - the timestamp window (future skew `maxFutureSkewMs`, inclusive 7-day age);
  - `certDaysLeft` within ±3000000;
  - `attempts` <= 100;
  - location trim, the blank or missing default, and the 64-character limit after trim;
  - projecting only the known fields into the `Result`, `attempts` defaulting to 1, and an absent `certDaysLeft` staying absent.
- **Order.** The contract error comes first. Then the API rules run in their current order: timestamp, `certDaysLeft`, `attempts`, `location`. `findCheck` runs once, only after the contract accepted the body.
- **Red versus compatibility tests.** Only the late-failure logging tests are red on the base. The validation tests are compatibility controls that pass on the base and on the branch: validation behavior does not change. A source review against the pinned schema proves which branches were removed.
- **One repository, one task.** The scope is the 7 files below. No contract, kit, config, dependency pin, tooling or design change.

## Current behavior (verified on api `main` e084bde0a5bc199748ec5614ed604ae79b8454cf)

Planning used a scratch clone of the api at `e084bde` in `/tmp` (`bun install --frozen-lockfile`, Bun 1.4.0). The read-only `.repos/api` clone was not changed.

- `src/server.ts:981-992`: `handle(...).catch` returns after `res.destroy()` when `res.headersSent`. Only the `else` branch before headers calls `logError("request failed", err)`.
- `src/server.ts:58-66,107-210`: `validateResult` calls `validatePostResultRequest`, then checks again for an object, a non-empty `checkId`, an integer timestamp, the status enum, `statusCode`, `latencyMs`, the `reason` type and length, and in `parseLocation` the location type. It keeps the local aliases `MAX_REASON_LENGTH = CONTRACT_MAX_REASON_LENGTH` and `MAX_LATENCY_MS = MAX_TIMER_MS`, which only serve those checks. `isIntegerIn` stays in use for `certDaysLeft` and `attempts`.
- The injected `admin` handler (`src/server.ts:725-728`) runs for `/admin/<x>` with no auth in `server.ts`, so a test can inject a handler that writes and then throws. `src/admin-routes.ts:328,447` re-throws once headers were sent, so in production a late failure also reaches the server catch.
- Pinned contract (`github:lorenzh/pulse-contract#1b5e7d3e268372a6241db05ae30272eab7299b10`, `package.json:31`). It was read through `gh api .../contents/src/{schema,validate,validate-core}.ts?ref=1b5e7d3e...`, because the local contract clone is newer (`6370c25`):
  - `schema.ts:90-95`: the reason refine message is `must be null or a string of at most 1000 characters`; `text` gives `must be a string`.
  - `schema.ts:520-532`: `postResultRequestSchema` (see the list above). It is a non-strict `z.object`, so unknown keys pass.
  - `validate.ts:165-169`: `validatePostResultRequest` uses path `result`.
  - `validate-core.ts:545-562`: on success, `verdict` returns the input object itself as `value` (typed `PostResultRequest`).
- Error texts measured in the scratch clone with `validatePostResultRequest(body)` against `validateResult(body, NOW, () => undefined)`. `NOW` was `1_000_000_000_000`; the base body was `{checkId:"c",timestamp:NOW,status:"up",statusCode:200,latencyMs:5,reason:null}`, with one field changed per row:

  | Input | Contract | API (base) |
  | --- | --- | --- |
  | `reason: "x".repeat(1001)` | `result.reason: must be null or a string of at most 1000 characters` | same |
  | `reason: 5` | `result.reason: must be a string` | same |
  | `latencyMs: 2147483648` / `-1` / `2147483647.5` | `result.latencyMs: must be an integer 0..2147483647` | same |
  | `checkId: ""` | `result.checkId: must be a non-empty string` | same |
  | `status: "ok"` | `result.status: must be one of "up", "degraded", "down"` | same |
  | `statusCode: 99` | `result.statusCode: must be an integer 100..599` | same |
  | `timestamp: 1.5` | `result.timestamp: must be an integer` | same |
  | `attempts: 0` | `result.attempts: must be an integer >= 1` | same |
  | `certDaysLeft: 1.5` | `result.certDaysLeft: must be an integer` | same |
  | `location: 5` | `result.location: must be a string` | same |
  | `attempts: 101` | ok | `attempts must be an integer from 1 to 100` |
  | `certDaysLeft: 3000001` | ok | `certDaysLeft must be null or an integer from -3000000 to 3000000` |
  | `location: "  " + "a".repeat(65) + " "` | ok | `location must be at most 64 characters` |
  | `timestamp: NOW - 604800001` | ok | `timestamp is older than 7 days` |
  | `timestamp: NOW + 60001` (unknown check) | ok | `timestamp is more than 60000 ms in the future` |
  | `status: "ok", attempts: 101, reason: 1001×"x"` | `result.status: must be one of "up", "degraded", "down"` | same |
  | `timestamp: NOW - 604800001, attempts: 101` | ok | `timestamp is older than 7 days` |

  So the API-only messages `reason must be at most 1000 characters`, `reason must be a string or null`, `latencyMs: must be an integer 0..2147483647`, `checkId must be a non-empty string`, `timestamp must be an integer (epoch ms)`, `status must be "up", "degraded" or "down"`, `statusCode must be null or an integer from 100 to 599`, `body must be a JSON object` and `location must be a string` are unreachable. Only `docs/troubleshooting.md:87` names one of them. A grep over `src`, `test`, `docs` and `README.md` found no other use outside `src/server.ts`.
- **Late-failure reproduction** (scratch test, not committed). Each case was run 3× on the base and 3× with the fix (log before the `headersSent` branch):
  - (a) The injected `admin` handler writes `204` and `end()`, then throws. Base: `expect(calls).toEqual([boom])` fails, 0 pass and 1 fail, exit 1, received `[]`. Fix: 1 pass, exit 0.
  - (b) The handler writes `200` headers and the chunk `partial`, waits until the client received that chunk, then throws. A raw `node:net` client read exactly one `HTTP/1.1 200 OK` head plus `7\r\npartial\r\n`, with no terminating `0` chunk and no `internal error`, then the socket closed. Base: the log assertion fails, 3/3. Fix: 1 pass, 3/3. In both runs a later `GET /healthz` answered 200.
- **Focused test runs and coverage, Bun 1.4.0.** `bunfig.toml:1-4` enables coverage with `lines = 0.8`.
  - `bun test --config /dev/null <file>` (space) still applies the repository coverage: the coverage table is printed and the run exits 1 although all tests pass.
  - `bun test --config=/dev/null <file>` (equals sign) runs without coverage and exits 0. This was verified on `src/server.validation.test.ts`: 15 pass, exit 0.
  - Use only the `=` form for focused runs.
- **Baseline controls on the base, run 3×, all exit 0.** `bun test --config=/dev/null src/server.validation.test.ts src/server.target.test.ts src/server.test.ts`: 29 pass, 0 fail, each run.
- **Full check on the base, run once.** `bun run check` exited 0: 904 pass, 0 fail, 99 files. The `error: audit log down` lines it prints are expected output of existing tests, not failures.
- **Test CPU on the base**, for information only (`/usr/bin/time bun run test`, 2 runs): 8.40 user + 1.55 sys and 8.27 user + 1.51 sys, about 9.8-10.0 s on this shared machine.

## Scope

pulse-api only: `src/server.ts`, a new `src/server.errors.test.ts`, `src/server.validation.test.ts`, `README.md`, `docs/rest-api.md`, `docs/troubleshooting.md`, `docs/operation.md`.

## Non-goals

- No change to the contract (schemas, messages or pin), kit, config, `bun.lock`, `package.json`, tooling, CI, coverage settings or the bench.
- No change to response status codes, response bodies, `ErrorResponse`, security headers, auth, body limits, heartbeat or location refusal, the unknown-check 404, idempotency or storage.
- No change to the API-specific bounds or their messages. No new production fault-injection endpoint or test-only export (`HttpError` stays private).
- No sanitizing of arbitrary exception stacks and no new log fields. The hook keeps receiving the original thrown value, as it does before headers today.
- No logging of expected (`HttpError`, `ManualRouteError`) failures after headers.

## Required behavior

### R1: log late unexpected failures

In `createApiServer` (`src/server.ts:981-992`), classify the error once. For an unexpected error, call `logError("request failed", err)` exactly once, then:

- if `res.headersSent`, call `res.destroy()` and return (no write);
- else send `500 {"error":"internal error"}`.

For an expected error:

- if `res.headersSent`, call `res.destroy()` and return, with no log;
- else send `sendError(res, err.status, err.message, err.headers)`, as today.

### R2: remove unreachable result checks

In `validateResult`, after `if (!shape.ok) return shape.error;`, use the validated value (`shape.value`, typed `PostResultRequest`; it is the rounded input object itself). Delete:

- the object re-check and `"body must be a JSON object"`;
- the `checkId`, status, `statusCode`, `latencyMs` and `reason` checks;
- the integer and type part of `checkTimestamp`;
- the type check in `parseLocation`;
- the aliases `MAX_REASON_LENGTH`/`MAX_LATENCY_MS` and the imports `MAX_REASON_LENGTH as CONTRACT_MAX_REASON_LENGTH` and `MAX_TIMER_MS`, if nothing else in `server.ts` uses them (verified: nothing does today).

Keep:

- the window checks of `checkTimestamp`, with their exact texts;
- the `certDaysLeft` range check (skipped for `undefined` and `null`), then the `attempts <= 100` check, with their exact texts;
- trim, default and the 64-character limit with its exact text;
- `withRoundedLatency` and the accessor guard unchanged;
- the explicit known-field `Result` projection. Without the repeated checks, the `as` casts there should go, because the validated type already fits.

`validateResult`'s exported signature and return type stay the same. Respect the SonarJS cognitive-complexity limit of 15 (`AGENTS.md` Tests section).

### R3: tests

1. **New `src/server.errors.test.ts`.** Real HTTP on `127.0.0.1` port 0, an in-memory DB, a fixed `now`, and handlers injected through `createApiServer` options (`admin`). Synchronize on events and promises, never on sleeps or timers. Close sockets and servers in `finally` or `afterAll`.
   - (a) finished 204, then throw: client status 204 with an empty body; once the log promise resolved, the log calls are exactly `[["request failed", boom]]` (same identity).
   - (b) started 200 with the chunk written, then reject after the client saw the chunk: the raw socket data holds exactly one `HTTP/1.1 ` status line, no `internal error`, and no terminating `0\r\n\r\n` chunk; the socket closes; exactly one log call with the original error.
   - (c) unexpected before headers: `500 {"error":"internal error"}`, one call with the original error, and the response body does not contain the error message.
   - (d) expected errors stay quiet, each with zero log calls:
     - an `HttpError` path: `GET /nope` answers `404 {"error":"not found"}`;
     - a `ManualRouteError` before headers: an injected `admin` handler throws `new ManualRouteError(409, "conflict")` and the client gets `409 {"error":"conflict"}`;
     - a `ManualRouteError` after headers: an injected `admin` handler writes `200` headers and then throws it; the socket closes with exactly one status line and no JSON error.

     `ManualRouteError` is already exported from `src/manual-incident-routes.ts:20`, so no new export is needed. Do not export `HttpError`.
   - (e) privacy and continued service: send sentinel strings in `Authorization`, the query and the body of the failing request. They appear in neither the log message (`request failed`) nor the client bytes. A following ordinary `GET /healthz` answers 200 and the log count stays 1.

   Cases (a) and (b) must fail on the base for the stated reason (0 calls instead of 1).
2. **Extend `src/server.validation.test.ts` with compatibility controls** that pass on the base. Every assertion compares the whole message with a literal from this spec, and where noted also with the pinned `validatePostResultRequest` (a differential: the same text).
   - **Contract/API parity**, one invalid field per case, with the inputs and literal texts of the table above. Also: `statusCode: "200"`, `statusCode: 600`, `latencyMs: "1"`, a non-object body (`[]`, `null`, `"x"`) giving `result: must be an object`, and `timestamp: "1"`.
   - **Reason boundaries**: `null`, `""`, 1000 code units accepted, 1001 rejected with `result.reason: must be null or a string of at most 1000 characters`. Also 999×`"x"` + `"😀"` (1001 code units) rejected and 998×`"x"` + `"😀"` (1000 code units) accepted.
   - **Latency**:
     - accepted: 0 and 2147483647;
     - rejected with `result.latencyMs: must be an integer 0..2147483647`: -1, `NaN`, `Infinity` and `"1"` (direct `validateResult` only for NaN and Infinity), and 2147483647.5, which rounds to 2147483648;
     - rounded: 12.5 to 13 and 0.4 to 0 in the returned `Result`.
   - **attempts**: 100 accepted and 101 rejected with `attempts must be an integer from 1 to 100`, while the direct contract accepts 101. Omitted gives `attempts: 1`. `0` and `1.5` give the contract text `result.attempts: must be an integer >= 1`.
   - **certDaysLeft**: ±3000000 accepted; ±3000001 rejected with `certDaysLeft must be null or an integer from -3000000 to 3000000`, while the contract accepts them. `null` is kept as `null`; absent stays absent (`"certDaysLeft" in result === false`). `1.5` gives `result.certDaysLeft: must be an integer`.
   - **Timestamp**, with `NOW = 10 * 86_400_000` as in the file: `NOW - 604800000` accepted and `NOW - 604800001` rejected (`timestamp is older than 7 days`). An unknown check accepts `NOW + 60000` and rejects `NOW + 60001` (`timestamp is more than 60000 ms in the future`). A 10 s http check rejects `NOW + 10001` (`timestamp is more than 10000 ms in the future`). A heartbeat check uses 60000.
   - **Location**: missing and `"   "` give `default`; `"  eu  "` gives `eu` (case kept: `"EU"` stays `EU`); 64 characters after trim accepted, 65 rejected (`location must be at most 64 characters`). `5` gives `result.location: must be a string`.
   - **Precedence**:
     - `{status:"ok", attempts:101}` gives the contract status message;
     - `{timestamp: NOW-604800001, attempts: 101}` gives the timestamp message;
     - `{certDaysLeft: 3000001, attempts: 101}` gives the `certDaysLeft` message;
     - `{attempts: 101, location: 65×"a"}` gives the `attempts` message;
     - `findCheck` call count: 0 for a contract-rejected body, 1 for a shape-valid one.
   - **Projection**: a valid body with an unknown key `extra: 1` returns a `Result` without `extra`.
   - **HTTP**: authenticated `POST /results` cases for the oversized reason, `attempts: 101`, `certDaysLeft: 3000001` and the 65-character location. Each gives `400` and an `ErrorResponse` equal to the literal message, and no result is stored (the results read is empty).

   Do not change or delete existing tests: they all pass on the base, and the behavior they check stays. Only add tests.

### R4: documentation

| Document and base lines | Disposition |
| --- | --- |
| `README.md:80` | **Changed.** After "Logs are JSON lines (`PULSE_LOG_LEVEL`).", say that an unexpected request failure is logged once as `request failed`. Before headers it answers `500 {"error":"internal error"}`; after headers the started response is closed without a second answer. Keep the quiet malformed-target sentence. |
| `docs/rest-api.md:52` | **Changed.** `500` `internal error` applies when the failure happens before the response started. A later failure closes the response. Both are logged once as `request failed`. |
| `docs/rest-api.md:68` | **Changed.** Replace `MAX_LATENCY_MS` with the contract name `MAX_TIMER_MS`. Keep the rule text and the rounding sentence. |
| `docs/rest-api.md:69` | **Unchanged and still true.** `MAX_REASON_LENGTH` is the contract constant name (pinned `schema.ts:13`), and the 1000 UTF-16 code-unit rule holds. |
| `docs/rest-api.md:80` | **Changed.** After the contract validator: timestamp window, `certDaysLeft` range, `attempts` cap, `location` length (that order). Drop "`latencyMs`, `reason` length" from the API checks. Note that an oversized reason gives the contract message `result.reason: must be null or a string of at most 1000 characters`. |
| `docs/rest-api.md:45-51,53-67,70-79,81-103` | **Unchanged and still true.** Error shape, request-target and 413/405/404 rules, the other field rules, steps 1-4 and 6-9, idempotency, headers. |
| `docs/troubleshooting.md:83` | **Changed.** Add `result.reason: must be null or a string of at most 1000 characters` and `result.certDaysLeft: must be an integer` to the contract messages, and keep the others verbatim. |
| `docs/troubleshooting.md:87` | **Changed.** Delete the unreachable `reason must be at most 1000 characters` bullet. |
| `docs/troubleshooting.md:85-86,88-90` | **Unchanged and still true.** Timestamp, attempts, `certDaysLeft` range and location bullets, verbatim. |
| `docs/troubleshooting.md:92-127` | **Unchanged and still true.** 401/403/404/405/413 sections. |
| `docs/operation.md:307` | **Changed.** `request failed` (error): once per unexpected request failure. Before headers the client gets `500`; after headers the started response is closed. The field `error` holds the stack. |
| `docs/operation.md` other lines | **Unchanged and still true** (log format, levels, other messages). |
| `docs/configuration.md`, `docs/concepts.md`, `docs/install.md`, `docs/development.md`, `docs/index.md` | **Unchanged and still true**, per the issue-review inventory (configuration 9-17,36-38,98-99,111,173; concepts 17,63-81,98-111; install 15,29,55; development 23,33,38-43,47; index 3-18). Protected paths. |

## Risks

- **Ordering regression.** Using `shape.value` or reordering helpers could move `findCheck` ahead of contract rejection, or `attempts` ahead of `certDaysLeft`. The precedence controls in R3 catch this.
- **Type narrowing.** `PostResultRequest` makes `location`, `attempts` and `certDaysLeft` optional. The projection must keep an absent `certDaysLeft` absent, not `undefined`-valued: `"certDaysLeft" in result` is false. R3 asserts this.
- **Double logging.** Logging both before the branch and in the `else` would log twice before headers. Test (c) requires exactly one call.
- **Bun `node:http` destroy semantics.** In the planning trial, Bun 1.4.0 closed the socket without the terminating chunk (see Current behavior). If the implementer's base differs, re-verify before relying on raw-socket assertions.
- **Coverage flag trap.** `--config /dev/null` (space) silently keeps coverage on and exits 1. Use `--config=/dev/null`.
- **Flaky raw-socket timing.** Drive the reject from the client's `data` event, not from timers.

## Evidence from a planning trial (planning only, not acceptance)

See Current behavior: red 3/3 and green 3/3 for both late cases with a minimal catch change; 29/29 baseline controls 3× on the base; full check exit 0 with 904 pass. The implementer repeats all of this at its own recorded `BASE`.

## Performance impact

Metrics of `bench/budgets.json` (api) that the change can move:

- `test_cpu_s` (gating, budget 9.2 s, floor 1.6): up slightly from the new tests, an estimated +0.1 to +0.4 s (about 5 new error-path tests with local servers and about 15 validation tests, mostly pure). The local base measurement was about 9.8-10.0 s user+sys on a noisy shared machine, so report only a delta.
- `p95_post_results_ms`, `load_cpu_s` (POST /results path): no measurable change expected. A few type and range comparisons per request go away, which saves nanoseconds.
- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `rps`, the other p95 metrics, `image_mb`, `build_cpu_s`: none expected. No new module, dependency or start-up work, and the logging runs only on failure.

Measurement: report the test-CPU delta as information. Run interleaved `/usr/bin/time -f "%U %S" bun run test` (base, branch, base, branch, …, at least 3 pairs) on two worktrees, list each run's user+sys, the mean delta, and a noise caveat. Do not run the Docker bench (`bun bench/run.ts`): it collides on host ports, tracked in #834.

## Security impact

Security impact: yes

The change touches the input validator of `POST /results` (a trust boundary) and an error log path that receives thrown values. Checklist items that apply:

- **Input validation.** Removing duplicates must leave every rejection intact. The contract validator is the single source for shape, and the API keeps its bounds. Hostile inputs: a non-object body, accessors, NaN or Infinity latency, oversized and surrogate-pair reasons, out-of-range `attempts`/`certDaysLeft`/location, a far-future or old timestamp, and unknown extra keys, which are not projected.
- **Secrets in errors, logs and responses.** The log message stays the constant `request failed`. The client gets no stack, message or request data, before or after headers. No request data (Authorization, target, body) is added to the log.
- **Body and size limits.** The 1,000,000-byte body limit and the 1000-character reason limit are unchanged.
- Not affected: auth order and status codes (unchanged and protected), accessor execution (guard kept), SSRF, file writes, dependency pins.

## Rollout order

One repository: only pulse-api changes. Probes, status and notify see identical responses and status codes, and the contract pin is unchanged, so every consumer keeps working.

## Counterexamples

- **Late logging.**
  - A handler that answers 204 and then throws must give 1 log call; base gives 0.
  - A wrong fix that logs in two places gives 2 calls before headers; test (c) must reject it.
  - A wrong fix that writes `500` after headers would add a second `HTTP/1.1` line or `internal error`; test (b) must reject it.
  - A wrong fix that logs `HttpError` (e.g. `GET /nope` → 404) gives 1 call instead of 0; test (d) must reject it.
- **Reason length** is counted in UTF-16 code units, not code points: 998×`x` + `😀` is 1000 units (accept); 999×`x` + `😀` is 1001 units (reject), although it has only 1000 code points.
- **Latency rounding**, `Math.round` before validation:
  - 2147483647.4 → 2147483647 (accept);
  - 2147483647.5 → 2147483648 (reject with the contract message);
  - 12.5 → 13;
  - -0.4 is not rounded (negative) and is rejected;
  - NaN and Infinity are rejected.
- **attempts.** 101 must be rejected by the API although the contract accepts it. A wrong removal of the API cap would accept it.
- **certDaysLeft.**
  - 3000001 and -3000001 must be rejected although the contract accepts them.
  - `null` is accepted and kept as `null`. Absent stays absent: a wrong `certDaysLeft: b.certDaysLeft` would add the key with `undefined`.
- **Timestamp windows.** With the unknown-check limit of 60000, `NOW+60000` is accepted and `NOW+60001` is rejected. For a 10 s check, `NOW+10001` is rejected. `NOW-604800000` is accepted and `NOW-604800001` is rejected. The bounds are inclusive.
- **Location.**
  - `" " + 64×"a" + " "` is accepted (64 after trim); 65×`"a"` is rejected.
  - `"   "` gives `default`; case is not changed.
- **Precedence.**
  - `{status:"ok", attempts:101}` must give the contract status message, not the attempts message.
  - `{timestamp: old, attempts: 101}` must give the timestamp message.
  - `{certDaysLeft: 3000001, attempts: 101}` must give the `certDaysLeft` message.
  - A contract-rejected body must make 0 `findCheck` calls.
- **Projection.** `{...valid, extra: 1}` must not carry `extra` into the `Result`. A wrong `return shape.value` would carry it.

No statistics are computed by this change.

## Contract fields

No new names: no new or renamed field, key, route, export or log message. The change only removes the private API aliases `MAX_LATENCY_MS` and `MAX_REASON_LENGTH` (local constants of `src/server.ts:62,64`) and the import alias `CONTRACT_MAX_REASON_LENGTH`. The log message `request failed` already exists (`src/server.ts:989`). Search proving that the removed aliases are not defined by the contract or config, so nothing collides or depends on them:

```
grep -rn 'MAX_LATENCY_MS\|MAX_ATTEMPTS\|MAX_CERT_DAYS' .repos/contract/src .repos/config   # no hits
grep -n 'MAX_LATENCY_MS\|MAX_ATTEMPTS\|MAX_CERT_DAYS' <pinned contract 1b5e7d3e src/{schema,validate,validate-core,index}.ts>   # no hits
```

## Repository: api

Files:
- `src/server.ts` (changed)
- `src/server.errors.test.ts` (new)
- `src/server.validation.test.ts` (changed)
- `README.md` (changed)
- `docs/rest-api.md` (changed)
- `docs/troubleshooting.md` (changed)
- `docs/operation.md` (changed)

Behavior change: yes

Unexpected request failures after headers become visible in the error log, and the docs change. Validation outcomes stay identical, and the removed branches are dead code. If the implementer finds that the base already logs late failures (test (a) passes on `BASE`), it requests a hold instead of a review.

### Tool facts (api `e084bde`, config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`)

- **Bun 1.4.0**: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`). CI installs Bun 1.4.0 at pinned config `.github/workflows/check.yml:22-24`.
- **Scripts**:
  - `test` is `bun test` (`package.json:15`);
  - `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`);
  - `typecheck` is `tsc --noEmit` from `typescript7` (`package.json:14`);
  - `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:20`).
- **Coverage**: `bunfig.toml:1-4`, coverage on, `lines = 0.8`, test files ignored. A focused run needs `--config=/dev/null` (equals sign), verified on the base (see Current behavior). The space form keeps coverage on.
- **Biome 2.6.3**: `package.json:23`. `biome.json` extends `@lorenzh/pulse-config/biome.json` (pin `package.json:24`). Pinned `biome.json:10-17` includes `**` except dist, node_modules, `bun.lock`, `*.html` and `test/fixtures`. `biome.json:53-63` turns off `noNonNullAssertion` for `**/*.test.ts`; `noExplicitAny` stays an error. The pinned files `biome.json` and `.github/workflows/check.yml` are identical to the config clone (`diff -q`).
- **CI**: `.github/workflows/ci.yml:18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. That workflow's steps are `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` (`check.yml:25-38`).
- **Pre-commit hook**: `lefthook.yml` extends `node_modules/@lorenzh/pulse-config/lefthook.yml`. Never use `--no-verify` (api `AGENTS.md`).

### Steps

1. Record `BASE=$(git rev-parse HEAD)` before any edit. If it is not `e084bde`, re-check the cited lines and the doc inventory, and report differences.
2. Run the baseline controls on `BASE` 3×:
   - `bun test --config=/dev/null src/server.validation.test.ts src/server.target.test.ts src/server.test.ts`: expect exit 0, 29 pass, 0 fail (the count from the planning trial at `e084bde`; if `BASE` differs, record the count observed on all 3 runs and use it);
   - `bun run check` once: expect exit 0, 0 fail.
3. Write `src/server.errors.test.ts` (R3.1). Run `bun test --config=/dev/null src/server.errors.test.ts` 3× on unchanged `src/server.ts`. Cases (a) and (b) must fail with the log-count assertion (expected 1 call, received 0); (c), (d) and (e) must pass. Record the output. A failure from coverage, an import, a timeout or a transport race does not count as red.
4. Extend `src/server.validation.test.ts` (R3.2). Run it 3× with `--config=/dev/null` on unchanged `src/server.ts`: all pass, exit 0. Record the count.
5. Change `src/server.ts` (R1, R2).
6. Update the four docs (R4).
7. Re-run steps 3 and 4 (all pass, 3×), the step 2 control (now the base count plus the new tests in those files, 0 fail), and `bun run check` (exit 0).
8. Start the real service with `bun start`, with an isolated temp `PULSE_DB`, a checks file and a token file from the examples, on a loopback port. Send one authenticated `POST /results` with `attempts: 101` (expect `400 {"error":"attempts must be an integer from 1 to 100"}`) and one valid result (expect `204`). Stop it with `SIGTERM` (exit 0). Report the commands and results. The late failure is reproduced only by the injected-handler test; add no fault endpoint.

### Acceptance

1. **Late failures.** `src/server.errors.test.ts` passes 3/3 on the branch. Cases (a) and (b) failed 3/3 on `BASE` with 0 log calls against the literal expectation of 1. Expected values are literals: status `204`, status `500` and body `{"error":"internal error"}`, message `request failed`, 1 call, 0 calls for expected errors, exactly 1 `HTTP/1.1 ` line.
2. **Validation compatibility.** The new and existing tests in `src/server.validation.test.ts` pass on `BASE` and on the branch (3× each). Messages are the literals of this spec's table and lists, and the differential compares with the pinned contract validator, an independent module.
3. **Source review against the pinned schema.** In `src/server.ts`:
   - none of the strings `reason must be at most`, `reason must be a string or null`, `latencyMs: must be an integer`, `checkId must be a non-empty string`, `timestamp must be an integer (epoch ms)`, `status must be "up", "degraded" or "down"`, `statusCode must be null or an integer from 100 to 599`, `body must be a JSON object`, `location must be a string` remains. Check with `grep -c` for each string: expected 0;
   - the strings `attempts must be an integer from 1 to `, `certDaysLeft must be null or an integer from -`, `timestamp is older than 7 days`, `ms in the future`, `location must be at most `, `body must not have accessor properties` each still occur (`grep -c` ≥ 1).
4. **Docs.**
   - `grep -c 'reason must be at most 1000 characters' docs/troubleshooting.md` is 0;
   - `grep -c 'result.reason: must be null or a string of at most 1000 characters' docs/troubleshooting.md` is ≥ 1;
   - `grep -c 'MAX_LATENCY_MS' docs/rest-api.md` is 0;
   - `README.md`, `docs/rest-api.md` and `docs/operation.md` each mention `request failed` or the late-failure close (manual review against R4);
   - the changed lines are listed in the PR body.
5. **Full check.** `bun run check` exits 0 with 0 failing tests under the unchanged `bunfig.toml` threshold. Do not expect an exact coverage number.
6. **Manual start.** Step 8 gives `400` with the literal message and `204`.
7. **Scope gates**, after the last commit, each an independent check:
   1. `git diff --name-only "$BASE" HEAD | LC_ALL=C sort` equals exactly this literal list, all 7 present: `README.md`, `docs/operation.md`, `docs/rest-api.md`, `docs/troubleshooting.md`, `src/server.errors.test.ts`, `src/server.ts`, `src/server.validation.test.ts`.
   2. `git diff --name-only --cached` is empty.
   3. `git diff --name-only` is empty.
   4. `git status --porcelain` is empty, untracked files included.
   5. `git diff --exit-code "$BASE" HEAD -- src/start.ts src/main.ts src/service.ts src/state.ts src/db.ts src/migrations.ts src/metrics.ts src/tokens.ts src/token-store.ts src/admin-routes.ts src/manual-incident-routes.ts src/location-limits.ts AGENTS.md CLAUDE.md package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github Dockerfile .dockerignore scripts bench test docs/configuration.md docs/concepts.md docs/install.md docs/development.md docs/index.md` exits 0. Every path outside the 7 is also protected by gate 1.
8. **Gate fixture.** Prove the gate script in a disposable `git init` fixture in `mktemp -d`, never in the api checkout. Create a base commit holding an allowed file and a protected file, and record its `BASE`. Report each case:
   - a clean allowed committed change passes;
   - a protected change only in the worktree fails;
   - a protected change only in the index fails;
   - a protected change only in a commit fails;
   - a protected change staged, then the worktree restored to `BASE` bytes (`git show "$BASE:<file>" > <file>`), fails;
   - a protected change committed, then the worktree restored to `BASE` bytes, fails;
   - an allowed uncommitted edit fails;
   - an untracked file fails.
9. **Comments.** `src/server.errors.test.ts` has no comment except one line naming the test class and the expected outcome. Read every added line of the diff, inline comments and lint directives included. List every added comment in the PR body; write "none" only after that full read.
10. **Performance.** Report the interleaved test-CPU delta (≥ 3 base/branch pairs, per-run user+sys, mean delta, noise caveat) as information. No Docker bench.
11. **PR body.** It names `Closes lorenzh/pulse-meta#<child>` and gives `BASE`, the file list, the red/green outputs, the baseline counts, the full-check result, the manual start, the doc line inventory, the comment inventory, the gate and fixture results, and the known limits.
