# Spec #555: kit: timer, shutdown and logger fixes, shared helpers, pin bump everywhere

## Goal

One pulse-kit with correct timer bounds, a shutdown timeout that fails, a logger that never throws, and one durable atomic-write helper. The same kit commit is used by api, probe, status, notify and console. The copied helpers (`isRecord`, the token-file reader, the atomic-write algorithms, the local timer maxima) are replaced by kit exports.

Sources: issue #555, the issue review `.factory/work/555/issue-review.md` (its assumptions are adopted below unless a decision says otherwise), and the read-only clones, all still `main`: kit `6a06ec2`, api `c00a375`, probe `50ec9ca`, status `2e3067d`, notify `c090a07`, console `11a3f5f`, config `dc69a12`. Every file and line reference below was re-read in these clones.

## Scope

- kit: `readMs` bound, new `readInt`, `runService` timeout exit, logger, new modules `atomic-write.ts`, `is-record.ts`, `secret-file.ts`, the `./is-record` subpath, `dist/`, tests and docs.
- api, probe, status, notify, console: bump the kit pin to the one kit SHA (decision 9), replace local copies with kit exports, adopt the atomic-write helper (api, notify), adapt tests and operator docs.

## Non-goals

- No environment variable renames, added or removed (owner decision). Defaults stay as they are.
- No wire, route or contract change. Contract's own `MAX_TIMER_MS` and its private guards stay. No contract-to-kit dependency.
- notify's channel secret reader (`notify/src/config.ts:49-96`, trailing-newline strip only) is not migrated.
- api's narrower limits stay: `PULSE_CHECKS_RELOAD_INTERVAL_MS` max 3 600 000 (`api/src/start.ts:39`), config-file timer limits from contract.
- No long-wait scheduling (splitting a 30-day wait into chunks). Oversized delays are rejected, never shortened.
- No redesign of a startup promise that never settles. No other audit findings, no tooling upgrades, no deploy or website change (website's kit docs-source ref is not a service pin).

## Decisions on the review's open points

1. **Timer bound at the settings boundary.** `readMs` defaults `max` to `MAX_TIMER_DELAY_MS` (`2147483647`, `kit/src/timer.ts:130`) instead of `Number.MAX_SAFE_INTEGER` (`kit/src/settings.ts:42`). Its rule text always names the effective bound: `must be an integer from <min> to <max>`. An explicit `opts.max` above `2147483647`, or a `fallback` that is not an integer in `[min, max]`, is a programming error: `readMs` throws `RangeError` (not `StartupError`) before it reads the env value. An oversized value is rejected, never clamped.
2. **Non-timer integers keep their range.** New kit export `readInt(env, name, { fallback, min, max?, describe? }): number` behaves exactly like today's `readMs` (default max `Number.MAX_SAFE_INTEGER`, rule `must be an integer >= <min>` without `max`, `from <min> to <max>` with `max`). Every caller that does not feed a timer moves to `readInt` (list per repository below). Timer callers stay on `readMs`.
3. **Derived delays.** notify's heartbeat interval is `leaseSeconds / 6 * 1000` ms (`notify/src/index.ts:300`). `PULSE_NOTIFY_LOCK_LEASE_SECONDS` gets `max: 12_884_901` (the largest whole number of seconds whose lease/6 in ms stays at or below `2147483647`: `12884901 / 6 * 1000 = 2147483500`). notify's retry backoff is capped by `PULSE_NOTIFY_RETRY_MAX_DELAY_MS`, which becomes timer-bounded. Fractional delays (lease/6) stay allowed; `safeSetTimeout` is not wired into notify's scheduler.
   status's browser fetch timeout is `PULSE_STATUS_UPSTREAM_TIMEOUT_MS + BROWSER_TIMEOUT_MARGIN_MS` (`status/src/server.ts:73,612`, margin `2000`); the page reads it from `data-timeout-ms` (`status/public/client.js:32`) and the poller hands it to `fetchJson`, whose `schedule` calls `setTimeout` with it (`status/src/poller.ts:180-182,213-215`; `contract/src/client.ts:181`). So `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` gets `max: MAX_UPSTREAM_TIMEOUT_MS = MAX_TIMER_DELAY_MS - BROWSER_TIMEOUT_MARGIN_MS = 2147481647`: the largest accepted value renders `data-timeout-ms="2147483647"`. The margin stays `2000`; the browser value is never clamped. The same bound applies to the programmatic `upstreamTimeoutMs` option (`status/src/server.ts:555-559`, `checkMs`). `POLL_MS` reaches the browser unchanged (`data-poll-ms`, `poller.ts:384`) and stays bounded at `2147483647`; `3 * pollMs` in `status/src/metrics.ts:37` is a staleness comparison, not a timer, and needs no bound.
4. **`runService`.** The timeout exit code defaults to `1`. `timeoutExitCode`, when given, must be an integer from `1` to `255`; `timeoutMs` must be an integer from `1` to `2147483647`. A violation rejects the returned promise with `RangeError` before any signal handler is registered and before `start` runs. Clean stop stays `0`, `StartupError` at start stays `2`, other start or stop failures stay `1`. Signal registration before start, one stop for repeated signals, and timer clearing are unchanged.
5. **api's inner shutdown bound.** When the drain hits `SHUTDOWN_TIMEOUT_MS` (`api/src/start.ts:352-361`), the API still closes all connections, aborts retention, waits for `retentionEnded`, closes the database and logs `stopped`, then `close()` rejects with new `ShutdownTimeoutError` (exported from `api/src/start.ts`, `name = "ShutdownTimeoutError"`, message `shutdown did not finish within <timeoutMs>ms`). `runService`'s stop catch then exits `1` (`kit/src/run-service.ts:205-209`). A drained shutdown still resolves. A second `close()` returns the same promise.
6. **Logger contract** ("never throws" for synchronous failures inside a log call):
   - The line starts with `time`, `level`, `msg` in that order, then fields in their enumeration order; a field named `time`, `level` or `msg` is still ignored. Level filtering and the stdout/stderr routing are unchanged.
   - A BigInt anywhere in a field value is written as a JSON string of its decimal digits: `10n` → `"10"`, `-5n` → `"-5"`.
   - A reference to an object that is its own ancestor on the current path is written as the string `"[Circular]"`. An object reached twice without a cycle (`{ a: o, b: o }`) is written twice in full.
   - A field whose value cannot be serialized for any other reason (a throwing getter or `toJSON`, nesting too deep for the stack) is written as `"[Unserializable]"`; the other fields are kept. If the fields object itself cannot be enumerated (for example a Proxy whose `ownKeys` throws), the line has the base keys plus `"fields":"[Unserializable]"`.
   - `now()` throwing, or returning a value that `new Date(v).toISOString()` rejects, gives `"time":null`.
   - A throwing `write` is caught and ignored (one-line comment); nothing is retried or logged about it.
   - Fallback text never contains the thrown error's message, its stack, or the original value.
   - Values `JSON.stringify` drops today (`undefined`, functions, symbols) stay dropped; `Date` and other `toJSON` values serialize as today.
   - Out of scope: asynchronous stream errors (EPIPE on stdout), process exit, memory exhaustion.
7. **Atomic write.** One kit module `src/atomic-write.ts`, with a sync and an async entry point (names, signatures and semantics under "Repository: kit"). Temp file `<path>.<suffix>.tmp` in the destination's directory, exclusive create (`wx`), all bytes written, `fchmod`, owner copy (EPERM tolerated), file `fsync`, `close`, optional `beforeRename` check, `rename`, directory `fsync`. Mode and owner of an existing destination are kept; a new file gets `opts.mode ?? 0o600`. Failures are reported as `AtomicWriteError` with a `stage`; a throw from `beforeRename` is rethrown unchanged. After a failed directory fsync the new bytes are already published: the error says so (`stage: "sync-dir"`), and callers reconcile as described per repository. notify's lock acquisition and takeover marker keep exclusive `wx` creation; only the heartbeat rewrite moves to the helper.
8. **Helpers.** `isRecord(value: unknown): value is Record<string, unknown>` keeps the exact predicate `typeof value === "object" && value !== null && !Array.isArray(value)` (a null-prototype object is `true`). It is exported from the root and from the browser-safe subpath `@lorenzh/pulse-kit/is-record`, which imports nothing. `readSecretFile` covers only the shared part of probe's and console's token-file readers: read, trim, non-empty, one line, and a sanitized error. Env/file exclusivity, required vs optional, printable ASCII, minimum length, whitespace and placeholder rules stay in the services.
9. **One kit SHA.** "The kit SHA" is the merge commit on `lorenzh/pulse-kit` `main` of the kit pull request that closes the kit child issue of #555. Each consumer finds it with `gh pr list --repo lorenzh/pulse-kit --state merged --search "pulse-meta#555 in:body" --json number,mergeCommit,body` and picks the PR whose body also names the kit child issue (the kit PR body must name both, see the kit section). A consumer never pins a later kit `main` tip, even if one exists. All five `package.json` entries and `bun.lock` resolutions use that full 40-character SHA.

## Required behavior

1. kit `readMs`: `2592000000` (30 days) and `2147483648` are rejected with `StartupError` `<NAME>: must be an integer from <min> to 2147483647`, not echoing the value; `2147483647` is accepted. Blank or unset still gives the fallback. No accepted setting, alone or after a service adds a margin or converts units, reaches a `setTimeout` with more than `2147483647` ms (notify lease, status browser timeout: decision 3).
2. kit `runService`: with `stop` pending, a signal plus the bound firing exits exactly `1`; a late `stop` resolution or a second signal adds no exit.
3. kit logger: BigInt and circular fields, together or alone, never throw and produce one parseable JSON line with the literal representations of decision 6.
4. kit atomic write: an interruption before rename leaves the destination's exact old bytes (or no file for a first write); success performs write → file fsync → rename → directory fsync in that order.
5. kit `isRecord`, `readSecretFile`, `readInt` exist with the semantics above; the `./is-record` subpath resolves in Bun and in the browser.
6. Services: every listed local copy is replaced; api and notify write through the kit helper; every service pins the kit SHA of decision 9; operator docs say a shutdown that hits its bound exits `1`.

## Risks

- **Error text changes.** Timer settings that had no explicit max now print `must be an integer from <min> to 2147483647` instead of `must be an integer >= <min>` (status `POLL_MS`; notify retry delays). status `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` prints `must be an integer from 1 to 2147481647` (decision 3). notify's `PULSE_NOTIFY_POLL_MS`, `PULSE_NOTIFY_TIMEOUT_MS` and lease setting lose the "of at least" wording. Tests and docs that quote these texts change in the same PR. Exit code (2) and the `setting` field do not change.
- **Exit-code change is visible to operators.** A shutdown that hits the bound now exits `1`. Orchestrators that restart on non-zero exit after `docker stop` may log it. `compose-e2e` asserts `docker stop` exits `0` (`api/docs/development.md:63`); this stays green only while every service drains within 5 s, which it does today. A red e2e after the change points at a real slow shutdown, not at the test.
- **New-file mode for notify.** notify's ledger and lock heartbeat temp files were created with `0o666 & ~umask` (typically `0644`). With the helper, an existing file keeps its mode; a first ledger write creates `0600`. The service and `failed` CLI run as the same user, so they still read it. The lock file is created by `wx` acquisition (unchanged) and keeps its mode on heartbeat.
- **Extra fsyncs in notify.** Each batch write and each heartbeat (default every 10 s) adds a directory fsync, and each heartbeat adds a file fsync it did not have. That is a few small fsyncs per second at most.
- **Temp names change.** notify's fixed `<path>.tmp` and `<path>.batch.tmp` become random `<path>.<pid>-<12 hex>.tmp`. notify tests that force a failure by creating a directory at `<path>.tmp` (`notify/test/ledger.test.ts:93`, `ledger.v2.test.ts:244`, `ledger.race.test.ts:91`) must inject a failing fs instead. A crash can leave a `*.tmp` file; it is never read.
- **API close now rejects on timeout.** Tests that inject a `sleep` resolving at once could hit the bound and now fail; current fakes never resolve the bound sleep except the forced-close test (`api/src/start.test.ts:51,162,245,340`), which is adapted.
- **Parallel children and one SHA.** Five consumer children start after kit merges. Decision 9 fixes the SHA so a later kit commit cannot split the pins.
- **compose-e2e builds consumers from their `main`** (`api/compose.yaml:28,41,56,69`). The api PR's own e2e run sees whichever consumers are merged at that time; the final integration evidence is a rerun after the last merge (Rollout order).

## Performance impact

`bench/budgets.json` exists in api `main` with keys per service (`api/bench/budgets.json`).

- **api, probe, status, notify `load_cpu_s`**: each log line now runs through a replacer that tracks ancestors, roughly one extra function call per serialized value. Logs are not written per request in the hot paths, so the expected change is below 1 % (within noise). Direction: up or flat.
- **notify `load_cpu_s`**: the added directory fsync per batch write and the added fsyncs per heartbeat are I/O wait, not CPU; expected flat. No notify latency metric is gated.
- **`startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`, all p95 and `rps`, all `cold_*` keys**: none expected. Three small kit modules (under 300 lines in total) are loaded; no new dependency.
- **kit `test_cpu_s`** (budget 0.7 s, gating) and **kit `build_cpu_s`** (budget 0.6 s, gating): up, by roughly 0.05-0.1 s and 0.02-0.05 s, from three new test files and three more modules to compile. The atomic-write test file (kit test 4) runs every case against a real `mkdtemp` directory through a delegating fake fs; that is at most 30 small atomic writes per run (about 12 cases per entry point, a few of them writing twice, each a few bytes), each with at most two `fsync` calls. `fsync` waits on I/O and costs little CPU, so the file I/O adds well under 0.05 s CPU; most of the increase is loading and compiling the new test files. The other new tests (`readMs`/`readInt`, `runService`, logger, `isRecord`, `readSecretFile`) touch no disk.
- **Service `test_cpu_s`**: flat to slightly up from the added tests (each under 0.1 s).

Measurement. `bun bench/run.ts` takes refs only for api (`--a`, `--b`); every other repository gets either one ref on both sides (`--others-ref`) or its newest `v*` tag (else `bench/baseline.json`) on A and `main` on B (`api/bench/refs.ts:56-66`, `api/bench/README.md:57`). So the measurement is split by what each run can isolate:

1. **api PR (api metrics only):** `bun bench/run.ts --a c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e --b <api PR head> --others-ref main --rounds 5`. Probe, status and notify are the same `main` on both sides, so only the api rows show this change; the probe, status and notify rows of this run are an A = A noise check, not evidence for those services. Per metric: median of the 5 rounds per side, compared as B minus A.
2. **probe, status, notify PRs:** the harness cannot put their PR heads on side B. Each of these PRs measures only `test_cpu_s` locally: user+sys CPU of `bun run test` (`/usr/bin/time -f "%U %S"`), 5 runs on the base commit (probe `50ec9ca`, status `2e3067d`, notify `c090a07`) and 5 on the PR head, median of the 5 sums per side, B minus A rounded to 0.01 s. Their runtime metrics (`startup_cpu_ms`, `load_cpu_s`, RSS) are not claimed in their PRs.
3. **Whole stack after the last consumer merge** (Rollout order step 3, run by a person): the `bench` workflow of api (`workflow_dispatch`, `api/.github/workflows/bench.yml:7-19`) with `a = c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e`, `b = main`, `others` empty. Without `others`, side A of probe, status and notify is their newest `v*` tag; today that is `v0.1.0`, which points exactly at the inspected bases (`git ls-remote --tags https://github.com/lorenzh/pulse-<name>.git 'v*'` printed `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605` probe, `2e3067d90eeb41ee6086060d1e52d34ef30b9c22` status, `c090a07811590eb158849fb9981f3c94fec74276` notify, on 2026-10-31). Before the run the person repeats that `ls-remote`: if a newer `v*` tag exists or the tag moved, side A no longer is the base and the run is reported as "not isolated". The person also records `git log --oneline <base>..main` for each of probe, status and notify: commits other than the #555 PR in that range are named in the report, because their effect is mixed into B. Per metric: median of 5 rounds per side (workflow default), B minus A.
4. **kit:** `test_cpu_s` and `build_cpu_s` locally as user+sys CPU of `bun run test` and `bun run build` (`/usr/bin/time -f "%U %S"`), 5 runs each on `6a06ec2` and on the PR head, median of the 5 sums per side, B minus A rounded to 0.01 s, reported in the PR.

A gating budget that is exceeded is a stop: report it, do not raise the budget.

## Security impact

Security impact: yes
The change touches file writes (config file with secrets, notify ledger and lock), the reading of token files, log texts that carry external data, and dependency pins in five services.

Checklist items that apply:
- **Atomic, path-safe writes:** temp file in the destination directory only, exclusive create, never removing a temp file that this call did not create, mode and owner of the existing file kept, `0600` for a new file, no broader access to stored secrets (api's checks file holds heartbeat secrets).
- **Secrets in errors, logs and responses:** `AtomicWriteError` messages carry only the stage and a Node error code matching `/^E[A-Z0-9]+$/`, no path content, no data. `readSecretFile` errors name the setting and path, never the file content or the raw fs message. Logger fallbacks never contain an exception message or the original value. A hostile `toJSON` or getter must not get its text into the line.
- **Input validation:** env integers reject oversized timer values at startup; `isRecord` keeps the exact predicate at every trust boundary that used it.
- **Accessor execution:** the logger may call getters and `toJSON` (as `JSON.stringify` does today) but contains their throws per field.
- **Dependency pins:** every service pins one full kit SHA (decision 9), `bun install --frozen-lockfile` passes.
- **Auth order and status codes:** the console admin token and probe token rules stay as they are; only the file-read part moves to kit. api's admin write status mapping (`api/src/config-write.ts:83-92`) is unchanged.
- **Body and size limits, SSRF and redirects:** not touched.

## Rollout order

1. **kit** merges first. Nothing consumes it yet: every service still pins `fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6` and keeps working unchanged. kit's new behavior reaches a service only through its pin bump.
2. **api, probe, status, notify, console** start after the kit merge and can merge in any order. Each pins the kit SHA of decision 9. A mixed stack (some services on `fa79ba8`, some on the new SHA) works: the change is process-local (settings, shutdown exit code, logging, file writes, helpers); no HTTP shape, route, env name, file format or lock protocol changes. notify's ledger and lock files keep their JSON content; an old notify can read a ledger written by the new one and the reverse. The lock protocol (`wx` acquisition, token check on heartbeat) is unchanged, so an old and a new notify still exclude each other.
3. **Final integration check** (after the last of the five consumer PRs is merged): a person reruns the latest `CI` workflow run of api `main` (`gh run rerun <run id> --repo lorenzh/pulse-api`). Its `compose-e2e` job builds probe, status, notify and console from their `main` (`api/compose.yaml:28,41,56,69`) and asserts `docker stop` exits `0` for every service (`api/docs/development.md:63`). The run URL and the five service `main` SHAs are recorded in a comment on #555. The same person then runs the whole-stack bench of Performance impact item 3 and adds its run URL, the `ls-remote` tag check and the per-metric B minus A to that comment.

## Counterexamples

- **`readMs` bound:** `2592000000` (30 days) and `2147483648` must be rejected; a wrong implementation that only changes `safeSetTimeout` still returns `2592000000` from `readMs` today (review reproduction: `readMs(30 days): 2592000000`). `2147483647` must be accepted; a fix using `<` instead of `<=` rejects it. `-1` with `min: 0` and `1e3`, `5000ms`, `" "` keep today's handling (reject, reject, reject, fallback).
- **Clamping is wrong:** `readMs` with `2592000000` must not return `2147483647`; a clamp silently shortens a 30-day wait to 24.8 days.
- **`readMs` programming errors:** `{ fallback: 5000, min: 0, max: 3_000_000_000 }` throws `RangeError` even with the env unset; `{ fallback: 0, min: 1 }` throws `RangeError`. A wrong implementation that validates only the env value lets an oversized fallback reach a timer.
- **`readInt` keeps range:** `PULSE_RETENTION_DAYS=3000000000` is still accepted by api (it is a day count). A wrong migration that leaves it on `readMs` rejects it. `PULSE_RETENTION_DAYS=89` still fails with `PULSE_RETENTION_DAYS: must be an integer >= 90`.
- **status browser timeout:** `PULSE_STATUS_UPSTREAM_TIMEOUT_MS=2147481647` is accepted and renders `data-timeout-ms="2147483647"`; `2147481648` is rejected with `PULSE_STATUS_UPSTREAM_TIMEOUT_MS: must be an integer from 1 to 2147481647`. A wrong implementation that bounds it with the plain `readMs` default accepts `2147483647` and renders `data-timeout-ms="2147485647"`, which overflows the browser's 32-bit timer so it fires at once (every page refresh then times out immediately). Clamping the rendered value to `2147483647` instead of rejecting is also wrong (it hides the bad setting). The default `4000` still renders `6000` (`status/src/server.test.ts:208`).
- **notify lease:** `12884901` accepted; `12884902` rejected (`12884902 / 6 * 1000 = 2147483666.67` exceeds the timer max).
- **`runService` exit:** stop pending, bound fires → `[1]`, not `[0]`. Stop resolves after the bound fired → still `[1]`. Stop resolves in time → `[0]`. Stop throws → `[1]`. `timeoutExitCode: 0`, `-1`, `1.5` or `256` → `RangeError`, no handler registered (`handlers.size === 0`), `start` not called. `timeoutExitCode: 3` → `[3]` on timeout. `timeoutMs: 2147483648` → `RangeError` (a timer above the max would fire after 1 ms).
- **api inner bound:** a drained shutdown resolves and the process exits `0`; a forced close rejects with `ShutdownTimeoutError` only after `db.close`, so a wrong implementation that rejects before `await retentionEnded` lets a retention batch write after the error.
- **Logger:** `{ n: 10n }` → `"n":"10"` (not `10`, not `"10n"`). `a = { name: "x" }; a.self = a` → `"a":{"name":"x","self":"[Circular]"}`. `{ a: o, b: o }` with `o = { k: 1 }` → `"a":{"k":1},"b":{"k":1}`; a WeakSet-of-seen implementation wrongly writes `"[Circular]"` for `b`. A getter that throws `new Error("secret-sentinel")` → that field `"[Unserializable]"`, other fields present, and the line does not contain `secret-sentinel`. `now: () => NaN` → `"time":null`. `write` throwing → the call returns normally. A field `level: "x"` never overrides the real level.
- **Atomic write ordering:** writing the destination in place, renaming before fsync, or fsyncing only the file (notify today) are all wrong. Fake fs records `open(temp,wx) write… fchmod fsync(temp) close(temp) rename open(dir,r) fsync(dir) close(dir)`; a sequence with `rename` before `fsync(temp)` or without `fsync(dir)` fails.
- **Interruption before rename:** destination holds `old\n`; the fake throws `ENOSPC` on the temp file's `fsync` → destination still `old\n`, no `*.tmp` left. Same for `beforeRename` throwing (api's stale check) and returning `false` (notify's superseded snapshot).
- **Temp collision:** the temp name already exists (forced `tempSuffix: () => "x"` with a pre-created `<path>.x.tmp` holding `foreign`) → `open` fails `EEXIST`, `AtomicWriteError` stage `"write"`, and `<path>.x.tmp` still holds `foreign`. A wrong cleanup that unlinks it deletes another writer's file.
- **Directory fsync failure:** the destination already holds the new bytes; the error has `stage: "sync-dir"`. A wrong implementation that tries to restore the old bytes, or reports success, is wrong.
- **`isRecord`:** `{}` → true, `Object.create(null)` → true, `new Date()` → true (unchanged predicate), `null` → false, `[]` → false, `"x"` → false, `1` → false. A "plain object only" check that rejects `Object.create(null)` or `new Date()` changes behavior.
- **`readSecretFile`:** content `"  tok\n"` → `"tok"`; `" \n\n"` → `file is empty`; `"a\nb"` → `must hold one line`; `"a\r\nb"` → `must hold one line`; a read error `{ code: "ENOENT", message: "secret-sentinel" }` → `<SETTING>=<path>: cannot read (ENOENT)` without `secret-sentinel`; `{ code: "not a code" }` → `cannot read` without a suffix.
- **console order:** `"short\nline"` (10 characters) now reports `must hold one line` instead of `must hold at least 16 characters`: both reject with exit 2; this is the only accepted message change in console.
- **One SHA:** a consumer that pins a newer kit `main` tip than the decision-9 merge commit is wrong even if that tip is green.

- **Bench isolation:** a run with `--others-ref main` used as evidence for probe, status or notify is wrong: both sides run the same service code, so its delta is zero by construction. A whole-stack run whose side A tag for a service is not the inspected base (a newer `v*` tag exists) must be reported as not isolated, not as this feature's delta.

Statistics: only the performance measurement. Each bench metric is the median of the 5 rounds per side (`bench/run.ts`, `api/bench/README.md:57`); each local CPU metric is the median of 5 runs per side of user+sys CPU seconds. Both are compared as B minus A, rounded to 0.01 s (CPU seconds) or 1 ms / 1 MiB (other units). The p95 latency metrics are reported only; they are computed by the harness per run and the median of the 5 per-run p95 values is taken, never an average of percentiles. No percentile is averaged.

## Contract fields

No new or renamed field, route, env name or wire key in contract or config. New kit exports and one new subpath; one new api export (`ShutdownTimeoutError`); one new status export (`MAX_UPSTREAM_TIMEOUT_MS`); one new served path in status (`/pulse-kit/is-record.js`, a static module under the existing `/pulse-kit/` prefix). Collision search in the clones:

- `grep -rn 'readInt\b' .repos/contract/src .repos/config .repos/kit/src` → no match (kit has only the private `readInteger`, `kit/src/settings.ts:29`, a different name).
- `grep -rn 'isRecord' .repos/contract/src .repos/config .repos/kit/src` → no match.
- `grep -rn 'readSecretFile' .repos/contract/src .repos/config .repos/kit/src` → no match.
- `grep -rn 'writeFileAtomic\|AtomicWrite\|nodeAtomicWrite' .repos/contract/src .repos/config .repos/kit/src` → no match.
- `grep -rn 'is-record' .repos/contract/src .repos/config .repos/kit` → no match.
- `grep -rn 'ShutdownTimeoutError' .repos/contract/src .repos/config .repos/api/src` → no match.
- `grep -rn 'MAX_LEASE_SECONDS' .repos/contract/src .repos/config .repos/notify/src` → no match.
- `grep -rn 'MAX_UPSTREAM_TIMEOUT_MS' .repos/contract/src .repos/config .repos/status/src .repos/kit/src` → no match (exit 1).

## Repository: kit

Files:
- `src/settings.ts`
- `src/run-service.ts`
- `src/logger.ts`
- `src/atomic-write.ts` (new)
- `src/is-record.ts` (new)
- `src/secret-file.ts` (new)
- `src/index.ts`
- `dist/settings.js`, `dist/settings.d.ts`, `dist/run-service.js`, `dist/run-service.d.ts`, `dist/logger.js`, `dist/logger.d.ts`, `dist/index.js`, `dist/index.d.ts`
- `dist/atomic-write.js`, `dist/atomic-write.d.ts`, `dist/is-record.js`, `dist/is-record.d.ts`, `dist/secret-file.js`, `dist/secret-file.d.ts` (new, generated by `bun run build`)
- `package.json` (`exports` gains `./is-record`)
- `test/settings.test.ts`, `test/run-service.test.ts`, `test/logger.test.ts`, `test/smoke.test.ts`
- `test/atomic-write.test.ts`, `test/is-record.test.ts`, `test/secret-file.test.ts` (new)
- `docs/index.md`, `README.md`

Behavior change: yes
Timer settings get a bound, the shutdown timeout exits 1, the logger stops throwing, and new exports are added. If the code already behaves this way, request a hold instead of a review.

### Changes

- `src/settings.ts`:
  - `readMs` (`:35-49`): decision 1. Import `MAX_TIMER_DELAY_MS` from `./timer.ts`. Validate `opts` first (`max <= 2147483647`, `fallback` an integer in `[min, max]`), else `RangeError` with a fixed message naming the setting name, e.g. `readMs(<NAME>): max must be at most 2147483647` / `readMs(<NAME>): fallback must be an integer from <min> to <max>`. Rule: `must be an integer from <min> to <effective max>`; `describe` still replaces it.
  - New `readInt` (decision 2): today's `readMs` body, renamed. Same `Describe` option.
- `src/run-service.ts`: decision 4. Doc comment `Default 0.` becomes `Default 1; an integer from 1 to 255.` Line 197 uses `opts.timeoutExitCode ?? 1`. Validation runs at the top of `runService`, before `proc.on`. Keep the warn text `shutdown did not finish within <timeoutMs>ms; exiting anyway`.
- `src/logger.ts`: decision 6. `emit` builds the line without throwing. Suggested shape (not required): serialize each field value separately with `JSON.stringify(value, replacer)` inside `try`, where the replacer turns `bigint` into its decimal string and keeps an ancestor stack (via the replacer's `this`) to emit `"[Circular]"`; join the parts with JSON-quoted keys; wrap `now()`/`toISOString()` and `write` in their own `try`. Keep cognitive complexity at or below 15 per function (split helpers).
- `src/atomic-write.ts` (new; root export only, never a browser subpath):
  ```ts
  export type AtomicWriteStage = "write" | "rename" | "sync-dir";
  export class AtomicWriteError extends Error {
    // name = "AtomicWriteError"
    readonly stage: AtomicWriteStage;
    /** Node error code of the cause when it matches /^E[A-Z0-9]+$/, else undefined. */
    readonly code: string | undefined;
  }
  export interface AtomicWriteSyncFs {
    /** Throws an error with code ENOENT when `path` does not exist. */
    stat(path: string): { mode: number; uid: number; gid: number };
    open(path: string, flags: "wx" | "r", mode?: number): number;
    /** Writes from `offset`; returns the number of bytes written. */
    write(fd: number, data: Uint8Array, offset: number): number;
    fchmod(fd: number, mode: number): void;
    fstat(fd: number): { uid: number; gid: number };
    fchown(fd: number, uid: number, gid: number): void;
    fsync(fd: number): void;
    close(fd: number): void;
    rename(from: string, to: string): void;
    unlink(path: string): void;
  }
  /** The same operations, each returning a Promise of the sync result. */
  export type AtomicWriteFs = {
    [K in keyof AtomicWriteSyncFs]: (
      ...args: Parameters<AtomicWriteSyncFs[K]>
    ) => Promise<ReturnType<AtomicWriteSyncFs[K]>>;
  };
  export const nodeAtomicWriteSyncFs: AtomicWriteSyncFs; // wraps node:fs sync calls
  export const nodeAtomicWriteFs: AtomicWriteFs;         // wraps node:fs async calls (implementer's choice of API)
  export interface AtomicWriteOptions {
    /** Mode of a new file (the destination does not exist yet). Default 0o600. */
    mode?: number;
    /** Unique part of the temp name. Default `${process.pid}-${12 lowercase hex from randomBytes(6)}`. */
    tempSuffix?: () => string;
  }
  export function writeFileAtomicSync(
    path: string,
    data: string | Uint8Array,
    opts?: AtomicWriteOptions & { fs?: AtomicWriteSyncFs; beforeRename?: () => boolean },
  ): boolean;
  export function writeFileAtomic(
    path: string,
    data: string | Uint8Array,
    opts?: AtomicWriteOptions & {
      fs?: AtomicWriteFs;
      beforeRename?: () => boolean | Promise<boolean>;
    },
  ): Promise<boolean>;
  ```
  Steps (both entry points, same order):
  1. `stat(path)`: ENOENT means a new file; another error → `AtomicWriteError` stage `"write"`.
  2. `temp = ${path}.${tempSuffix()}.tmp`; `mode = existing ? existing.mode & 0o7777 : opts.mode ?? 0o600`; `open(temp, "wx", mode)`. If `open` fails, nothing was created: throw stage `"write"` and do not unlink.
  3. Write all bytes of `data` (string as UTF-8) in a loop until done; `fchmod(fd, mode)` (the umask may have cut it); when the destination existed and `fstat(fd)` differs in uid or gid, `fchown(fd, uid, gid)`, ignoring only `EPERM` (one-line comment); `fsync(fd)`; `close(fd)`. A failure closes the fd if still open, unlinks `temp` best effort (comment: the original error is reported), and throws stage `"write"`.
  4. `beforeRename`: a throw → unlink `temp` best effort, rethrow the same error object unchanged. `false` → unlink `temp`, return `false`; the destination is untouched.
  5. `rename(temp, path)`: a failure → unlink `temp` best effort, stage `"rename"`.
  6. `open(dirname(path), "r")`, `fsync`, `close`: a failure → stage `"sync-dir"`; the destination already holds the new bytes; nothing is restored or removed.
  7. Return `true`.
  Message: `atomic write failed at <stage>` plus ` (<code>)` when `code` is set; `cause` is the original error. Never the path, never the data.
- `src/is-record.ts` (new): decision 8. Imports nothing.
- `src/secret-file.ts` (new):
  ```ts
  export function readSecretFile(
    path: string,
    opts: { setting: string; readFile?: (path: string) => string },
  ): string;
  ```
  Default `readFile` is `readFileSync(path, "utf8")`. Read error → `StartupError` `<setting>=<path>: cannot read (<CODE>)` when the error has an own string `code` matching `/^E[A-Z0-9]+$/` (read through `Object.getOwnPropertyDescriptor`, as `probe/src/token.ts:27-31` does), else `<setting>=<path>: cannot read`; `{ setting, cause }`. Then `trim()`; empty → `<setting>=<path>: file is empty`; contains `\r` or `\n` → `<setting>=<path>: must hold one line`; both with `{ setting }`. Returns the trimmed text.
- `src/index.ts`: add `readInt`, `isRecord`, `readSecretFile`, `writeFileAtomic`, `writeFileAtomicSync`, `AtomicWriteError`, `nodeAtomicWriteFs`, `nodeAtomicWriteSyncFs` and the types `AtomicWriteFs`, `AtomicWriteSyncFs`, `AtomicWriteOptions`, `AtomicWriteStage`.
- `package.json`: `exports["./is-record"] = { "types": "./dist/is-record.d.ts", "default": "./dist/is-record.js" }`, next to `./escape` (`package.json:19-22`).
- `test/smoke.test.ts`: add `atomic-write`, `is-record`, `secret-file` to `ALL_MODULES` (`:8-19`); add the new value exports (`AtomicWriteError`, `isRecord`, `nodeAtomicWriteFs`, `nodeAtomicWriteSyncFs`, `readInt`, `readSecretFile`, `writeFileAtomic`, `writeFileAtomicSync`) to the literal list (`:46-71`); resolve `@lorenzh/pulse-kit/is-record` in the subpath test (`:75-80`) and assert `isRecord({}) === true`, `isRecord([]) === false`. Assert `dist/is-record.js` contains no `import` statement (literal regex `/\bimport\b/` does not match).
- `docs/index.md`: settings table (`readMs` bound and rule, `readInt`), logger row (decision 6 representations), service-run paragraph (default exit `1`, validation), atomic-write section (steps, stages, mode, `beforeRename`), helpers (`isRecord` and its subpath, `readSecretFile`), browser-safe list now `format-duration`, `escape`, `is-record`; "Pin it in a consumer" lists console too.
- `README.md`: browser-safe subpaths line (`format-duration, escape, is-record`); consumers list adds pulse-console.

### Tests (each new regression fails on `6a06ec2` and passes after; expected values are literals)

1. `settings.test.ts`: `readMs({ X: "2592000000" }, "X", { fallback: 1, min: 0 })` throws `StartupError` with message exactly `X: must be an integer from 0 to 2147483647` (on `6a06ec2` it returns `2592000000`). Same for `"2147483648"`. `"2147483647"` returns `2147483647`. The message never contains `2592000000`. A fake downstream `setTimeout` that the test calls with the result is never called for the rejected values. `RangeError` cases of decision 1. `readInt` returns `3000000000` for `{ X: "3000000000" }` with `{ fallback: 1, min: 0 }` and keeps the `>= <min>` rule text.
2. `run-service.test.ts`: replace `timeout exit code defaults to 0` (`:153-166`) with `defaults to 1`: SIGTERM, stop never settles, fire `f.timers[0]?.fn()` → `f.exits` deep-equals `[1]`; then resolve stop and send SIGINT → still `[1]`. Keep the `timeoutExitCode: 3` test. Add the `RangeError` cases (`0`, `256`, `1.5`, `timeoutMs: 2147483648`) with `f.handlers.size === 0` and a `start` spy not called. Clean stop `[0]` and `StartupError` `[2]` tests stay.
3. `logger.test.ts`: with an injected `write` collecting lines and `now: () => 0`: `info("m", { n: 10n })`, `info("m", { a })` (self-referencing), and both in one call do not throw; each line `JSON.parse`s; parsed values equal the literals of decision 6 (`"10"`, `"[Circular]"`), and `time === "1970-01-01T00:00:00.000Z"`, `level === "info"`, `msg === "m"`. Repeated reference case. Throwing getter and throwing `toJSON` with message `secret-sentinel`: field `"[Unserializable]"`, other field kept, line does not contain `secret-sentinel`. Proxy fields with throwing `ownKeys`: `"fields":"[Unserializable]"`. `now: () => NaN` and `now` throwing → `"time":null`. `write` throwing → call returns. Level filtering (`debug` below `info` writes nothing) still holds. On `6a06ec2` the BigInt and circular cases throw `TypeError`.
4. `atomic-write.test.ts`, for both entry points. Every case below runs on the real filesystem: one `mkdtemp` directory per case under `os.tmpdir()` (removed in `afterEach`), written through a delegating fake that wraps `nodeAtomicWriteSyncFs` / `nodeAtomicWriteFs`, records each call and throws an injected error at one chosen call. Byte, mode and leftover-temp assertions read the real directory. This is the only new disk use of the kit tests (Performance impact: at most 30 atomic writes per run); no case uses a pure in-memory fs.
   - Order: the recording fake records the literal sequence `stat open(wx) write fchmod fsync close rename open(r) fsync close` (plus `fstat` when the file existed; `write` may repeat).
   - Pre-rename interruption: file `old\n` exists; the fake throws `{ code: "ENOSPC" }` on the first `fsync` (the temp file's). Result: `AtomicWriteError` with `stage === "write"`, `code === "ENOSPC"`; destination bytes equal `old\n`; `readdirSync(dir).filter(n => n.endsWith(".tmp"))` is `[]`. Then a write with the real fs succeeds and the file equals `new\n`.
   - `beforeRename` returning `false` → resolves/returns `false`, file still `old\n`, no temp. `beforeRename` throwing a custom error → that same object is rethrown (`assert.strictEqual`), file `old\n`, no temp.
   - `rename` failing with `EXDEV` → stage `"rename"`, `code === "EXDEV"`, file `old\n`, no temp.
   - Directory fsync failing (the fake throws on `fsync` of the fd that `open(dir, "r")` returned) → stage `"sync-dir"`, file equals `new\n`.
   - Mode: an existing file chmod `0o640` keeps `0o640` after the write (`statSync(file).mode & 0o777`); a new file gets `0o600`; `{ mode: 0o640 }` on a new file gives `0o640`.
   - Collision: `tempSuffix: () => "x"`, pre-created `<path>.x.tmp` with `foreign` → stage `"write"`, `code === "EEXIST"`, `<path>.x.tmp` still `foreign`, destination unchanged.
   - Temp placement: the recorded `open(wx)` path has `dirname` equal to the destination's `dirname` and ends with `.tmp`.
   - Message of every `AtomicWriteError` matches `/^atomic write failed at (write|rename|sync-dir)( \(E[A-Z0-9]+\))?$/` and does not contain the path or data.
5. `is-record.test.ts`: the seven literal cases of the `isRecord` counterexample.
6. `secret-file.test.ts`: the literal cases of the `readSecretFile` counterexample, with an injected `readFile`; `err.setting === "S"`; `err.cause` is the thrown read error.

### Checks (tool facts, cited)

- `bun run check` = `bun run lint && bun run build && bun run typecheck && bun run test` (`package.json:35`). Lint is `biome check . && pulse-eslint .` (`package.json:32`); build and typecheck use `typescript7` (`package.json:29-30`). Biome `@biomejs/biome` `2.6.3` (`package.json:38`). Runtime Bun `1.4.0` (`package.json:8`, `packageManager` `package.json:45`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json` at the pin `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:39`). At that ref (read with `gh api`, identical to the config clone) it includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (`biome.json:10-17`).
- `bunfig.toml:2-4`: coverage on, line threshold 0.8, `test/**` and `dist/**` ignored.
- CI (`.github/workflows/ci.yml:17-19`) uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true`. At that ref (identical to the clone): Bun `1.4.0` (`check.yml:24`), `bun install --frozen-lockfile` (`:26`), `bun run lint` (`:28`), `bun run typecheck` (`:30`), `bun run build` and `git diff --exit-code -- dist` (`:32-36`), `bun run test` (`:38`).

### Completion evidence

1. The regressions 1-4 fail on `6a06ec2` (run the new test files against the base sources); the PR lists the failing assertion of each.
2. `bun run check` passes; `git diff --exit-code -- dist` is clean after `bun run build`.
3. CI `check` is green on the PR.
4. kit `test_cpu_s`/`build_cpu_s` A/B numbers per the Performance section.
5. The PR body contains `Closes lorenzh/pulse-meta#<kit child>` and the text `pulse-meta#555`, so consumers can find the merge commit (decision 9).

## Repository: api

Files:
- `package.json`, `bun.lock`
- `src/start.ts`, `src/start.test.ts`
- `src/config-fs.ts`, `src/config-write.ts`, `src/config-admin.test.ts`
- `src/config.ts`, `src/tokens.ts`
- `src/location-silence.ts`, `src/retention.ts`
- `src/main.test.ts` (only if a shutdown assertion needs the new code; see below)
- `README.md`, `docs/operation.md`

Behavior change: yes
The forced shutdown now exits 1 and config writes go through the kit helper. If the code already behaves this way, request a hold instead of a review.

### Changes

- Pin: `"@lorenzh/pulse-kit": "github:lorenzh/pulse-kit#<kit SHA of decision 9>"` (`package.json:32`), `bun install` to update `bun.lock` (`bun.lock:9,81`).
- `src/start.ts:335-367`: decision 5. Add and export `ShutdownTimeoutError`. In `shutdown`, remember `outcome === "timeout"`; after `db.close(true)` and `logger.info("stopped")`, throw `new ShutdownTimeoutError(timeoutMs)`. The `closing ??=` memo stays, so a second `close()` returns the same rejected promise. `src/main.ts` stays as it is (`stop: async () => { await running?.close(); }` lets the rejection reach `runService`, which exits `1`).
- `src/config-fs.ts` and `src/config-write.ts`: `WriteFs` (`config-write.ts:36-45`) drops `writeTemp`, `rename`, `fsyncDir` and `remove`, and gains `atomic: AtomicWriteSyncFs` (kit type). `nodeConfigFs` sets `atomic: nodeAtomicWriteSyncFs` and drops `writeTemp`, `rename`, `fsyncDir`, `remove` and the now-unused imports. `store` (`config-write.ts:357-381`) calls `writeFileAtomicSync(path, data, { fs: fs.atomic, tempSuffix: deps.tempSuffix, beforeRename: () => { assertCurrent(ifMatch); return true; } })` inside the existing `try`; the `catch` maps with `mapFsError(err)` (it reads `code` through `codeOf`, `config-write.ts:77-80`, which works on `AtomicWriteError.code`; a `ConfigWriteError` from the stale check passes through unchanged, `:84`). `removeQuietly` (`:412-418`) is deleted. `adopt` still runs only after the helper returned `true` (directory synced). Mode and owner behavior are those of the deleted `writeTemp` (`config-fs.ts:31-51`), now in kit.
- `src/config.ts:31`, `src/config-write.ts:94`, `src/tokens.ts:58`: delete the local `isRecord`; import `isRecord` from `@lorenzh/pulse-kit`.
- `src/location-silence.ts:3,8`: delete `MAX_TIMER_MS`; `readMs(env, "PULSE_LOCATION_SILENT_MS", { fallback: 1, min: 1 })` (kit default max is the same `2147483647`; rule text unchanged: `must be an integer from 1 to 2147483647`).
- `src/retention.ts:10`: `readInt` instead of `readMs` (a day count). Message stays `PULSE_RETENTION_DAYS: must be an integer >= 90` (`src/main.test.ts:50`).
- `src/start.ts:81-86` (`PULSE_CHECKS_RELOAD_INTERVAL_MS`, explicit max 3 600 000): unchanged.
- `README.md:67` and `docs/operation.md:239`: a shutdown that hits the 5 s bound closes the remaining connections, finishes cleanup, closes the database and exits `1` (was "still exits with 0"); a clean stop exits `0`.

### Tests

1. `src/start.test.ts:239-263` (forced close): `await assert.rejects(closing, ShutdownTimeoutError)` (fails on `c00a375`, where `closing` resolves); the warn line and `assert.throws(() => db?.prepare("SELECT 1"))` (database closed before the rejection) stay; `api.close()` called again returns the same promise and rejects the same way.
2. A test that a drained close still resolves (existing close tests stay green unchanged).
3. `src/config-admin.test.ts:542-565`: the stage loop iterates over failures injected into `configFs.atomic` instead of `writeTemp`/`rename`/`fsyncDir`: temp-file `fsync` (`ENOSPC`), `rename` (`ENOSPC`), directory `fsync` (`ENOSPC`). Expectations stay: status `500`, file valid JSON, file unchanged for the first two, revision and check ids unchanged (nothing adopted), no `*.tmp` left, metric `result="error"` count 1. `:571-584` (EXDEV → `503` naming `(EXDEV)`, no temp) injects through `configFs.atomic.rename`. `:622-640` counts directory fsyncs by wrapping `nodeAtomicWriteSyncFs` (`open(dir, "r")` then `fsync`) and still expects `1`.
4. Mode: an existing checks file with mode `0o640` keeps `0o640` after an admin write (literal mode).
5. The stale-revision case between temp and rename (the `beforeRename` path) still answers the existing stale status and leaves the file unchanged.
6. `grep -n "function isRecord" src/*.ts` finds nothing.

### Checks (tool facts, cited)

- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`); lint `biome check . && pulse-eslint .` (`:16`); typecheck `typescript7` (`:14`); Biome `2.6.3` (`:23`); Bun `1.4.0` (`:9`, `:35`).
- `biome.json` extends `@lorenzh/pulse-config/biome.json`; pin `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`package.json:24`), identical to the config clone (`biome.json:10-17` include scope as above).
- `bunfig.toml:2-4`: coverage 0.8 lines.
- CI: `check` uses `check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`.github/workflows/ci.yml:18`; at that ref, identical to the clone: Bun `1.4.0` `:24`, install `:26`, lint `:28`, typecheck `:30`, test `:38`, build steps off). Also `bench-selftest` (`ci.yml:20-31`), `docker` (`:33-54`) and `compose-e2e` (`ci.yml:66-76`, `bash scripts/compose-e2e.sh`).

### Completion evidence

1. Tests 1 and 3-5 pass; test 1 fails on `c00a375`.
2. `bun run check` passes; CI `check`, `docker`, `bench-selftest` and `compose-e2e` green on the PR.
3. `package.json` and `bun.lock` name the kit SHA of decision 9 (written out in the PR body as a literal, with the kit PR number it came from).
4. Bench run 1 of Performance impact (`--a c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e --b <api PR head> --others-ref main`), api rows only, reported in the PR as B minus A per metric.
5. `bun start` with a temp checks file, then `kill -TERM`: exit code `0` (literal), reported in the PR.

## Repository: probe

Files:
- `package.json`, `bun.lock`
- `src/settings.ts`, `src/settings.test.ts`
- `src/reload-interval.ts`, `src/reload-interval.test.ts` (only if it imports the constant)
- `src/token.ts`, `src/token.test.ts`
- `src/check.ts`, `src/check-domain.ts`
- `docs/operation.md`

Behavior change: yes
The shutdown timeout exits 1 through the new kit, and token-file errors now carry `setting`. If the code already behaves this way, request a hold instead of a review.

### Changes

- Pin bump (`package.json:31`, `bun.lock:9,80`) to the kit SHA of decision 9.
- `src/settings.ts:20,65-75`: delete `MAX_TIMER_MS`. `PULSE_BUFFER_MAX_AGE_MS` stays `readMs` without `max` (same range, same rule text). `PULSE_BUFFER_MAX_RESULTS` (a count) uses `readInt` with `max: MAX_BUFFER_RESULTS` (a new local `const MAX_BUFFER_RESULTS = 2_147_483_647`, a count limit kept for compatibility) and the existing `describe` text `must be a positive integer up to 2147483647`.
- `src/reload-interval.ts:3`: `export const MAX_RELOAD_MS = MAX_TIMER_DELAY_MS` imported from `@lorenzh/pulse-kit`; parser and message unchanged.
- `src/scheduler.ts`, `src/reloader.ts`: unchanged (contract's `MAX_TIMER_MS` clamp of runtime delays stays).
- `src/token.ts:27-50`: `readTokenFile` becomes `readSecretFile(path, { setting: FILE_VAR, readFile })` followed by probe's own printable-ASCII check (`must hold printable ASCII`, now also with `{ setting: FILE_VAR }`). Delete `fsCode` and `FS_CODE`. `tokenSource` is unchanged.
- `src/check.ts:237`, `src/check-domain.ts:73`: delete local `isRecord`, import from `@lorenzh/pulse-kit`.
- `docs/operation.md:81`: when the 5 s bound is hit the probe logs a warning and exits `1` (was 0).

### Tests

1. `src/token.test.ts`: messages unchanged (`PULSE_PROBE_TOKEN_FILE=<path>: cannot read (ENOENT)`, `file is empty`, `must hold one line`, `must hold printable ASCII`); a read error whose message is `secret-sentinel` and a file holding `secret-sentinel\nx` never put `secret-sentinel` in the message; `err.setting === "PULSE_PROBE_TOKEN_FILE"` for file errors.
2. `src/settings.test.ts`: `PULSE_BUFFER_MAX_AGE_MS=2147483648` rejected, `2147483647` accepted; `PULSE_BUFFER_MAX_RESULTS=2147483648` rejected with `PULSE_BUFFER_MAX_RESULTS: must be a positive integer up to 2147483647`.
3. `grep -n "function isRecord\|2_147_483_647\|2 \*\* 31" src/*.ts` finds only `MAX_BUFFER_RESULTS`.

### Checks (tool facts, cited)

- `bun run check` (`package.json:19`), lint (`:16`), typecheck (`:14`), Biome `2.6.3` (`:22`), config pin `dc69a126…` (`:23`), Bun `1.4.0` (`:8`, `:10`). `bunfig.toml:2-4` coverage 0.8.
- CI `check` uses `check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`.github/workflows/ci.yml:18`; facts as in api); `docker` job (`ci.yml:19-38`).

### Completion evidence

`bun run check` passes; CI `check` and `docker` green; pin literal in the PR body; `bun start` with a token file and `kill -TERM` exits `0` (literal), reported; local `test_cpu_s` A/B against `50ec9ca` (Performance impact item 2) reported.

## Repository: status

Files:
- `package.json`, `bun.lock`
- `src/settings.ts`, `src/settings.test.ts`, `src/start.test.ts`, `src/main.startup.test.ts`
- `src/server.ts`, `src/server.contract-modules.test.ts`, `src/server.test.ts`, `src/server.cache.test.ts`
- `src/poller.ts`, `src/poller.test.ts`, `src/api-filter.ts`, `src/hidden-checks.ts`, `src/syndication.ts`
- `README.md`, `docs/configuration.md`, `docs/operation.md`, `docs/troubleshooting.md`

Behavior change: yes
Oversized timer settings are rejected and the shutdown timeout exits 1. If the code already behaves this way, request a hold instead of a review.

### Changes

- Pin bump (`package.json:35`, `bun.lock:11,91`).
- `src/server.ts:73`: next to `BROWSER_TIMEOUT_MARGIN_MS`, add `export const MAX_UPSTREAM_TIMEOUT_MS = MAX_TIMER_DELAY_MS - BROWSER_TIMEOUT_MARGIN_MS;` (`2147481647`; `MAX_TIMER_DELAY_MS` from `@lorenzh/pulse-kit`) with a one-line comment: the page waits this plus the margin, and that sum must fit a browser timer. `server.ts` does not import `settings.ts`, so `settings.ts` importing it adds no cycle.
- `src/server.ts:112-117,555-559`: `checkMs` gains an optional `max`; the upstream timeout passes `MAX_UPSTREAM_TIMEOUT_MS`, the cache age passes none. Message with `max`: `<name>: must be a number from <min> to <max>`; without `max` unchanged (`<name>: must be a number >= <min>`). The rendered `data-timeout-ms` (`:612`) stays `ctx.timeoutMs + BROWSER_TIMEOUT_MARGIN_MS`, never clamped.
- `src/settings.ts:62,69-73`: `POLL_MS` stays `readMs` (now bounded at `2147483647`). `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` stays `readMs` with `max: MAX_UPSTREAM_TIMEOUT_MS` (decision 3; rule `must be an integer from 1 to 2147481647`). `PULSE_STATUS_CACHE_MS` (an expiry timestamp offset, `src/server.ts:367`, not a timer) moves to `readInt`, range and message unchanged.
- `src/poller.ts:106` (browser module): delete local `isRecord`; `import { isRecord } from "@lorenzh/pulse-kit/is-record"`. The existing rewrite (`src/server.ts:701`) turns it into `/pulse-kit/is-record.js`.
- `src/server.ts:246`: `kitModules` becomes `new Set(["escape.js", "format-duration.js", "is-record.js"])`. Nothing else under `/pulse-kit/` is served.
- `src/api-filter.ts:49`, `src/hidden-checks.ts:14`, `src/syndication.ts:50` (server modules): delete local `isObject`; import `isRecord` from `@lorenzh/pulse-kit` and rename call sites. The local `Fields` alias may stay.
- `README.md:24`, `docs/configuration.md:9,20`: `POLL_MS` is an integer from 1000 to 2147483647, error `POLL_MS: must be an integer from 1000 to 2147483647`. `docs/operation.md:13`: after 5 s the process logs a `warn` line and exits `1`. `docs/configuration.md:17` and `docs/troubleshooting.md:11`: `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` is an integer from 1 to 2147481647, error `PULSE_STATUS_UPSTREAM_TIMEOUT_MS: must be an integer from 1 to 2147481647` (the page adds 2000 ms, and a browser timer holds at most 2147483647 ms).

### Tests

1. `settings.test.ts`: `POLL_MS=2592000000` throws `POLL_MS: must be an integer from 1000 to 2147483647` (on `2e3067d` it returns `2592000000`); `POLL_MS=2147483647` accepted; `POLL_MS=999` message updated to the same rule (`settings.test.ts:49`, `start.test.ts:77`, `main.startup.test.ts:63`). `PULSE_STATUS_UPSTREAM_TIMEOUT_MS=2147481647` accepted; `2147481648` and `2147483647` throw `PULSE_STATUS_UPSTREAM_TIMEOUT_MS: must be an integer from 1 to 2147481647` (on `2e3067d` both are accepted).
2. `PULSE_STATUS_CACHE_MS=3000000000` still accepted.
2a. Rendered browser timeout (`server.test.ts`, next to `:203-213`): `createStatusServer({ apiUrl: "http://127.0.0.1:1", pollMs: 2147483647, upstreamTimeoutMs: 2147481647 })` on port 0 serves `/` with `data-poll-ms="2147483647" data-timeout-ms="2147483647"` (literals). The existing `6000` and `3500` assertions stay. `server.cache.test.ts:155-160`: `make({ upstreamTimeoutMs: 2147481648 })` throws `/PULSE_STATUS_UPSTREAM_TIMEOUT_MS: must be a number from 1 to 2147481647/`; `make({ upstreamTimeoutMs: 0 })` still throws.
2b. Browser scheduler (`poller.test.ts`): `createPoller` with `timeoutMs: 2147483647` (the largest rendered value), `pollMs: 2147483647`, a fetch that never settles and a recording fake timer: once the first requests are in flight (after `start` and the test's usual microtask flush), every recorded `setTimeout` delay is `<= 2147483647`, and the recorded delays include `2147483647` (the fetch timeout). Then the server-side path: `startApiPoll` (`api-poll.ts:39`) with `timeoutMs: 2147481647`, `pollMs: 2147483647` and a recording `setTimeout` records no delay above `2147483647`.
3. `server.contract-modules.test.ts`: `GET /pulse-kit/is-record.js` from the real server on port 0 answers `200`, `content-type` `text/javascript; charset=utf-8`, and a body that contains `isRecord` and no `import` (`/\bimport\b/` does not match). `GET /pulse-kit/index.js`, `/pulse-kit/atomic-write.js`, `/pulse-kit/secret-file.js` and `/pulse-kit/settings.js` answer `404`. `GET /poller.js` contains `from "/pulse-kit/is-record.js"`.
4. Existing poller and browser tests (`poller.test.ts`, `poller.target-checks.test.ts`, `check:a11y` in CI) stay green.
5. `grep -n "function isObject\|function isRecord" src/*.ts` finds nothing.

### Checks (tool facts, cited)

- `bun run check` (`package.json:19`), lint (`:15`), typecheck runs `tsc --noEmit` twice, also `-p e2e` (`:13`), Biome `2.6.3` (`:23`), config pin `dc69a126…` (`:24`), Bun `1.4.0` (`:9`, `:38`). `bunfig.toml:2-4` coverage 0.8.
- CI `check` uses `check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`.github/workflows/ci.yml:18`); `docker` job (`:20-…`) and an a11y job with Bun `1.4.0` (`:58-60`), `bun install --frozen-lockfile` (`:62`), Playwright Chromium (`:64`), `bun run check:a11y` (`:66`).

### Completion evidence

`bun run check` passes; CI `check`, `docker` and a11y green; pin literal in the PR body; `bun start` with a fake API, load `/` in a browser or with `curl` for `/poller.js` and `/pulse-kit/is-record.js`, then `kill -TERM` exits `0` (literal), reported; local `test_cpu_s` A/B against `2e3067d` (Performance impact item 2) reported.

## Repository: notify

Files:
- `package.json`, `bun.lock`
- `src/config.ts`, `test/config.test.ts`
- `src/ledger.ts`, `test/ledger.test.ts`, `test/ledger.v2.test.ts`, `test/ledger.race.test.ts`
- `src/ledger-lock.ts`, `test/ledger-lock.test.ts`
- `src/index.ts` (only if the lock deps wiring needs the fs option)
- `README.md` (only if it quotes a changed rule), `docs/configuration.md`, `docs/operation.md`, `docs/install.md`

Behavior change: yes
Ledger and lock writes gain directory fsync, timer settings get a bound, and the shutdown timeout exits 1. If the code already behaves this way, request a hold instead of a review.

### Changes

- Pin bump (`package.json:31`, `bun.lock:9,83`).
- `src/config.ts`:
  - `readMin` (`:334-336`) is built on `readInt` (same "of at least" text); it keeps serving `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`, `PULSE_NOTIFY_STATE_RETENTION_DAYS`, `PULSE_NOTIFY_API_MAX_BYTES`.
  - `PULSE_NOTIFY_POLL_MS`, `PULSE_NOTIFY_TIMEOUT_MS` (`:367-368`): `readMs(env, name, { fallback: 5000, min: 1 })` (rule `must be an integer from 1 to 2147483647`).
  - `PULSE_NOTIFY_RETRY_DELAY_MS`, `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` (`:369-376`): stay `readMs`, now bounded.
  - `PULSE_NOTIFY_RETRY_ATTEMPTS` (`:390-393`): `readInt`, unchanged range and text.
  - `loadLockLeaseSeconds` (`:358-360`): `readInt(env, name, { fallback: 60, min: 30, max: MAX_LEASE_SECONDS })` with exported `MAX_LEASE_SECONDS = 12_884_901` and a one-line comment on how it is derived (decision 3).
  - `isObject` (`:34`): delete; import `isRecord` from `@lorenzh/pulse-kit`.
  - The channel secret reader (`:49-96`) is unchanged.
- `src/ledger.ts`:
  - `isObject` (`:43`): delete; import `isRecord`.
  - `LedgerOptions` (`:118-127`) gains `fs?: { sync?: AtomicWriteSyncFs; async?: AtomicWriteFs }` (default the kit node fs). The test hook `hooks.beforeRename` stays.
  - `#writeSync` (`:175-190`): `mkdirSync` stays; then `writeFileAtomicSync(this.#path, JSON.stringify(this.#data), { fs })`. `#commit` keeps undo-and-rethrow for every failure. For `stage: "sync-dir"` the claim is on disk but not confirmed durable: memory is undone, the caller logs `ledger claim failed` and does not send (`src/delivery.ts:117-126`), and the next poll claims and writes again. A crash in between leaves the key `pending`, which is resent at the next start (at-least-once, as documented).
  - `#writeSnapshot` (`:221-254`): `writeFileAtomic(this.#path, text, { fs, beforeRename: async () => { if (syncWrites !== this.#syncWrites || this.#isClosed) return false; await this.#beforeRename?.(); return true; } })`. On `false`: return (nothing published). On `true`: the existing post-rename recheck (`:241-246`). On `AtomicWriteError` with `stage === "sync-dir"`: the snapshot is published, so run the same post-rename recheck first (rewrite with `#writeSync` when a sync write slipped in and the ledger is not closed), then set `#isDirty = true` and rethrow. Any other error: `#isDirty = true`, rethrow (the kit already removed the temp file). Delete `discard` (`:504`) if unused.
- `src/ledger-lock.ts:105-113` (`heartbeat`): `writeFileAtomicSync(this.#path, JSON.stringify(this.#content), { fs })` with `fs` from a new optional `LockDeps.fs?: AtomicWriteSyncFs`. The ownership check before it is unchanged. Acquisition (`:162`) and takeover marker (`:224`) keep `writeFileSync(..., { flag: "wx" })`.
- Docs: `docs/operation.md:130` and `:66` (a stop over 5 s logs a `warn` line and exits `1`); `docs/install.md:14` (clean stop exits 0; a stop over the bound exits 1); `docs/configuration.md:18` (lease from 30 to 12884901), and the rows of `PULSE_NOTIFY_POLL_MS`, `PULSE_NOTIFY_TIMEOUT_MS`, retry delays (at most 2147483647).

### Tests

1. Durability regression (fails on `c090a07`, where the sync and batch writes never fsync the directory): with an injected recording `fs` wrapping the kit node fs, a `claim` records `fsync` of the temp fd, `rename`, then `open(dir, "r")` and `fsync` of that fd, in that order; same for a `flush()` batch and for `LedgerLock.heartbeat()`.
2. Replace the `mkdirSync(\`${path}.tmp\`)` failure injections (`ledger.test.ts:93-98`, `ledger.v2.test.ts:244-251`, `ledger.race.test.ts:91-94`) with an injected `fs` whose `open(…, "wx")` throws `{ code: "ENOSPC" }` while a flag is set. Their assertions (state unchanged after a failed sync write; the later write succeeds; the race case rejects `flushed` and the next `flush` stores the claim) stay.
3. Batch/claim race (`ledger.race.test.ts:32-100`) stays green; add a case where the directory fsync of the batch fails after a claim slipped in during the paused `beforeRename`: `flush()` rejects, and a fresh `new Ledger(file)` shows the claim (the recheck rewrote it).
4. Interruption before rename: ledger file holding a known state; the injected sync `fs` throws on the temp `fsync`; the file bytes equal the earlier bytes (literal JSON string written by the test) and no `*.tmp` is left.
5. Lock: heartbeat still throws `LockLostError` for a foreign token without writing; acquisition still fails when the lock exists (`wx`); takeover tests stay green.
6. Settings: `PULSE_NOTIFY_POLL_MS=2592000000` rejected with `PULSE_NOTIFY_POLL_MS: must be an integer from 1 to 2147483647`; `PULSE_NOTIFY_LOCK_LEASE_SECONDS=12884902` rejected, `12884901` accepted; `PULSE_NOTIFY_API_MAX_BYTES=3000000000` accepted.
7. `grep -n "function isObject\|function isRecord" src/*.ts src/channels/*.ts` finds nothing.

### Checks (tool facts, cited)

- `bun run check` (`package.json:17`), lint (`:14`), typecheck (`:12`), Biome `2.6.3` (`:21`), config pin `dc69a126…` (`:22`), Bun `1.4.0` (`:9`, `:35`). `bunfig.toml:2-4` coverage 0.8.
- CI `check` uses `check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`.github/workflows/ci.yml:18`); `docker` job (`:20-41`).

### Completion evidence

`bun run check` passes; CI `check` and `docker` green; pin literal in the PR body; `bun run start` with a temp config and state path, then `kill -TERM`: exit `0` (literal), the state file present and parseable, no `*.tmp` beside it, reported; local `test_cpu_s` A/B against `c090a07` (Performance impact item 2) reported.

## Repository: console

Files:
- `package.json`, `bun.lock`
- `src/admin-token.ts`, `src/admin-token.test.ts`
- `docs/configuration.md`

Behavior change: yes
The shutdown timeout exits 1 through the new kit, and the token-file read moves to kit with one message-order change. If the code already behaves this way, request a hold instead of a review.

### Changes

- Pin bump (`package.json:29`, `bun.lock:8,77`).
- `src/admin-token.ts:26-51`: `readTokenFile` becomes `readSecretFile(path, { setting: FILE_VAR, readFile })`, then the length check (`must hold at least 16 characters`) and `tokenProblem`, each with `fail(...)` as today. Delete `fsCode` and `FS_CODE`. A multi-line file shorter than 16 characters now reports `must hold one line` (counterexample "console order").
- `docs/configuration.md:67`: a stop over 5000 ms logs a warning and exits `1`; a clean stop exits `0`.

### Tests

1. Existing `admin-token.test.ts` cases stay green with unchanged messages (`:41-42`, `:123-131`).
2. New: a read error whose message is `secret-sentinel` and a file `secret-sentinel-0000\nx` never put `secret-sentinel` in the message; `err.setting === "PULSE_CONSOLE_ADMIN_TOKEN_FILE"`; `"short\nline"` → `must hold one line`.

### Checks (tool facts, cited)

- `bun run check` (`package.json:18`), lint (`:15`), typecheck (`:13`), Biome `2.6.3` (`:21`), config pin `dc69a126…` (`:22`), Bun `1.4.0` (`:9`, `:31`). `bunfig.toml:2-4` coverage 0.8.
- CI `check` uses `check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`.github/workflows/ci.yml:18`); `docker` job (`:20-111`).

### Completion evidence

`bun run check` passes; CI `check` and `docker` green; pin literal in the PR body; `src/main.startup.test.ts` still shows exit `0` on `SIGTERM` (`docs/development.md:41`).

## Acceptance evidence (feature)

1. The four requested regressions, each failing on the inspected base and passing after: 30-day timer setting rejected and no accepted setting reaches a timer above `2147483647` ms (kit test 1, status tests 1, 2a and 2b, notify test 6), timed-out shutdown exits `1` (kit test 2, api test 1), BigInt and circular logging does not throw (kit test 3), write interrupted before rename keeps the old bytes (kit test 4, notify test 4, api test 3).
2. All 11 copied guards gone (api 3, probe 2, status 4, notify 2) and both token readers on `readSecretFile` (greps in each section).
3. One pin: `grep -h '"@lorenzh/pulse-kit"' {api,probe,status,notify,console}/package.json` prints five identical lines whose SHA equals the literal kit merge commit recorded in the kit PR (decision 9); `bun install --frozen-lockfile` passes in each.
4. CI green in all six repositories, and the final `compose-e2e` rerun on api `main` after the last consumer merge (Rollout order step 3) is green, with every `docker stop` exiting `0`. Its run URL and the five service SHAs are commented on #555. An unavailable check is reported as unverified, not green.
5. Performance: the api bench run 1, the local `test_cpu_s`/`build_cpu_s` A/Bs (items 2 and 4) and the whole-stack bench run 3 of Performance impact are reported, with no gating `FAIL`; run 3 states whether its side A tags were the inspected bases (isolated) or not.
