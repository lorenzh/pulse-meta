# Spec: Retention for stored results (#108)

## Goal
pulse-api deletes raw `results` older than a configurable retention period (default 90 days), so the SQLite database stops growing without limit. Behavior inside the retention period does not change.

## Scope
- Only `pulse-api`. No contract change, no other target.
- Delete only rows of `results`. `incidents` and maintenance windows (config only, not in the database) stay.

## Non-goals
- No `VACUUM`, no `auto_vacuum` change, no schema change or migration.
- No change to ingest, the incident rules or the endpoints.

## Decisions (from the issue review)
- **Day-aligned cutoff.** `/uptime` reads `timestamp >= (today - 89) * DAY_MS` (UTC day boundary, `UPTIME_DAYS = 90`). Retention is counted in whole UTC days including today, so `cutoff = (floor(now / DAY_MS) - (retentionDays - 1)) * DAY_MS`. With 90 days the cutoff equals the first day `/uptime` reads, so the default of 90 is safe and `/uptime` is identical. Rows with `timestamp < cutoff` are eligible.
- **Minimum is `UPTIME_DAYS` (90).** `PULSE_RETENTION_DAYS` must be an integer >= 90. Unset or empty means 90. Anything else (non-numeric, decimal, <= 0, below 90) fails at startup with a message that names the variable and the minimum. Reuse the exported `UPTIME_DAYS`; do not duplicate the number.
- **Newest result per (check, location) is never deleted**, even when older than the cutoff. This keeps "latest result per location" and quorum unchanged for a silent location.
- **Future-dated results** (`timestamp > now`) are never deleted (they are never below the cutoff).

## Required behavior
- Cleanup deletes eligible rows in batches of a constant size (1000), each batch one short statement (`DELETE ... WHERE id IN (SELECT ... LIMIT ?)`). A run loops until a batch deletes fewer rows than the batch size. Between batches it awaits an injected `sleep(0)`-style yield so ingest and reads are served.
- Runs at startup and then every hour through an injected scheduler and clock. Runs never overlap. An error in a run is logged (no secrets) and the next run still happens.
- The cleanup returns the number of deleted rows; main logs it when > 0.

## Risks
- `node:sqlite` is synchronous: only short batches keep the loop responsive. Use an index-friendly query (`results_by_check` on `check_id, timestamp`); check with `EXPLAIN QUERY PLAN` that the eligibility subquery does not scan the whole table each batch, or add an index only if needed (an additive `CREATE INDEX IF NOT EXISTS` in `db.ts` is allowed then).
- File size does not shrink after deletes; freed pages are reused. Document it.

## Acceptance evidence
With the injected clock and a temp database (no real timers):
- Seed results for two locations of one check at day -100, -91, -89 and today, plus a resolved and an open incident. After a cleanup run: results older than the cutoff are gone (except the newest per location), newer ones remain, all incidents remain.
- `/uptime` for the 90 days deep-equals the output before; latest result per location and quorum state are unchanged; a further down result still opens and resolves incidents as before.
- A location silent for longer than the retention keeps its newest result.
- Small batch size: more than one batch is used and everything eligible is removed; `sleep` is called between batches.
- Scheduler: runs at startup and again after one hour, not before; no overlap; an error does not stop later runs.
- Config: unset gives 90; 89, 0, -1, `1.5`, `abc` throw a clear error.
- README documents the setting and disk use. `npm run check` passes.

## Repository: api

Files:
- New `src/retention.ts` (one responsibility: retention). Exports: `parseRetentionDays(raw: string | undefined): number` (pure, throws a named `Error` subclass on invalid input), `retentionCutoff(now: number, retentionDays: number): number` (pure), `cleanupResults(db, { now, retentionDays, batchSize?, sleep }): Promise<number>`, and `startRetention(deps): ...` that runs once immediately and then reschedules every hour via an injected `setTimeout`, with a no-overlap guard, error logging through an injected `log`, and a `stop()` for tests. SQL for deletion lives here (retention is the only caller); the AGENTS.md rule that queries stay in `service.ts` may be kept by exposing the delete from `service.ts` instead if the build prefers. Pick one and keep it consistent.
- `src/main.ts`: read `PULSE_RETENTION_DAYS` through `parseRetentionDays` before opening the database (fail fast, log and exit non-zero via the existing edge handling), wire real `Date.now`, `setTimeout`, `console`, and start retention after the checks are upserted. Use an unref'd timer so shutdown is not blocked.
- `src/retention.test.ts`: the acceptance tests above, with a fake clock, fake `sleep`/`setTimeout`, and a `mkdtemp` database. Include one test through `createApiServer` over HTTP on port 0 for `/uptime` before and after cleanup.
- `README.md`: add `PULSE_RETENTION_DAYS` (default 90, minimum 90, integer, day-aligned, newest result per location kept, incidents kept) to the settings; add a "Disk usage" section: rows per check per day = `86400 / interval_s x locations`; about 250 bytes per row including the index (measure with the real schema during the build and state the measured value as an estimate). Example: 60 s interval, 1 location, 90 days = 129,600 rows, roughly 30 MB per check. Note that the file does not shrink after deletes and that a manual `VACUUM` reclaims space.
- `AGENTS.md`: only if the build changes a convention (for example where SQL lives); otherwise untouched.

Behavior and checks: as in "Required behavior" and "Acceptance evidence". Run `npm run check`; start with `npm start` once (with a short `PULSE_RETENTION_DAYS=89` to see the startup error, then with the default) and report the commands and results.

Completion evidence: PR with `Closes lorenzh/pulse-meta#<child>`, green `npm run check`, the measured bytes per row, and the known limits (no vacuum).
