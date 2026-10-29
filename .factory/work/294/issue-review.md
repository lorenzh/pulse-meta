# Issue review: #294 API late results, maintenance quorum, shutdown race, scalable reads

Verdict: specifiable. No blocking question. Targets: `api` (all code and docs); `status` only checked, `contract` only if a schema needs the new parameters; `probe`/`status` are the reference for `/readyz`.

## Verified against the code
- `api/src/service.ts` writes `last_result_at` in several places (lines ~138, ~203, ~450); the late check is per location, as the issue says.
- `api/src/server.ts` serves `/healthz` and `/metrics` in one handler; `/healthz` answers 503 while shutting down. There is no `/readyz`.
- `Dockerfile` HEALTHCHECK and `scripts/compose-e2e.sh` (`api_healthz_ok`) use `/healthz`. Docs: `rest-api.md`, `operation.md` (line ~120 says "the database is open"), `install.md` (line 48).
- status reads the API through an exact allow-list (`status/src/api-filter.ts`): `/api/uptime`, `/api/checks`, `/api/maintenance`, `/api/incidents?status=open`, `/api/incidents?status=resolved`. `api-poll.ts` fetches `/checks`.
- probe and status: `/healthz` is liveness (stays 200 while shutting down), `/readyz` is readiness (503 while shutting down).

## Open points (decide in the plan, none blocks)
1. **Default `limit` on `/incidents` can truncate what status shows.** status requests `?status=open` and `?status=resolved` with no limit. A default limit silently drops incidents there. Plan must pick a default that keeps status correct (for example, large default, newest first, documented max) or check how status uses the result, and must not require a status change (non-goal "no change to headers/tokens" does not forbid it, but then status needs its own issue). Also define the sort order and the `since` field (`openedAt`? for resolved: `resolvedAt`?) and its format (ms epoch vs ISO, as the API uses elsewhere).
2. **`/healthz` semantics change.** Today it is 503 while shutting down; the issue says it "stays cheap" and probe/status keep it 200 during shutdown. Consistency with probe/status implies `/healthz` stays 200 and `/readyz` carries 503 on shutdown and on DB failure. Assumption: follow probe/status; update Dockerfile HEALTHCHECK (keep `/healthz`), compose-e2e, `start.test.ts`, docs. Mark it a documented change of meaning like probe did. The Compose healthcheck of other services that depend on api readiness must be checked.
3. **Cursor shape for `/checks/:id/results`.** `before` timestamp vs id. Timestamps can tie across locations; plan should choose one (assumption: `before` = timestamp in ms, exclusive, with a tie-safe order, or an opaque id) and define the default and max page size. Same for the `limit` already there, if any.
4. **Maintenance quorum edge.** Define whether the window end is inclusive/exclusive and whether the exclusion uses the result timestamp or the stored-at time; a result with a timestamp inside the window that arrives late (after the window) must count as in the window. Check how the state is rebuilt (stored `in_maintenance` flag vs. recomputation from config; a changed `checks.json` can move windows).
5. **Late result across locations.** "Never moves state backwards": decide whether an older result still gets stored (yes, assumed, for history and uptime) and whether it still counts in quorum evaluation at its own timestamp without writing `last_result_at`/state. Equal timestamps from two locations: not older, process normally.
6. **Shutdown.** The plan must name the exact sequence (stop timer, await running batch, close db) and how a batch still running past the 5 s bound is handled (operation.md says bounded wait). Process-level test must fail on old code (hourly run started after the first one; use a short interval test hook without changing the documented interval).
7. **Cache for `/checks` and `/uptime`.** Choose cheaper query vs. cache. Invalidate on ingest (any result, heartbeat ping, config reload, retention delete) or TTL of a few seconds; documentation must state the staleness. The plan has to include measured before/after numbers on a seeded database (100 checks, 90 days, 1-minute interval = about 13 million rows per location; note this is large for a test, so measure by a script, not in the unit suite).
8. **Migration.** The index on `incidents.check_id` goes into the existing migration mechanism in `src/db.ts`; tests use hand-written `CREATE TABLE` schemas in many test files, so the migration must be idempotent (`IF NOT EXISTS`) and those tests must keep working.
9. **Contract.** Check `contract/src/schema.ts` for response shapes: a cursor field in the results response (for example a `nextBefore`) would change the shape. Prefer cursor = last item's timestamp, with no body change, to stay clear of the contract. If a body change is needed, contract goes first and the plan must say so in `targets.json` dependsOn.
10. **`/maintenance?checkId=unknown` 404** changes behavior for existing callers. status calls `/maintenance` without a parameter, so it is unaffected; confirm and document.
11. `/readyz` and metrics/auth: `/readyz` needs no token like `/healthz`; the auth bypass list in `server.ts` must be updated; it must not leak the DB error text.
12. Issue number #166 item H4 is tracking only; no dependency on other issues found.

## Assumptions
- Only `api` is built; status/contract are verified, not changed.
- Existing 401/headers/bounds stay as they are.
- Every item needs its own test that fails on old code (as the issue says); the cache needs a test that an ingest invalidates it.

## Derived acceptance check
Against the API at `main` plus the change:
1. Two locations, result A at t=100 from loc1, then result B at t=50 from loc2: `last_result_at` stays 100 and the state is unchanged; quorum across the locations is as before.
2. Down results inside a maintenance window do not count toward quorum once the window has ended (tested at the exact edge, one result inside, one just after).
3. A process receiving SIGTERM while a second retention run is in progress finishes the batch, then closes the db; no "database is not open" log and no write after close.
4. `incidents.check_id` index exists after migration; `/incidents?limit=&since=` work with documented default/max; `/checks/:id/results?before=` pages without gaps or repeats; `/maintenance?checkId=unknown` answers 404.
5. `/checks` and `/uptime` return correct data right after an ingest; the plan has before/after timings for the 100-check, 90-day history.
6. `/healthz` is cheap; `/readyz` answers 200 after `SELECT 1`, 503 when the db fails or on shutdown; docs use `/readyz` for readiness.
7. Docs (`rest-api.md`, `concepts.md`, `operation.md`) updated; `compose-e2e` green; status's allow-listed requests still match and still return complete data.
