# Spec #294: API late results across locations, maintenance quorum, shutdown race, scalable reads

Tracking: #166 item H4. Basis: `.factory/work/294/issue-review.md`.

## Goal
Close the remaining state edge cases of pulse-api and make its read paths scale with history, without breaking pulse-status.

## Scope
Only `api` changes (code, migration, tests, docs, Dockerfile, compose-e2e script). `status` and `contract` are only verified.

## Non-goals
- No contract change. Chosen shapes need none (see decisions). If the implementer finds one necessary, stop with `needs-input`; contract would then come first.
- No change to tokens, bounds, headers, or to what status requests.

## Decisions
1. **Late result across locations.** Compare the result timestamp with the check's newest stored result over all locations (`MAX(timestamp)` before insert, or `checks.last_result_at`). If strictly older: the result is still stored (history, uptime) and still counts in quorum at its own timestamp as today, but never writes `last_result_at`, never changes the check state, and never opens/closes an incident. Equal timestamps are not older and are processed normally. Quorum across locations is unchanged.
2. **Maintenance quorum.** Whether a result lies in a window is decided by the result's own timestamp against the windows, with the same edge rule as the existing maintenance code (`start <= t < end`; verify and keep it). Down results with a timestamp in a window are excluded from the quorum window afterwards too, also if they arrive after the window ended. Test at the edge: one down at `end - 1` (excluded), one at `end` (counts). Use the existing stored in-maintenance flag if there is one; if state is recomputed from config, document that config changes apply from the next evaluation.
3. **Shutdown.** Sequence: set shutting down, stop the retention timer (`clearTimeout`), stop heartbeat, drain the server, await the *currently running* retention batch (not only the first run; `done` must track the current run, e.g. `stop()` returns/awaits the in-flight run), then `db.close()`. A run must not start after `stop()` (also when the timer fires in the same tick). The existing 5 s bound stays: on timeout, retention is told to stop after the current batch (flag checked between batches in `cleanupResults`) and the close waits for that batch at most (a batch is synchronous, so it ends quickly). No write after close, no "database is not open" log.
4. **Index.** Migration in `src/db.ts`: `CREATE INDEX IF NOT EXISTS incidents_check_id ON incidents(check_id)` (idempotent; hand-written schemas in tests stay working; the migration must not fail when the index is absent from them).
5. **`/incidents`.** Add `limit` (default 1000, max 5000, positive integer, otherwise 400, like `/checks/:id/results`) and `since` (epoch ms, non-negative integer; returns incidents with `openedAt >= since` or still open... precisely: `openedAt >= since OR resolvedAt >= since OR resolvedAt IS NULL`, i.e. relevant at or after `since`). Order stays: open first, then newest opened first. The large default keeps status (`?status=open`, `?status=resolved`, no limit) complete in practice; document the cap so a person knows. Status must not need a change.
6. **`/checks/:id/results` cursor.** Add `before` (epoch ms, exclusive). The next page is requested with `before` = timestamp of the last item. Ties across locations are made safe by returning all rows that share the timestamp of the page's last row even when that exceeds `limit` (document: a page can exceed `limit` by tied rows, bounded by the number of locations). No body change. 400 for a non-integer `before`. Existing `limit` default 100 / max 1000 stays.
7. **`/maintenance?checkId=unknown`** answers 404 with the same error body as results. Without `checkId` it is unchanged (status unaffected). Documented as a behavior change.
8. **Cheaper reads.** `GET /checks` replaces the `ROW_NUMBER()` over all results with a per-check indexed lookup (latest result per check and location via `ORDER BY timestamp DESC LIMIT 1` on an index `(check_id, location, timestamp)`; add it via migration if missing) or the `last_result_at`/state already stored. `GET /uptime` and `/checks` additionally get an in-process cache with a TTL of 5 s that is cleared on every ingest (POST /results, heartbeat ping and expiry, config reload, retention delete). Documented: results are correct right after an ingest; the TTL only bounds changes made by the clock (e.g. window ends). Test: an ingest invalidates the cache; without the invalidation the test must fail.
9. **Probes.** `/healthz` stays liveness: cheap, 200 also while shutting down, no DB access (a change of meaning from the current 503 on shutdown, the same as probe and status; document it). New `/readyz`: no token, no DB error text in the body; 200 if `SELECT 1` works and not shutting down, 503 otherwise. Add `/readyz` to the auth bypass list and to the path/metrics label list in `server.ts`. Docker HEALTHCHECK, the compose healthchecks that gate other services on the API, `scripts/compose-e2e.sh` (`api_healthz_ok` becomes a `/readyz` readiness check; keep a liveness check) and `install.md`/`operation.md` use `/readyz` for readiness.

## Required behavior (summary)
As the issue, with the decisions above. Every change has a test that fails on the old code.

## Risks
- Default `limit` on `/incidents` truncating status: mitigated by the large default and a test that 1000 resolved incidents come back without parameters.
- `/healthz` meaning change: Dockerfile and compose files must switch to `/readyz` where readiness matters.
- Cache staleness: bounded by TTL and invalidation.
- The 13 million row measurement is too large for the unit suite: use a script.

## Acceptance evidence
1. Two-location test: loc1 at t=100, loc2 at t=50: `last_result_at` stays 100, state unchanged, quorum as before.
2. Maintenance edge test as in decision 2.
3. Process-level test (`start.test.ts`): short retention interval via a test hook (documented interval unchanged), SIGTERM/close during the second run; run finishes, then close; no write after close, no "database is not open" log.
4. Migration test: both indexes exist, also after a second migration run. Tests for `limit`/`since` (incl. 400s and max), results paging without gaps or repeats (with ties), `/maintenance` 404.
5. Cache test (ingest invalidates) and a benchmark script (`scripts/bench-reads.ts` or similar, not part of `npm test`) that seeds 100 checks, 90 days at a 1-minute interval and prints timings; the PR body states before (old `main`) and after numbers for `GET /checks` and `GET /uptime`.
6. `/readyz` tests: 200; 503 on shutdown; 503 when the DB throws (closed or stubbed), body without error text; `/healthz` 200 during shutdown.
7. Docs `rest-api.md`, `concepts.md`, `operation.md` (and `install.md`, `troubleshooting.md` if they name the probes) updated; `compose-e2e` green; the status allow-listed requests (`/uptime`, `/checks`, `/maintenance`, `/incidents?status=open|resolved`) still work and return the same shape (check `status/src/api-filter.ts`, `api-poll.ts`; no status change expected).

## Repository: api
Files: `src/service.ts` (late check, maintenance quorum, cheaper `/checks`, cache + invalidation, `listIncidents(opts)`, `listResults(id, limit, before)`), `src/server.ts` (`limit`, `since`, `before`, maintenance 404, `/readyz`, `/healthz` liveness, auth bypass, metrics labels), `src/db.ts` (migrations), `src/retention.ts` and `src/start.ts` (shutdown), tests next to each (`service.late.test.ts`, `service.maintenance.test.ts`, `start.test.ts`, `retention.test.ts`, `server.test.ts`, new files as needed), `Dockerfile`, `compose*.yaml`, `scripts/compose-e2e.sh`, benchmark script, docs listed above.
Checks: the repository's own checks (see its `AGENTS.md`), plus `compose-e2e`.
Completion evidence: all acceptance items 1 to 7 above, with the before/after timings in the PR description, and `Closes lorenzh/pulse-meta#<child>`.
