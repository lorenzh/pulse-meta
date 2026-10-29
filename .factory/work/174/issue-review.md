# Issue review: #174 API: late results still change state through later windows; README quick start

Verdict: specifiable. No blocking question. Only target `api` changes (code, tests, docs, README). `contract`, `probe`, `status`, `notify`, `config` need no change.

## Verified against `.repos/api` and `.repos/probe`
- `src/service.ts` `ingest`: `isLate` is computed from `newestStored` before the insert, the row is inserted, then `if (isLate) return`. The row carries no marker. `windowResults` (line ~131, `ORDER BY timestamp DESC, id DESC`) picks the first row per location in `[T - 2*interval, T]`. A late row at 150 is older than A's rows at 300/400, but those are outside B's window at T=200, so the late `up` is A's "latest". Error 1 is real.
- `latestPerLocation` (line ~133, used for `locations` in the checks list / status page) also reads all rows, late or not. It picks the newest per location by timestamp, so a late row is never newest there; unaffected unless it is the only row (cannot be: late means a newer one exists). Keep as is; the plan should confirm.
- `src/db.ts` `migrate` adds columns by checking `PRAGMA table_info`; a `late` column fits that pattern (`ALTER TABLE results ADD COLUMN late INTEGER NOT NULL DEFAULT 0`).
- `.repos/api/README.md` line 35: `cp .env.example .env` with no token step. `docs/install.md` line 37-38 already has the `sed ... openssl rand -hex 32` step to reuse.
- `docs/troubleshooting.md` line 73 says "I could not read the probe source ... check the probe's log". `.repos/probe/src/client.ts` lines 93-95: on any status other than 204 (and not the token-rejected case) it logs `dropping result for <checkId>: API answered HTTP <status>` and returns false; no retry for that result. (Lines 100-101: network errors are also logged as dropped.)
- The meta `README.md` line 50 has the same `cp .env.example .env` but its line 56 says the token is public and "Without a `.env` the API stops at start". This text is now also wrong (placeholder is rejected, not public). It is the meta repo, not a target: out of scope of the build; flag it for a person (see open points).

## Open points (none blocking)
1. Existing databases: rows stored before the migration have no late information. Default `late = 0` is simplest. Optional backfill: mark a row late if a row of the same check and location with a larger `(timestamp, id)` and a smaller `id` exists (inserted earlier, newer timestamp). Assumption: the plan may choose either; a backfill in the migration is more correct and cheap on the `results_by_location` index, but only runs once (when the column is added). Plan decides and documents.
2. Window query must filter `late = 0`. Also check other readers of `results` that feed live state: `latestPerLocation` (see above), uptime/retention code (`src/uptime.ts`-style calculations, `retention`). Plan must list which readers exclude late rows. Requirement says history reads (`GET /checks/:id/results`) still return them; they may expose a `late` field in JSON only if the contract allows it (assumption: no API shape change, not exposed).
3. Late rows and `inWindow` (the down-in-window shortcut): not reached for late rows (returns before). Unchanged.
4. Definition of late stays "strictly older than the newest stored row of same location and check at arrival". A row is never un-marked later. Equal timestamp is not late.
5. Reproduction timing: offsets 100/300/400 for A, interval must make B's window at 200 contain A's 150 but not 300/400 (window is `[T - 2*interval, T]`, so interval >= 50 and the late row at 150 is in it). The test needs a check with an interval that fits; plan picks values.
6. Meta `README.md` (not a target) has the same stale quick start text; fix by a person, not by Factory.
7. Docs: `docs/concepts.md` late-result paragraph (and the spec #163 assumption) must say a late row is excluded from every later window. Mention `late` column in `docs/development.md` if schema is described.

## Assumptions
- Only `api` changes; no change to bounds, tokens or headers (non-goal).
- Quorum, `WINDOW_INTERVALS`, and the `resolvedAt` clamp stay unchanged.
- README fix: add the token generation step (same `sed`/`openssl rand -hex 32` command as `docs/install.md`) between `cp .env.example .env` and `docker compose up`, and drop the claim that no `.env` is needed where wrong (demo profile still needs no `.env`).

## Derived acceptance check
- New regression test (service level): check with fitting interval; A `down` at 100, 300, 400 opens the incident; A late `up` at 150 is stored; B `down` at 200. The incident stays open and the state stays `down`. The test fails on current `main` of api (B's window picks A's `up`@150 and resolves).
- Another test: late rows are still returned by the results history; a database created without the `late` column is migrated on open (and old rows keep working).
- Existing late-result tests (`service.late.test.ts`, `service.quorum.test.ts`) still pass; `npm test`, lint and typecheck pass in api.
- README quick start: following it verbatim (copy, generate token, `docker compose up`) starts the API without the placeholder-token error; `compose-e2e` stays green.
- `docs/troubleshooting.md` states the probe drops the result on HTTP 400, logs `dropping result for <check>: API answered HTTP 400`, and does not retry; the "could not read the probe source" sentence is gone.
