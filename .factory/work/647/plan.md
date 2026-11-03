# Spec #647: probe skip warnings stay bounded without re-flooding, and distinct ids stay distinct

## Goal

The probe logs a skipped check (invalid record, or unset/invalid header env) once per check ID and
logger, with bounded memory. Two defects found in the spot review of pulse-probe#52 (child #645 of
#557) break this:

1. When the set of remembered warning keys is full (10000), the next unseen key clears the whole
   set. An unchanged response with 10001 rejected IDs therefore logs 10001 lines on every reload
   (`[10001, 10001, 10001]` over three loads).
2. The key is the SHA-256 of the ID's UTF-8 bytes. Lone surrogates such as `"\ud800"` and
   `"\ud801"` both encode to the replacement bytes `EF BF BD`, so they get the same key and the
   second warning is suppressed.

This spec replaces the clear-at-limit behavior with saturation plus one overflow line, and hashes
the UTF-16 code units of the ID.

## Current behavior (probe `main` at `89f1232`)

- `src/client.ts:179-204`: `warnedSkips` is a `WeakMap<object, Set<string | null>>` keyed by the
  injected `log` function; `MAX_WARNED_SKIPS = 10_000` (`src/client.ts:183`). `skipKey`
  (`src/client.ts:185-187`) returns `null` for an unreadable ID, else
  `createHash("sha256").update(id).digest("hex")` (default UTF-8 encoding). In `skipLogger`
  (`src/client.ts:190-204`), an unseen key when `keys.size >= MAX_WARNED_SKIPS` runs
  `keys.clear()`, then adds the key and logs.
- Both skip paths use the logger: `logInvalid` (`src/client.ts:240-248`) and the header-env skip
  in `withResolvedHeaders` (`src/client.ts:270-273`). `loadChecks` creates one `logSkip` per call
  (`src/client.ts:327`); the state lives across calls in the `WeakMap`. Every record is validated
  with `validateCheck` on every load (`src/client.ts:329`).
- `src/main.ts:130` builds one `log` that startup and every later reload share, so "once per
  logger" means once per probe process in production.
- `src/client.test.ts:721-833` covers repeated loads, recovery, reason change, reorder, shared
  ID-less fallback, fresh logger, no secret in logs, and the long-ID memory regression. It has no
  test for more than 10000 IDs or for lone surrogates.
- The reset is described in `README.md:5`, `docs/configuration.md:39`,
  `docs/configuration.md:100` and `docs/troubleshooting.md:62`, each as "(up to 10000 remembered
  IDs, then the memory is reset)". `docs/operation.md:7-18` lists the probe's log lines.

## Decisions (from the issue review, `.factory/work/647/issue-review.md`)

- Eviction of the oldest key (FIFO) is not enough: with 10001 IDs in the same order, a
  10000-entry FIFO evicts the key that is needed next and still logs 10001 lines per reload. The
  probe uses **saturation**: it keeps the first 10000 keys, never clears or evicts them, and on the
  first unseen key beyond capacity logs one overflow line and from then on suppresses detailed
  lines for every untracked key, for the lifetime of that logger.
- The issue's expected `[10001, 0, 0]` counts all skip-related lines per load: 10000 detailed
  lines plus one overflow line on the first load, then zero.
- Trade-off, stated in the docs: once saturated, a check ID that was never seen before gets no
  detailed line until the probe restarts (a fresh logger). Its validation and recovery still work.

## Scope

- probe `src/client.ts`: skip-warning state and key derivation; export `skipLogger` so the
  capacity rules can be tested without paying contract validation for 10000 records per call.
- probe `src/client.test.ts`: regression tests.
- probe docs: `README.md`, `docs/configuration.md`, `docs/troubleshooting.md`,
  `docs/operation.md`.

## Non-goals

- No change to which checks are skipped, returned, or reported down; no change to validation,
  header resolution, host-binding denials, heartbeat handling, the HTTP client, fallback, or the
  version-header warning.
- No new env var, setting, dependency, contract type or route.
- No change of the limit (10000) and no unlimited per-ID memory.
- Nothing from #557 beyond the skip-warning section (scheduler, retry, buffer, cancellation stay).

## Required behavior

1. **Key derivation.** `skipKey(null)` stays `null`. A string ID maps to
   `createHash("sha256").update(id, "utf16le").digest("hex")`: the 64-character hex digest of the
   UTF-16 code units of the exact JavaScript string. No normalization, no surrogate repair, no raw
   ID kept as a key. `null` stays distinct from every string key (every string key is 64 hex
   characters; `null` is not a string), including the empty string `""`.
2. **State per logger.** The `WeakMap` keyed by the `log` function holds, per logger, the set of at
   most 10000 keys plus one boolean overflow flag (for example `{ keys: Set<string | null>,
   isSaturated: boolean }`). No second growing structure, no raw IDs, no payloads.
3. **Logging rule** for a skip with key `k` on logger `L`:
   - `k` in the set: log nothing.
   - `k` not in the set and the set holds fewer than 10000 keys: add `k`, log the detailed line
     (text unchanged).
   - `k` not in the set and the set holds 10000 keys: do not add `k`, do not log the detailed line.
     If the overflow flag is not set, set it and log the overflow line once.
   - The set is never cleared or evicted during the logger's lifetime. An empty, changed, or
     reordered response does not reset keys or the flag.
4. **Overflow line.** Exactly this text, written with the same `log` (level `warn` in
   production):
   `skipped checks exceed 10000 remembered IDs; new skip lines are suppressed until the probe restarts`
   It contains no ID, field, header name, env value, body or token. It is logged at most once per
   logger identity, over startup and all reloads.
5. **Unchanged.** Validation and header resolution run on every load, also after saturation; a
   corrected check is returned at the next load without a new line; `null` (records without a
   readable ID) is one shared key that counts toward the 10000; both skip paths share keys; a
   fresh logger starts with empty state.
6. `skipLogger` keeps its signature `(log) => (id: string | null, message: string) => void` and is
   exported with a doc comment that says it is exported for tests. Calling it twice with the same
   `log` returns loggers that share one state. Update the comment above `warnedSkips` so it states
   saturation and the overflow line instead of the clear.

## Performance impact

`bench/budgets.json` in the api repository has a `probe` section (`bench/budgets.json:121-157`
in the api clone): `startup_cpu_ms` 377, `load_cpu_s` 0.5, `idle_rss_mib` 79, `peak_rss_mib` 83,
`test_cpu_s` 2.3 (all gating), and the reported `startup_wall_ms` 1027 and `image_mb` 124. The
bench builds and runs the real probe (`bench/compose.bench.yaml:28-41`) and runs `bun run test` in
the probe worktree for `test_cpu_s` (`bench/run.ts:160-166`, CPU = user + system of the child,
`bench/measure.ts:68-70`). No api, status, notify, contract, kit or config metric can move: only
probe code changes.

- **`test_cpu_s` (gating, up).** This is the metric the change can move. The probe suite on
  `main` `89f1232` measured 1.67 s user + 0.49 s system = 2.16 s for `bun test` on the planning
  runner (one sample, `/usr/bin/time`), already close to the 2.3 s budget. The regression rule
  fails `B - A > max(A × 10 %, 0.2 s)` (api `bench/README.md`, "Reading a failure"), so the new
  tests must add well under 0.2 s. Measured costs on the same runner: one `loadChecks` of 10001
  records shaped like `skipBad` (`intervalMs: 0`) costs about 125 ms CPU, `{ id }` about 108 ms,
  and `{ id, type: "x" }` about 23 ms, because the contract validator rejects an unknown `type`
  early; one SHA-256 of 10001 short IDs costs about 7-9 ms with either encoding. Therefore the
  integration test uses `{ id, type: "x" }` records and exactly three large loads (about 70 ms),
  and the capacity rules are tested through the exported `skipLogger` (hashing only, about 10 ms
  per 10000 calls). Expected growth: about +0.1 s; ceiling for the task: +0.15 s.
- **`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib` (gating): none expected.**
  The bench probe receives the 20 valid bench checks (`bench/fixtures.ts:4-13`, no headers), so no
  record is skipped, `skipKey` never hashes and the set stays empty. The per-logger state gains one
  boolean.
- **`startup_wall_ms`, `image_mb` (reported): none expected.** No dependency, Dockerfile or
  startup step changes.
- **Hostile case (not benched).** Hashing with `"utf16le"` hashes 2 bytes per code unit instead of
  1-3 bytes per code point; the measured cost per 10001 IDs is the same within noise, and a key
  stays 64 characters. The memory bound stays 10000 keys plus one boolean per logger. Retained
  memory does not shrink: after 10001 distinct IDs today's code holds 1 key (it cleared at 10000),
  while saturation holds 10000 keys until restart, about 1 MiB more in that case. The peak is the
  same as today, which also holds 10000 keys just before each clear.

How the implementer measures: `bun bench/run.ts` cannot A/B two probe refs (`--others-ref` pins
both sides to one ref, api `bench/refs.ts:60-62`; the nightly compares the newest probe `v*` tag
with `main`). So on one machine, run `/usr/bin/time -f "%U %S" bun run test` three times on the
base commit and three times on the branch, and report each sample and the difference of the
medians of user + system. The task fails its own check if the difference is above 0.15 s.

## Security impact

Security impact: yes
The change touches log text that carries external data (check IDs from the API response) and the
memory bound against a hostile API that sends many or long IDs.

Checklist items that apply:
- **Secrets in errors, logs and responses:** detailed skip lines keep their current text (ID,
  contract error, header name, env variable name; never the env value). The overflow line carries
  no external data at all. The existing `skip-sentinel` assertion stays, and the overflow scenario
  checks it too.
- **Body and size limits:** the 5 MiB body cap is unchanged. The warning state stays bounded at
  10000 keys of 64 characters plus `null`, plus one boolean per logger; a hostile response cannot
  grow it beyond that or force repeated floods. The long-ID memory regression stays.
- **Input validation:** which records are skipped is unchanged; the hash input is the exact string,
  so a hostile ID cannot collide with another by lone-surrogate replacement.

Hostile inputs for the security state: 10001+ distinct IDs, 10000 IDs plus one, lone and paired
surrogates, `""`, very long IDs, ID-less records, alternating responses that try to reset the
state.

## Rollout order

One repository: only probe changes. No contract, kit, config or api pin moves, so no older
consumer is affected; probes on an older release keep the old warning behavior until updated.

## Counterexamples

- **FIFO eviction instead of saturation:** 10001 IDs `c00000..c10000` in the same order, three
  loads with one logger. FIFO evicts `c00000` when `c10000` arrives, then `c00000` evicts
  `c00001` on the next load, and so on: counts `[10001, 10001, 10001]`. Required:
  `[10001, 0, 0]` (10000 detailed + 1 overflow, then nothing).
- **Clear at limit (today):** same input gives `[10001, 10001, 10001]`. Must be rejected.
- **Overflow at exactly 10000:** 10000 distinct IDs must give 10000 detailed lines and no
  overflow line. An implementation that logs the overflow line when the set becomes full, or that
  checks the size before membership, is wrong.
- **Overflow per load or per episode:** after saturation, a later load with a new ID, or an empty
  response followed by a new ID, must log nothing. An implementation that resets the flag on an
  empty or changed list is wrong.
- **Known key at capacity:** a key already in the full set must stay quiet; an implementation that
  logs overflow for any key once full is wrong.
- **Adding over-capacity keys:** keys beyond capacity are not inserted; a later call with such a
  key stays quiet because the flag is set, not because the key was stored.
- **UTF-8 hashing:** `"\ud800"` and `"\ud801"` hash equal under UTF-8 (both become `EF BF BD`) and
  must give two detailed lines. Hashing with `"utf16le"` gives two different digests
  (`205022e3…ac750` and `4a986896…95696`, computed during planning with Bun `node:crypto`).
- **Sentinel collision:** a record with `id: ""` and a record without an ID must give two lines
  (`""` hashes to a 64-hex string; the ID-less key is `null`).
- **Secret in the overflow line:** a header env value `skip-sentinel` must not appear in any line,
  detailed or overflow.

No statistics are defined by this spec; the counts above are exact line counts, taken as the
growth of the captured log array across one `loadChecks` call or one batch of `skipLogger` calls.

## Contract fields

No new names in the contract or config. The change adds no field, key, route, env var or type.
The only new string is the overflow log line, which is probe-internal log text; `skipLogger` was
already a probe-internal name and only gains `export`. Searches:

- `grep -rn "suppress" .repos/contract/src .repos/config/src` → no match.
- `grep -rn "suppress" .repos/probe/src .repos/probe/docs .repos/probe/README.md` → no match, so
  the new line does not collide with an existing probe log message either.

## Repository: probe

Files:
- `src/client.ts`
- `src/client.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`
- `docs/operation.md`

Behavior change: yes
The probe stops re-logging all skip lines after 10000 IDs, adds one overflow line, and gives lone-surrogate IDs distinct keys.

### Behavior

Implement "Required behavior" 1-6 in `src/client.ts` (`skipKey`, `warnedSkips`, `skipLogger`,
`src/client.ts:179-204`). Keep `MAX_WARNED_SKIPS = 10_000`. Keep every function within the
SonarJS cognitive complexity of 15 (see "Tool facts"). Export `skipLogger` and nothing else new.

### Tests (`src/client.test.ts`, red first)

Write each test so it fails on the current code for the stated reason, then fix. Integration tests
call `loadChecks` with an injected `fetch` that answers with header `x-pulse-contract: 1` (so the
missing-version warning cannot add lines), `headerHosts: skipHosts`, and one stable `log` per
scenario. Large lists use records `{ id, type: "x" }`, which the validator rejects early (see
"Performance impact"); build the body once with `JSON.stringify` (about 270 KB for 10001
records, far below 5 MiB). The new tests make at most three `loadChecks` calls with 10000 or more
records in total.

1. **10001 over three reloads (integration).** IDs `c00000`..`c10000` (10001 distinct strings) as
   `{ id, type: "x" }`, followed by `skipOk` and `skipHdr`, with `env.PULSE_HEADER_SKIP` set to
   `SKIP_SENTINEL`. Three loads with one logger. Expected per-load line counts `[10001, 0, 0]`
   (literal); exactly one line equals the overflow text of "Required behavior" 4 (literal); no
   line appears twice; no line contains `skip-sentinel`; every load returns the IDs `["ok", "hdr"]`
   in list order (literal). Fails today with `[10001, 10001, 10001]`.
   Then, on the same saturated logger and with small lists: `[{ ...skipOk, id: "c00005" },
   { ...skipBad, id: "late" }]` returns `["c00005"]` and adds 0 lines; `[]` adds 0 lines; then
   `[{ ...skipBad, id: "late2" }, { ...skipBad, id: "c00005" }]` returns `[]` and adds 0 lines.
2. **Capacity boundary (unit, `skipLogger`).** Fresh `log` `L1`; one logger from
   `skipLogger(L1)`. Call it with IDs `k00000`..`k09999` (10000 distinct): 10000 lines, none is the
   overflow text. Call it again with the same 10000 IDs: 0 lines. Call it with `k10000`: exactly 1
   line, the overflow text. Call it with `k10001`, `k10002`, `null` and `k00000`: 0 lines. A second
   `skipLogger(L1)` with `k10003`: 0 lines (shared state). Fails today: `k10000` clears and logs
   its detailed message instead of the overflow text.
3. **Logger lifetime (unit).** Fresh `log` `L2`; `skipLogger(L2)` with `k00000`..`k10000`: 10001
   lines, of which the last is the overflow text. Then `skipLogger(L1)` (from test 2, or a logger
   saturated the same way in this test) with `k00001`: 0 lines.
4. **Lone surrogates (integration).** Fresh logger, records `{ ...skipBad, id: "\ud800" }` and
   `{ ...skipBad, id: "\ud801" }`: 2 lines (literal), the two lines differ, one contains
   `"\ud800"` and the other `"\ud801"`; a second load adds 0. Fails today with 1 line.
5. **Empty-string ID vs ID-less record (integration).** `{ ...skipBad, id: "" }` and `skipNoId`
   give 2 lines (literal).
6. Keep the existing tests at `src/client.test.ts:741-833` unchanged and passing (shared ID across
   both skip paths, reason change, reorder, ID-less fallback, recovery, fresh logger, no
   `skip-sentinel` in logs, long-ID memory bound).

Expected values come from literals in the tests (counts, ID lists, the overflow text), not from
the code under test.

### Docs

- `README.md:5`, `docs/configuration.md:39`, `docs/configuration.md:100`,
  `docs/troubleshooting.md:62`: replace "(up to 10000 remembered IDs, then the memory is reset)"
  with the saturation rule: the probe remembers up to 10000 skipped check IDs; past that it logs
  the overflow line once and no new skip lines until it restarts; remembered IDs stay quiet;
  validation and recovery still run on every load. Do not promise a line for every ID beyond 10000.
- `docs/troubleshooting.md`: add a section for the overflow line (cause: the API sends more than
  10000 distinct skipped IDs; action: fix the checks file and restart the probe to see the lines
  again).
- `docs/operation.md`: add the overflow line to the message table (`docs/operation.md:7-18`) at
  level `warn`.

### Tool facts (verified)

- Runtime and package manager Bun 1.4.0: `package.json:8` (`packageManager`), `package.json:10`
  (`engines`); CI installs Bun 1.4.0 in the shared check workflow
  (`lorenzh/pulse-config/.github/workflows/check.yml:22-24` at the pinned ref).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`); `test`
  is `bun test` (`package.json:15`); lint is `biome check . && pulse-eslint . && pulse-workflows`
  (`package.json:16`); typecheck is `tsc --noEmit` from `typescript7` 7.0.2 (`package.json:14`,
  `package.json:27`); Biome 2.6.3 (`package.json:22`). The config pin is
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:23`).
- Biome: `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At the pinned ref the config
  `biome.json:10-17` includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures`, and `biome.json:45-50` sets `noNonNullAssertion` and `noExplicitAny` to error
  (off for `noNonNullAssertion` in tests, `biome.json:53-63`). The pinned file does not differ
  from the config clone.
- ESLint and SonarJS: the probe's `eslint.config.js:1` imports
  `@lorenzh/pulse-config/eslint.config.js` and `eslint.config.js:4` spreads it after ignoring
  `.repos/**`; the pinned `bin/pulse-eslint.js:21-24` uses that local config when it exists. At
  the pinned ref, pulse-config `eslint.config.js:10-17` applies `sonarjs.configs.recommended` to
  `**/*.ts` and `**/*.js` with `"sonarjs/cognitive-complexity": ["error", 15]` (line 16). Both
  pinned files (`eslint.config.js`, `bin/pulse-eslint.js`) do not differ from the config clone.
  The probe `AGENTS.md:76` states the same limit.
- TypeScript strictness: the probe `tsconfig.json:2` extends
  `@lorenzh/pulse-config/tsconfig.base.json` with `include` `["src", "test"]` (line 3). At the
  pinned ref, `tsconfig.base.json:8-11` sets `strict`, `noUncheckedIndexedAccess`,
  `noImplicitReturns` and `exactOptionalPropertyTypes` to `true`. The pinned file does not differ
  from the config clone. Index access into the 10001-ID arrays in the tests is therefore
  `string | undefined`.
- Tests: `bunfig.toml:2-3` turns on coverage with an 80 % line threshold; `bunfig.toml:4` ignores
  test files for coverage.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  whose steps are install `--frozen-lockfile`, lint, typecheck, test (`check.yml:25-38` at that
  ref); the pinned file does not differ from the config clone.

### Completion evidence

- The new tests 1, 2 and 4 fail on the unchanged `src/client.ts` (test 1 reports
  `[10001, 10001, 10001]`, test 2 sees a detailed line instead of the overflow text, test 4 sees
  1 line) and pass after the fix.
- `bun run check` passes.
- Per AGENTS.md "End-to-end checks": start the probe with `bun run start` against a local fake API
  on `127.0.0.1` that serves 10001 invalid checks with `x-pulse-contract: 1`, with a short
  `PULSE_CHECKS_RELOAD_MS`; report that the first load wrote 10000 skip lines and one overflow line
  and that the next two reloads wrote none.
- `grep -rn "memory is reset" README.md docs` gives no match.
- The PR reports the six `/usr/bin/time -f "%U %S" bun run test` samples (three on the base
  commit, three on the branch, same machine) and the difference of the medians of user + system,
  which is at most 0.15 s.

## Acceptance evidence

- A probe test with 10001 rejected IDs over three reloads gives per-load line counts
  `[10001, 0, 0]` (literal), of which exactly one is the overflow line (literal text).
- A probe test with IDs `"\ud800"` and `"\ud801"` gives 2 detailed lines (literal).
- `bun run check` passes in probe CI.
- The measured `bun run test` CPU grows by at most 0.15 s (literal ceiling, measured against the
  base commit on the same machine).

## Risks

- Saturation hides first-time lines for new IDs after 10000 until restart; the docs state it and
  the overflow line tells the operator.
- The probe `test_cpu_s` is close to its 2.3 s budget already (2.16 s measured on `main` on the
  planning runner). The test design above keeps the growth near 0.1 s; a test that loads large
  `skipBad`-shaped lists through `loadChecks` several times would add about 0.125 s per load and
  can fail the nightly bench.
- `"utf16le"` changes every key, but keys exist only in memory per process, so nothing persisted
  breaks.
