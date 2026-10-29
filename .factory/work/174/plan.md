# Spec #174: API late results still change state through later windows; README quick start

## Goal
Fix the two P2 errors and the docs gap found in review of lorenzh/pulse-api#28 (spec `.factory/work/163/plan.md`).

## Scope
Only `api` changes (code, tests, docs, README). `contract`, `probe`, `status`, `notify`, `config` need no change.

## Non-goals
- No change to bounds, tokens or headers from #163. No change to quorum, `WINDOW_INTERVALS` or the `resolvedAt` clamp.
- No API shape change: the `late` marker is internal and not exposed in JSON.
- The meta `README.md` (line ~50, same stale `cp .env.example .env` text and "token is public" claim) is not a target; a person fixes it, Factory does not.

## Required behavior
1. A result is late if its timestamp is strictly older than the newest stored result of the same location and check at arrival (equal timestamp is not late). The row is stored with `late = 1` and never un-marked.
2. A late row never takes part in a live state evaluation: the quorum window query (`windowResults`) filters `late = 0`. `ingest` keeps returning early for late rows.
3. History reads (`GET /checks/:id/results`, the `SELECT * ... LIMIT ?` at ~line 416) still return late rows.
4. Other readers of `results`, decided here:
   - `latestPerLocation` (check list `locations`): unchanged. A late row is never the newest of its location, so it cannot appear.
   - `dailyUptime`: unchanged (history statistic, not live state). Document it.
   - `deleteExpired` (retention): unchanged.
   - `newestStored`: unchanged (MAX over all rows, late included, is correct).
5. Migration in `src/db.ts` `migrate`, following the `PRAGMA table_info` pattern: `ALTER TABLE results ADD COLUMN late INTEGER NOT NULL DEFAULT 0`. When the column is added, backfill once: set `late = 1` for rows for which a row of the same check and location exists with a smaller `id` and a larger `timestamp` (inserted earlier, newer timestamp). Use the `results_by_location` index. Fresh databases get the column in the `CREATE TABLE`.

## Risks
- The window query is the single live-state reader; a missed reader would reopen the bug. The reader list above is the check.
- Backfill on a large table runs once at the first start after upgrade; keep it a single set-based UPDATE.

## Acceptance evidence
- Regression test (service level, `src/service.late.test.ts`): a check with an interval where B's window at 200 contains A's row at 150 (interval >= 50; the plan picks e.g. 100). A `down` at 100, 300, 400 opens the incident; A late `up` at 150 is stored; B `down` at 200. The incident stays open and state stays `down`. The test fails on current `main`.
- Test: the late row is still returned by the results history.
- Test: a database created without the `late` column is migrated on open, old rows keep working, and the backfill marks an earlier-inserted older-timestamp row late.
- Existing tests (`service.late.test.ts`, `service.quorum.test.ts`, etc.) pass; `npm test`, lint, typecheck pass.
- README quick start followed verbatim starts the API without the placeholder-token error; `compose-e2e` stays green.
- `docs/troubleshooting.md` states the probe drops the result on HTTP 400, logs `dropping result for <check>: API answered HTTP 400`, does not retry; the "could not read the probe source" sentence is gone.

## Repository: api

Files:
- `src/db.ts`: `late` column in `CREATE TABLE`, migration and backfill as above.
- `src/service.ts`: `insertResult` writes `late` (computed from `newestStored` before the insert; pass it as a bound parameter instead of a post-insert flag); `windowResults` adds `AND late = 0`. Add a comment that late rows are excluded from live evaluation.
- `src/service.late.test.ts` (and a db migration test where migrations are tested): tests listed above.
- `README.md` (~line 35): after `cp .env.example .env` add the token generation step, the same `sed ... openssl rand -hex 32` command as `docs/install.md` lines 37-38, before `docker compose up`. Keep the demo profile described as needing no `.env`. Remove any claim that the example token works.
- `docs/concepts.md`: the late-result paragraph says a late row is stored, is returned in history, and is excluded from every later window and from state. `docs/development.md`: mention the `late` column if the schema is described there.
- `docs/troubleshooting.md` (~line 73): replace the unknown-retry sentence with the probe behavior on HTTP 400 (drop, log, no retry). Network errors are also logged as dropped.

Checks: `npm test`, lint, typecheck.
Completion evidence: PR in `lorenzh/pulse-api` with the regression test failing on old code and passing on the new, and the doc changes above.
