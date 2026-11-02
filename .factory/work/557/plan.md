# Spec #557: probe scheduler and retry edge cases

Source: issue [#557](https://github.com/lorenzh/pulse-meta/issues/557) and its review in
`.factory/work/557/issue-review.md`. All five nonblocking points of that review are settled
below. Read on probe `main` `271401b` (newer than the issue's `50ec9ca`; the findings still hold).

## Goal

Fix five probe edge cases in one change:

1. HTTP retries only for idempotent GET and HEAD.
2. `PULSE_BUFFER_MAX_AGE_MS` cannot exceed the api's 7-day result window.
3. Checks with the same interval do not all start at the same instant.
4. A skipped check is logged once, not again on every reload.
5. A changed check's in-flight run is aborted, and every check type honours a shutdown that has
   already happened.

## Scope

- probe only: `src/`, its tests, `README.md`, `docs/configuration.md`, `docs/operation.md`,
  `docs/troubleshooting.md`.
- Candidate-image run of the existing deploy `e2e/compose-e2e.sh` in a throwaway copy of deploy.
  Deploy gets no commit.

## Non-goals

- No contract, kit, api, config or deploy change. No new env var, no wire field, no new route.
- No public jitter setting. The bound is fixed (below).
- No change to the result delivery retries of `POST /results` (the buffer). They stay: the api
  treats a repeated result as the same result.
- No retraction of results whose post had already started before a check was replaced.
- No change to TLS's single attempt, the retry budget rules, the private-range policy, header
  host binding, or redirect rules.
- Heartbeat checks stay silent and unscheduled.

## Required behavior

### 1. Retry only GET and HEAD (`src/check.ts`)

- An HTTP check (`type` absent or `"http"`) retries only when its configured `method` is `GET`,
  `HEAD`, or absent (absent means GET). The decision uses the configured method, not the method
  of a later redirect hop. A POST that a 303 turns into GET still makes one attempt.
- `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` make exactly one attempt (`attempts: 1`) and
  never call `sleep`, even with `retries` > 0. The check is still accepted; `retries` and
  `retryDelayMs` are ignored for it.
- TCP, DNS and domain checks keep their retries unchanged. TLS keeps its single attempt.
- GET/HEAD keep the current count, delay, interval budget (`monotonic() + retryDelayMs >= start
  + intervalMs` stops early) and early success.
- Docs: `docs/configuration.md` "### Retries" and the `method` bullet in "### Request options"
  say that only GET and HEAD retry, that other methods make one attempt, and warn that a
  request with another method can have side effects on the target at every run.

### 2. Buffer max age at most 7 days (`src/settings.ts`)

- `PULSE_BUFFER_MAX_AGE_MS` accepts integers from 1 to 604800000 (7 × 86 400 000) inclusive.
  Default stays 3600000.
- A larger value fails startup through the existing `StartupError` path (exit 2, one line):
  pass `max: 604_800_000` to kit `readMs` (`settings.ts:79`). Kit's `readRanged` builds the
  message `PULSE_BUFFER_MAX_AGE_MS: must be an integer from 1 to 604800000`
  (`.repos/kit/src/settings.ts:21-22,50`, kit pin `739188a` in probe `package.json:31`).
- `buffer.ts` keeps its strict "older than max age by result timestamp" rule; no code change
  there.
- Docs: the range in `docs/configuration.md:15` reads `1 to 604800000 (7 days, the api's limit)`;
  `docs/operation.md:29` says the value cannot exceed 7 days.

### 3. Bounded jitter on the first run (`src/scheduler.ts`)

- `SchedulerDeps` gains `random: () => number` (returns a number in `[0, 1)`); `main.ts` (via
  `check-scheduler.ts`) wires `Math.random`.
- The first run of every new entry is delayed by
  `delay = Math.floor(random() * bound)` with `bound = Math.min(check.intervalMs, 1000)`. So
  `0 <= delay < bound <= 1000` ms, whole milliseconds. One `random()` call per new entry.
  A value outside `[0, 1)` from a broken source is clamped so that `0 <= delay <= bound - 1`.
- "New entry": every check at startup, a check added by a reload, and a check replaced because
  it changed. An unchanged check keeps its entry, its pending timer and its schedule.
- The first run goes through `deps.timer.setTimeout`, so `remove`, replacement and `stop` cancel
  it like any later run.
- Later runs keep today's rule: next start = previous start + `intervalMs`, armed only after the
  run and its `onResult` finished (no overlap).
- Reason for 1000 ms: it spreads the startup burst of many equal-interval checks across a second
  without delaying the first result noticeably; deploy E2E waits are in tens of seconds
  (`.repos/deploy/e2e/compose-e2e.sh:21` `T_FIRST_RESULT` 90 s).
- Docs: `docs/configuration.md` "### Schedule" replaces "runs immediately at startup" with the
  random first delay below `min(intervalMs, 1000)` ms for new and changed checks.

### 4. One skip warning per check (`src/client.ts`)

- The two skip paths are: invalid check (`client.ts:289`) and header-env skip (`client.ts:231`:
  prefix missing, unset/empty, invalid header value).
- Warning state lives per logger identity, like `warnedAbsent` (`client.ts:176`): a module
  `WeakMap<object, Set<string>>` keyed by `deps.log`. The probe passes one `log` for startup and
  every reload (`main.ts` `runChecks`), so one probe process warns once per key. A new `log`
  function (a new probe, a new test scope) warns again.
- Key: the check ID when `raw` is an object with a string `id` (same rule as `readableId`). Both
  skip paths of one ID share the key. Records without a readable ID share one fixed key, so they
  produce a single line `skipping invalid check: <error>` per scope, then stay quiet.
- The key never holds a header value, body, or raw payload; only the ID that the line already
  logs.
- Once warned, the ID stays quiet in that scope even if it recovers and is rejected again, or is
  rejected for another reason.
- Logging only: every load still validates every check and resolves headers. A corrected check is
  returned and runs. Heartbeats stay silent. The header-host denial line (`check <id>: ...;
  reporting down`) is not a skip and keeps its current behavior.
- Docs: `docs/troubleshooting.md` "skipping invalid check" and `docs/configuration.md:100` say
  the line appears once per check ID per probe process.

### 5. Abort changed runs; every type honours shutdown

Scheduler (`src/scheduler.ts`, `src/check-scheduler.ts`):

- `run` becomes `run(check, signal)`. Each entry owns an `AbortController`. `remove` (removal,
  replacement) and `stop` abort it. "Changed" is today's rule: not `isDeepStrictEqual` to the
  running check. An equal sync does not abort.
- `check-scheduler.ts` passes `AbortSignal.any([entrySignal, deps.signal])` as the run signal and
  `deps.signal` (process shutdown) separately as `shutdown` (see domain below).
- A replacement does not overlap the old run of the same ID: its first run starts when both its
  jitter delay has passed and the old entry's in-flight run (if any) has settled. The old run
  settles promptly because it is aborted.
- An aborted run never reaches `onResult` (today's `isCurrent` rule stays) and does not call
  `onError`: a rejection while the entry's signal is aborted is expected and not logged.

Check run (`src/check.ts`):

- `CheckDeps.sleep` becomes `(ms: number, signal?: AbortSignal) => Promise<void>`; `runAttempts`
  passes the run signal. `main.ts` wires `sleep(ms, undefined, { signal })` from
  `node:timers/promises`.
- `runAttempts` returns the last result without another attempt when the signal is aborted
  before an attempt, during the retry wait (a rejected `sleep` is caught) or after it.
- A run whose signal is already aborted on entry starts no request, socket or lookup for any
  type and returns `down` with `timeout after <timeoutMs>ms` as today's abort mapping does (the
  result is dropped by the scheduler anyway).
- `CheckDeps` gains `shutdown?: AbortSignal`: the process lifetime, used only for shared work.

Transports:

- TCP default (`check-tcp.ts:16-35`): if `signal.aborted` on entry, reject with `signal.reason`
  and create no socket. On abort during connect, destroy the socket and remove the listener.
- DNS default (`check-dns.ts:46-60`): if `signal.aborted` on entry, reject with `signal.reason`
  and create no `Resolver`. On abort, `cancel()` and remove the listener (as today).
- TLS: `TlsConnectOptions` gains `signal?: AbortSignal`. Default `tlsConnect`
  (`check.ts:46-71`) combines it with its timeout signal; if aborted on entry it creates no
  socket; abort destroys the socket. `runTlsCheck` passes the run signal. Guarded `tlsConnect`
  (`check-guard.ts:46-68`) combines the passed signal with its own timeout for
  `resolveAllowed` and `connectFirst` and forwards it to each `deps.tlsConnect`. Timeout budget
  and SNI rules stay.
- HTTP: `attemptHttp` already combines the run signal with the timeout; with an aborted signal
  no `fetch` call is made (check before the first hop).
- Domain (`check-domain.ts`): per-check work (waiting on the bootstrap via `untilAborted`, RDAP
  hops) uses the run signal. The shared single-flight bootstrap fetch (`refreshBootstrap`,
  `check-domain.ts:133-141`) uses `attemptSignal(BOOTSTRAP_TIMEOUT_MS, deps.shutdown)`, never a
  per-check signal, so one replaced check cannot abort another check's bootstrap. A run whose
  signal is already aborted does not start a bootstrap refresh. `DomainDeps` gains
  `shutdown?: AbortSignal`; `runAttempt` passes both. Cache and single flight stay.
- Docs: `docs/configuration.md` "### Schedule" adds: a changed or removed check's running attempt
  and its retry wait are aborted and its result is dropped. `docs/operation.md:83` stays true.

## Risks

- Existing tests assume an immediate first run (`scheduler.test.ts:56` and others) and an
  accepted age of 2147483647 (`settings.test.ts:30-33`). They must inject `random: () => 0` or
  advance the fake timer; the settings test moves to the new maximum. Do not weaken them.
- `main.test.ts:122` waits for a post with `until` (10 s, `main.test.ts:62`); the real process
  adds at most 999 ms. Keep the test, do not stub randomness in the child process.
- Operators with `PULSE_BUFFER_MAX_AGE_MS` above 604800000 get exit 2 after the upgrade. The
  docs already told them to stay below 7 days; the README/docs note this as a breaking limit.
- An operator relying on POST/PUT retries loses them. This is the requested behavior; the docs
  say so.
- Cancellation adds a signal to every transport; a missed listener removal leaks. Tests check
  listener and socket cleanup on loopback.
- Domain shared bootstrap must not inherit a per-check signal (see above).

## Acceptance evidence

Every regression test below fails on probe `271401b` and passes after the change. The implementer
shows the red run (test output against unchanged `src/`) and the green run in the PR.
Expected values are literals in the test.

1. Retry: table test for `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` with `retries: 3`,
   `retryDelayMs: 10`, fake fetch answering 500: exactly 1 fetch call, 0 `sleep` calls,
   `attempts: 1`. Controls: GET, method absent and HEAD with the same setup make 4 fetch calls,
   3 `sleep(10)` calls, `attempts: 4`. A POST answered with 303 to a URL that answers 500 makes
   one attempt (2 fetch calls for the two hops, `attempts: 1`). Existing TCP/DNS/domain retry
   tests stay green.
2. Buffer age: `loadSettings` with `PULSE_BUFFER_MAX_AGE_MS=604800000` returns 604800000;
   `604800001` throws `StartupError` with message exactly
   `PULSE_BUFFER_MAX_AGE_MS: must be an integer from 1 to 604800000`; unset gives 3600000.
3. Jitter: three checks with `intervalMs: 60000`, `random` returning 0, 0.5, 0.999 in turn: no
   run starts inside `startScheduler` itself (before any `advance`); first runs at 0, 500 and 999 ms of fake time (0 means the timer fires at the
   first `advance(0)`, not synchronously in `sync`); second runs at 60000, 60500, 60999. A check with `intervalMs: 200`
   and `random` 0.999 starts at 199. Unchanged sync keeps the pending timer (same handle, no new
   `random` call); a changed check calls `random` again; removal and `stop` before the first run
   leave no pending timer and no run.
4. Skip once: one `log` across an initial `loadChecks` and two reloads, with an invalid check
   `bad` (with ID), an HTTP check `hdr` whose header env is unset, an ID-less invalid record
   and a valid check `ok`: exactly 3 skip lines in total (one each), `ok` returned every time.
   After setting the env, `hdr` is returned; after unsetting it again, no new line. A second
   `log` function produces the 3 lines again. No line contains the header value sentinel.
5a. Changed run: scheduler with a run that blocks until its signal aborts; sync a changed check
   with the same ID: the old signal is aborted, the old run's result does not reach `onResult`,
   `onError` is not called, and the next run receives the new check. Equal sync: signal not
   aborted. Removal and `stop`: signal aborted.
5b. Retry wait: a GET check with `retries: 2` whose signal aborts during `sleep`: 1 fetch call
   in total.
5c. Shutdown already happened: with an aborted signal, default `tcpConnect` against a loopback
   server on port 0 accepts no connection (server `connection` count 0); default
   `resolveRecords` against a loopback UDP DNS fake receives no query; default `tlsConnect`
   against a loopback TLS server receives no connection; HTTP and domain fake `fetch` gets 0
   calls; guarded `tlsConnect` calls neither `lookup` nor the inner `tlsConnect`.
5d. Abort in flight: aborting during a TCP connect and a TLS handshake to a loopback server
   that never answers settles the promise within the test and leaves no abort listener on the
   signal; the guarded TLS passes an aborted signal to the inner `tlsConnect`.
5e. Domain: two domain checks share one pending bootstrap; aborting the first check's run signal
   ends only the first run; the second gets its result; aborting `shutdown` aborts the shared
   bootstrap fetch.
6. Gates: `bun install --frozen-lockfile`, `bun run check`, probe CI (`check` and both `docker`
   legs) green on the PR.
7. Run once: `bun run start` against a fake api with two checks of equal interval and one check
   with an unset header env, reload twice: log shows one skip line and the two first results at
   different times; report the command and log excerpt.
8. Compose E2E with the candidate image (deploy stays unchanged):
   ```
   docker build --tag pulse-probe:candidate <probe checkout>
   cp -r .repos/deploy /tmp/deploy-557   # or a fresh clone of lorenzh/pulse-deploy main
   # in /tmp/deploy-557/common/services.yaml, set only the probe service's image to pulse-probe:candidate
   cd /tmp/deploy-557 && scripts/init-secrets.sh && bash e2e/compose-e2e.sh
   ```
   Expected: the last line is `==> All checks passed` (the script's own literal) and
   `docker compose -p pulse-e2e ps` during the run shows image `pulse-probe:candidate` for the
   probe. Record the probe commit, the candidate image ID and the deploy commit. A run of the
   unchanged published pins does not count.

## Performance impact

Metrics of `.repos/api/bench/budgets.json` for `probe` (budgets: `startup_cpu_ms` 377,
`load_cpu_s` 0.5, `idle_rss_mib` 79, `peak_rss_mib` 83, `test_cpu_s` 2.3, `startup_wall_ms`
1027, `image_mb` 124):

- `test_cpu_s`: up, by roughly 0.1-0.3 s for the new tests (loopback TCP/TLS/DNS fixtures).
  Must stay under 2.3. Measure with `/usr/bin/time -f '%U %S' bun run test` on `271401b` and on
  the branch, three runs each, compare medians.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`: none expected; same number of runs per window,
  one `AbortController` per entry (20 in the bench).
- `startup_cpu_ms`, `startup_wall_ms`: none expected; `/readyz` turns ready after the checks are
  loaded, before the first run, so the jitter is not in the measured path (`main.ts` calls
  `onReady()` before `startCheckScheduler`).
- `image_mb`: none; no new dependency or file in the image.
- The api A/B `bun bench/run.ts --a <ref> --b <ref>` takes probe B from `main`; after merge, the
  next scheduled bench reports the probe numbers. No pre-merge bench run is required.

## Security impact

Security impact: yes. It changes the probe HTTP client's retry rule, adds signals to every check
transport, the guarded TLS path, and changes log lines that carry check IDs from the api.

Checklist items that apply:

- Secrets in errors, logs and responses: skip lines and their dedup keys hold only check IDs and
  variable names, never header values, bodies or raw payloads. Test 4 asserts a header sentinel
  is absent.
- Input validation: `PULSE_BUFFER_MAX_AGE_MS` gets a tighter upper bound through kit `readMs`.
- SSRF and redirects: the retry rule uses the configured method; a redirect never grants a
  retry. Guarded TLS keeps `resolveAllowed` and `connectFirst`: the new signal only ends work
  sooner and never bypasses the address check (test 5c: an aborted guarded TLS calls neither
  `lookup` nor connect).
- Body and size limits, auth order, atomic writes, dependency pins, accessor execution: not
  touched.

Hostile inputs for the security state: an api serving the same invalid check with a new ID on
each reload (one line per ID, bounded by the 5 MiB check body), an ID-less record flood (one
line), a header env value with CR/LF (skipped, value never logged), a redirect chain POST → 303
→ GET answering 500 (one attempt).

## Rollout order

One repository: only probe changes. No wire shape, contract pin or kit pin moves, so an older
api, status and notify keep working; a probe at another location on an older version keeps its
old retry and schedule behavior until it is upgraded. Deploy's published pin moves only with a
later probe release, as a separate step.

## Counterexamples

- Retry: `method: "POST"`, `retries: 3`, target answers 500: 4 attempts is wrong, 1 is right.
  `method: "DELETE"` with `retries: 1` on a timeout: 1 attempt. Method absent: 4 attempts (it is
  GET). A wrong implementation that checks the method of the last hop gives a 303'd POST four
  attempts. A wrong implementation that disables the loop for all types breaks TCP retries.
- Buffer age: 604800000 accepted, 604800001 rejected (exit 2), 0 rejected, `7d` rejected,
  2147483647 (accepted today) rejected.
- Buffer expiry boundary (unchanged): with `maxAgeMs` 604800000 and `now` T, a result with
  timestamp `T - 604800000` is kept; `T - 604800001` is dropped as `too_old`.
- Jitter: `delay` is `floor(random * min(intervalMs, 1000))`. `random` 0.999 and `intervalMs`
  60000 gives 999, never 1000; `intervalMs` 1 gives 0 always; `intervalMs` 200 and 0.999 gives
  199. A wrong implementation using `intervalMs` as the bound delays an hourly domain check by up
  to an hour. A wrong implementation applying jitter on every run, or on an unchanged sync, shifts
  the schedule; tests 3 catch both.
- Skip once: the same ID skipped for a header and later for invalid JSON fields: 1 line, not 2.
  Two IDs `a`, `b`: 2 lines. A key by array index is wrong: reordering the list would warn again.
- Cancellation: an equal reload (`isDeepStrictEqual` true) must not abort; a change only in
  `timeoutMs` must abort. A shutdown abort of one domain check's run signal must not reject the
  other domain check sharing the bootstrap.
- No statistics are introduced.

## Contract fields

No new names on the wire, in env, or in config. Searches (run in the meta checkout):

- `grep -rn 'jitter' .repos/contract/src .repos/config` → no match.
- `grep -rn 'PULSE_.*JITTER\|firstRun' .repos/contract/src .repos/config` → no match.
- The method list is the contract's own: `.repos/contract/src/schema.ts:100`
  `HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`; no rename.

Probe-internal TypeScript names only: `SchedulerDeps.random`, `CheckDeps.shutdown`,
`DomainDeps.shutdown`, `TlsConnectOptions.signal`, the `run(check, signal)` and
`sleep(ms, signal)` parameters.

## Repository: probe

Files:
- `src/check.ts`
- `src/check-tcp.ts`
- `src/check-dns.ts`
- `src/check-domain.ts`
- `src/check-guard.ts`
- `src/check-scheduler.ts`
- `src/scheduler.ts`
- `src/client.ts`
- `src/settings.ts`
- `src/main.ts`
- `src/check.test.ts`
- `src/check.tcp.test.ts`
- `src/check.dns.resolver.test.ts`
- `src/check.domain.test.ts`
- `src/check-guard.test.ts`
- `src/tls.test.ts`
- `src/scheduler.test.ts`
- `src/client.test.ts`
- `src/settings.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/operation.md`
- `docs/troubleshooting.md`

Behavior change: yes. Retries, the settings limit, the first-run timing, skip logging and
cancellation all change at run time.

Behavior: items 1-5 of "Required behavior" above. The implementer may split a large test file
by topic (`src/<module>.<topic>.test.ts`) per probe `AGENTS.md`; new files belong in this list's
scope.

Tool facts (verified):
- Bun 1.4.0: `package.json:8` (`packageManager`) and `:10` (`engines`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`);
  lint is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`); typecheck is
  `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:14`), TypeScript
  `npm:typescript@7.0.2` (`package.json:27`); Biome `2.6.3` (`package.json:22`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`; at the pinned config ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:23`) its `files.includes` is
  `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (lines 10-17). The
  pinned file is identical to the config clone `main` `bc87049`.
- `bunfig.toml:1-4`: `[test]` coverage on, line threshold 0.8, test files ignored for coverage.
- CI `.github/workflows/ci.yml:18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`;
  at that ref the job runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run test` (check.yml lines 25-38), Bun 1.4.0 (line 24); identical to the config clone.
  `ci.yml:19-75`: `docker` job on `ubuntu-24.04` and `ubuntu-24.04-arm` builds the image and runs
  the dotenv, no-test-files and healthcheck steps.

Checks: every test of "Acceptance evidence" 1-5e, red on `271401b` and green after. Existing tests
that assumed an immediate first run or the old maximum are updated to the new behavior with
injected `random`/timers, never deleted. No real timers or external network; loopback servers on
`127.0.0.1` port 0, closed after the test.

Completion evidence: `bun install --frozen-lockfile` and `bun run check` pass locally; probe CI
`check` and both `docker` legs green; the `bun run start` exercise (evidence 7) reported in the PR;
the candidate-image Compose E2E (evidence 8) ending with `==> All checks passed`, with the probe
commit, image ID and deploy commit recorded; `test_cpu_s` before/after medians reported and below
2.3 s.
