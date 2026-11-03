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

- `src/client.ts:182-207`: `warnedSkips` is a `WeakMap<object, Set<string | null>>` keyed by the
  injected `log` function; `MAX_WARNED_SKIPS = 10_000`. `skipKey` returns `null` for an unreadable
  ID, else `createHash("sha256").update(id).digest("hex")` (default UTF-8 encoding). In
  `skipLogger`, an unseen key when `keys.size >= MAX_WARNED_SKIPS` runs `keys.clear()`, then adds
  the key and logs.
- Both skip paths use the logger: `logInvalid` (`src/client.ts:240-248`) and the header-env skip
  in `withResolvedHeaders` (`src/client.ts:269-275`). `loadChecks` creates one `logSkip` per call
  (`src/client.ts:327`); the state lives across calls in the `WeakMap`.
- `src/main.ts:130` builds one `log` that startup and every later reload share, so "once per
  logger" means once per probe process in production.
- `src/client.test.ts:741-833` covers repeated loads, recovery, reason change, reorder, shared
  ID-less fallback, fresh logger, no secret in logs, and the long-ID memory regression. It has no
  test for more than 10000 IDs or for lone surrogates.
- The reset is described in `README.md:5`, `docs/configuration.md:39`,
  `docs/configuration.md:100` and `docs/troubleshooting.md:62`, each as "(up to 10000 remembered
  IDs, then the memory is reset)". `docs/operation.md:7-18` lists the probe's warn lines.

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

- probe `src/client.ts`: skip-warning state and key derivation.
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
6. Update the comment above `warnedSkips` so it states saturation and the overflow line instead of
   the clear.

## Performance impact

The change is in the probe only. `bench/budgets.json` in the api repository measures the api
service (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`,
`startup_wall_ms`, the `p95_*` latencies, requests per second, image size); none of them runs probe
code. None expected: the api is not changed and its bench does not run the probe.

Inside the probe, hashing with `"utf16le"` hashes 2 bytes per code unit instead of 1-3 bytes per
code point: about twice the bytes for ASCII IDs, still one SHA-256 per skipped record per load, and
the retained key stays 64 characters. Retained memory gets smaller for large rejected lists,
because the set is no longer refilled after a clear. The new 10001-ID tests add probe test CPU in
the order of 100 ms (3 loads of an ~180 KB body); the implementer reports the time of
`bun test src/client.test.ts` before and after.

## Security impact

Security impact: yes
The change touches log text that carries external data (check IDs from the API response) and the
memory bound against a hostile API that sends many or long IDs.

Checklist items that apply:
- **Secrets in errors, logs and responses:** detailed skip lines keep their current text (ID,
  contract error, header name, env variable name; never the env value). The overflow line carries
  no external data at all. The existing `skip-sentinel` assertion stays, and the overflow line is
  checked too.
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
- **Overflow at exactly 10000:** 10000 distinct rejected IDs must give 10000 detailed lines and no
  overflow line. An implementation that compares with `>=` before checking membership, or that logs
  overflow when the set becomes full, is wrong.
- **Overflow per load or per episode:** after saturation, a second load with one more new ID, or an
  empty response followed by the oversized one again, must log nothing. An implementation that
  resets the flag on an empty or changed list is wrong.
- **Known key at capacity:** a key already in the full set must stay quiet; an implementation that
  logs overflow for any key once full is wrong.
- **Adding over-capacity keys:** keys beyond capacity are not inserted; the set size stays 10000.
- **UTF-8 hashing:** `"\ud800"` and `"\ud801"` hash equal under UTF-8 (both become `EF BF BD`) and
  must give two detailed lines. Hashing with `"utf16le"` gives two different 64-hex digests
  (verified in the issue review with Node `crypto`).
- **Sentinel collision:** a record with `id: ""` and a record without an ID must give two lines
  (`""` hashes to a 64-hex string; the ID-less key is `null`).
- **Secret in the overflow line:** a header env value `skip-sentinel` must not appear in any line,
  detailed or overflow.

No statistics are defined by this spec; the counts above are exact line counts per `loadChecks`
call, taken as the growth of the captured log array across that call.

## Contract fields

No new names in the contract or config. The change adds no field, key, route, env var or type.
The only new string is the overflow log line, which is probe-internal log text. Searches:

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
around lines 182-207). Keep `MAX_WARNED_SKIPS = 10_000`. Keep the function within the SonarJS
cognitive complexity of 15 (AGENTS.md "Tests (TDD)"). Do not export anything new for the tests;
test through `loadChecks`.

### Tests (`src/client.test.ts`, red first)

Write each test so it fails on the current code for the stated reason, then fix. All tests use
`loadChecks` with an injected `fetch` that answers with header `x-pulse-contract: 1` (so the
missing-version warning cannot add lines) and one stable `log` per scenario. Build bodies with
`JSON.stringify` and `new Response(body, ...)`; small records such as `{ id }` or
`{ ...skipBad, id }` are invalid and keep the body far below 5 MiB (10001 such records are about
180 KB).

1. **10001 over three reloads.** IDs `c00000`..`c10000` (10001 distinct strings), invalid, plus one
   valid control check. Three loads with one logger. Expected per-load line counts `[10001, 0, 0]`
   (literal); exactly one line equals the overflow text from "Required behavior" 4 (literal); no
   detailed line appears twice; every load returns only the control check. Fails today with
   `[10001, 10001, 10001]`.
2. **Capacity boundary.** 10000 distinct invalid IDs: 10000 lines, none is the overflow line; a
   second load adds 0. Then one new invalid ID: exactly 1 line, the overflow text. Then two more new
   IDs and a repeat of the full list: 0 lines. Then an empty list followed by the full list: 0
   lines.
3. **Recovery after saturation.** After test 2's saturation, correct one previously rejected record
   (make it valid): it is returned on the next load with 0 new lines; make it invalid again: 0 new
   lines, and it is absent from the result.
4. **Logger lifetime.** A fresh logger on the oversized list gives its own 10000 detailed lines and
   1 overflow line; a further load on the original saturated logger adds 0.
5. **Lone surrogates.** In a fresh logger, records `{ ...skipBad, id: "\ud800" }` and
   `{ ...skipBad, id: "\ud801" }`: 2 detailed lines (literal), and the two lines differ; a second
   load adds 0. Assert the parsed IDs reach the logger as lone surrogates (for example the lines
   contain `"\ud800"` and `"\ud801"`). Fails today with 1 line.
6. **Empty-string ID vs ID-less record.** `{ ...skipBad, id: "" }` and `skipNoId` give 2 lines.
7. Keep the existing tests at `src/client.test.ts:741-833` unchanged and passing (shared ID across
   both skip paths, reason change, reorder, ID-less fallback, recovery, fresh logger, no
   `skip-sentinel` in logs, long-ID memory bound). Extend the sentinel assertion to the overflow
   scenario: run test 1 or 2 with a header-env record whose value is `skip-sentinel` and assert no
   line contains it.

Expected values come from literals in the tests (counts, the overflow text), not from the code
under test.

### Docs

- `README.md:5`, `docs/configuration.md:39`, `docs/configuration.md:100`,
  `docs/troubleshooting.md:62`: replace "(up to 10000 remembered IDs, then the memory is reset)"
  with the saturation rule: the probe remembers up to 10000 skipped check IDs; past that it logs
  the overflow line once and no new skip lines until it restarts; remembered IDs stay quiet;
  validation and recovery still run on every load. Do not promise a line for every ID beyond 10000.
- `docs/troubleshooting.md`: add a section for the overflow line (cause: the API sends more than
  10000 distinct skipped IDs; action: fix the checks file and restart the probe to see the lines
  again).
- `docs/operation.md`: add the overflow line to the message table at level `warn`.

### Tool facts (verified)

- Runtime and package manager Bun 1.4.0: `package.json:8` (`packageManager`), `package.json:10`
  (`engines`); CI installs Bun 1.4.0 in the shared check workflow
  (`lorenzh/pulse-config/.github/workflows/check.yml:22-24` at the pinned ref).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`); lint
  is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`); typecheck is
  `tsc --noEmit` from `typescript7` 7.0.2 (`package.json:14`, `package.json:27`); Biome 2.6.3
  (`package.json:22`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`; the pin is
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:23`). At that ref the config
  `biome.json:10-17` includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures`, and `biome.json:45-50` sets `noNonNullAssertion` and `noExplicitAny` to error
  (off for `noNonNullAssertion` in tests, `biome.json:53-63`). The pinned file does not differ
  from the config clone (`bc87049`).
- Tests: `bunfig.toml:2-3` turns on coverage with an 80 % line threshold.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  whose steps are install `--frozen-lockfile`, lint, typecheck, test (`check.yml:25-38` at that
  ref); the pinned file does not differ from the config clone.

### Completion evidence

- The new tests 1 and 5 fail on the unchanged `src/client.ts` (report counts `[10001, 10001,
  10001]` and 1 line) and pass after the fix.
- `bun run check` passes.
- Per AGENTS.md "End-to-end checks": start the probe with `bun run start` against a local fake API
  on `127.0.0.1` that serves 10001 invalid checks with `x-pulse-contract: 1`, with a short
  `PULSE_CHECKS_RELOAD_MS`; report that the first load wrote 10000 skip lines and one overflow line
  and that the next two reloads wrote none.
- `grep -rn "memory is reset" README.md docs` gives no match.
- The PR reports the `bun test src/client.test.ts` time before and after.

## Acceptance evidence

- A probe test with 10001 rejected IDs over three reloads gives per-load line counts
  `[10001, 0, 0]` (literal), of which exactly one is the overflow line (literal text).
- A probe test with IDs `"\ud800"` and `"\ud801"` gives 2 detailed lines (literal).
- `bun run check` passes in probe CI.

## Risks

- Saturation hides first-time lines for new IDs after 10000 until restart; the docs state it and
  the overflow line tells the operator.
- Test time grows by a few 10001-record loads; kept small with minimal records.
- `"utf16le"` changes every key, but keys exist only in memory per process, so nothing persisted
  breaks.
