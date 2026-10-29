# Issue review: #108 Retention for stored results

Verdict: specifiable. No blocking question. Only pulse-api changes.

## Findings in pulse-api (main)
- `db.ts`: table `results` (index `results_by_check (check_id, timestamp DESC, id DESC)`, `results_by_location (check_id, location, timestamp)`). No delete anywhere. `incidents` has no FK to results.
- `service.ts`: `UPTIME_DAYS = 90`; the `/uptime` query reads `timestamp >= firstDay * DAY_MS` where `firstDay = today - 89` (UTC day boundary). So it needs up to 90 days plus the elapsed part of today, i.e. up to just under 91 days of raw results.
- Incident rules (`state.ts`) run on the stored `checks.consecutive_down` / open incident, not on old results. Deleting results does not change them.
- Latest result per location comes from a `ROW_NUMBER()` query over `results`, and quorum uses it. A location that has been silent longer than the retention period would lose its latest result after cleanup.
- `createService` already takes an injectable `now`; `main.ts` is the only place that wires real I/O (env, timers). `README.md` lists env vars `PULSE_DB`, `PULSE_CHECKS_FILE` (plus `PORT`).
- AGENTS.md of api: logic pure, side effects injected (`now`, `setTimeout`), env validated at the edge in `main.ts`/`config.ts`.

## Open points and assumptions
1. **Minimum retention.** "Not below what 90-day uptime needs" is read as: the minimum is 91 days (90 whole UTC days plus the current day's partial window). Assumption: `PULSE_RETENTION_DAYS` must be an integer >= 91; default 90 in the issue is therefore contradictory with that minimum. Resolution assumed: default 91 (or compute the cutoff as the start of the UTC day 89 days back, which makes 90 sufficient). Spec must pick one; preferred: cutoff = start of UTC day `today - (retentionDays - 1)`... simplest and safe: minimum 91, default 91, and document it. Alternative: keep default 90 and align the cutoff to the UTC day start so that day 90 is kept whole. The spec should choose the day-aligned variant only if `/uptime` stays identical; the plan must verify.
2. **Invalid values**: non-integer, non-numeric, <= 0 or below the minimum fail at startup with a clear message naming the variable and the minimum. Empty/unset means default.
3. **Latest result per location.** To keep "latest per location" identical, cleanup must never delete the newest result of a (check, location), even when older than the cutoff. Assumption: exempt it (also keeps quorum behavior). Inside the retention period nothing changes either way.
4. **Batching.** Delete in batches (e.g. `DELETE ... WHERE id IN (SELECT id ... LIMIT n)`), batch size a constant (e.g. 1000). `node:sqlite` is synchronous, so "not blocking" means short batches that yield to the event loop between batches (injected `sleep`/`setImmediate`-like dependency, no real timers in tests). A cleanup run loops until a batch deletes fewer than the limit.
5. **Scheduling.** Run at startup, then every hour via an injected scheduler (`setTimeout`/`now`). Runs must not overlap; an error in a run is logged and the next run still happens. Clock in ms; cutoff = `now() - retentionDays * DAY_MS`.
6. **Module split.** New module (e.g. `retention.ts`) with the pure config validation and a `cleanup`/scheduler taking `db`, `now`, `sleep`, `log`; `main.ts` wires env and real timers.
7. **Disk space.** SQLite does not shrink the file on delete; freed pages are reused. README should say so (no `VACUUM` in scope; mention optional manual `VACUUM`). Optionally enable `PRAGMA auto_vacuum` is out of scope for an existing database.
8. **README disk estimate.** Rows per day = 86400 / interval x locations; give a per-check figure measured or computed (assume roughly 100-150 bytes per row plus index entries, ~250 bytes). Example: 60 s interval, 1 location, 91 days ~ 131k rows ~ 30-35 MB per check. The spec should state the formula and say it is an estimate; the build should measure it with the real schema.
9. **Maintenance windows** are config-only (not in DB); nothing to delete. Only `results` rows are deleted; `incidents` stay.
10. **Ingest during cleanup**: safe since batches are separate short statements; no change to ingest code.
11. **Future-dated results** (timestamp > now) are never deleted.

## Derived acceptance check
Test with the injected clock and a temp database (no real timers):
- Seed results at day -100, -91, -89 and today for two locations of one check, plus a resolved and an open incident.
- Run cleanup with default retention: results older than the cutoff are gone (except per point 3), newer results remain, all incidents remain.
- `/uptime` output for the 90 days is deep-equal before and after; latest result per location and quorum state unchanged; a further down result still opens/resolves incidents as before.
- Batching: with a small batch size more than one batch is used and the run still removes everything eligible.
- Scheduler: with a fake timer/clock, cleanup runs at startup and again after one hour, not before; no overlap; an error does not stop later runs.
- Config: `PULSE_RETENTION_DAYS` unset gives the default; values below the minimum, non-integers and garbage throw a clear startup error.
- README documents the setting, minimum, and disk usage per check and interval.
- `npm run check` passes in pulse-api.
