# Spec #186: removed checks stay inactive; the probe reloads checks

## Goal
A check removed from `checks.json` stops being active in the API, and the probe follows check changes without a restart. The probe also gets robust startup and a monotonic clock.

## Scope
- `api`: inactive checks. `probe`: reload, fetch timeout, validation, monotonic clock.
- `contract`, `status`, `notify`, `config` unchanged. The `GET /checks` shape does not change.

## Non-goals
- No hot reload of the checks file in the API (read at startup only).
- No contract runtime validators (wave 3).
- The meta README is updated by a person.

## Decisions
- **Inactive = column.** `checks.active INTEGER NOT NULL DEFAULT 1`, added by a migration in `db.ts` for existing DBs. At startup `upsertChecks` sets `active=1` for every check in the file and `active=0` for all other rows. Rows are never deleted (FKs, history). Re-adding sets `active=1` again; history is intact.
- **Open incident of a removed check is resolved** (the contract has no "closed" status): `resolved_at` = startup time, other fields unchanged, one log line per incident. Also reset the check state (`state`, `consecutive_down`) so re-adding does not resurrect a stale `down`. A "resolved" notification to `notify` is accepted and documented.
- **Known vs active.** Known = any row; active = `active=1`.
  | Endpoint | Behavior for an inactive check |
  |---|---|
  | `GET /checks` | left out |
  | `POST /results` (ingest) | 404 `unknown check "<id>"`, same as an unknown id; no state change, no incident |
  | results/history read (`server.ts` `hasCheck`) | still readable (known) |
  | `GET /incidents` | keeps its incidents, incl. the one resolved on removal |
  | `GET /uptime` | left out, like `/checks` |
  | `GET /maintenance` | unchanged (windows come from the file) |
- **Retention** (`deleteExpiredResults`) covers inactive checks as today; the keep-newest-per-check rule is unchanged.
- **Probe reload interval:** env `PULSE_CHECKS_RELOAD_MS`, default 60000, validated like the other probe env vars, lower bound 5000 (invalid or lower value is a startup error, as for the other vars).
- **Failed periodic reload:** keeps the running checks, is logged, and is retried after a retry delay (10 s, but not later than the next interval). Startup fetch retries with the same delay until it succeeds.
- **Probe validation (in the probe):** a check is valid if `id` is a non-empty string, `intervalMs` is a finite number > 0, and by type: HTTP has a non-empty string `url`; TLS has host/port/warnDays as validated today. Invalid ones are skipped with a log line naming the id (or "id missing").
- **Clocks:** monotonic (`performance.now()`) for scheduling, latency and the retry budget; wall clock (`Date.now()`) for the result `timestamp` and for TLS expiry (`validTo - now`).

## Required behavior
See the issue; the decisions above refine it. Acceptance evidence:
1. API with checks A and B and a down incident on B. Remove B, restart API: `/checks` lists only A, B's incident is resolved, `POST /results` for B gives 404, B's history is readable. Re-add B, restart: B active with history.
2. Probe without restart: stops B within one interval, starts added C, applies a changed `intervalMs` of A; a 404 triggers a reload at once.
3. A stalled `GET /checks` (headers or body) times out, is logged and retried; an invalid check is skipped with its id logged; a missing `intervalMs` does not loop.
4. A wall clock step back does not pause checks; `timestamp` is epoch ms.
5. `npm test` and lint pass in both repos, `compose-e2e` green, docs updated.

## Risks
- Migration on existing DBs: must default to active so nothing disappears before the first startup sync.
- Reload must not restart timers of unchanged checks (double runs) and must not post results of a removed check that is mid-run.
- Old/new mix: new probe with old API works (same shape); new API with old probe only yields 404s.

## Repository: api
Files: `src/db.ts` (migration, `active`), `src/service.ts` (`upsertChecks` ~227-268: set active flags, resolve open incidents of deactivated checks and reset state; `listChecks` ~322, uptime, ingest use active; add a known-check lookup for history), `src/server.ts` (~250 `hasCheck` stays known for history; ingest uses active), `src/main.ts` if wiring is needed, tests next to the code (`service.test.ts`, `server.test.ts`, `retention.test.ts`), `scripts/compose-e2e.sh`, docs `README.md`, `docs/operation.md`, `docs/install.md`, `docs/troubleshooting.md`.
Behavior: as in the Decisions table.
Tests (each fails on old code): removed check absent from `/checks` and `/uptime`; ingest of it gives 404 `unknown check` and creates no incident; open incident resolved at startup with `resolved_at` set; state reset; history and `/incidents` still readable; re-add restores active with history; migration of a DB without the column; retention still prunes inactive checks.
Docs: describe inactive checks and the incident resolution; the probe reloads on its own, so after a checks file change restart only the API (the file is still read at startup) and the probe follows within its reload interval; remove "restart the probe" advice.
compose-e2e: after the API restart, no probe restart; wait for the probe reload (short `PULSE_CHECKS_RELOAD_MS` in the compose env) and stays green. If the compose pulls a probe image without the feature, keep the probe restart until the probe is released.
Done when: `npm test`, lint and typecheck pass, `compose-e2e` is green, docs are updated.

## Repository: probe
Files: `src/client.ts` (`fetchChecks`: abort timeout covering headers and `res.json()` body, validation and skip with log, `postResult` signals unknown check on 404), `src/scheduler.ts` (add `sync(checks)`: start added, stop removed, restart changed by deep equality, keep unchanged timers; monotonic elapsed time; guard so a removed check never posts), `src/check.ts` (two clocks: `now` wall, `monotonic`; latency and retry budget monotonic; `timestamp` and TLS expiry wall), `src/main.ts` (monotonic = `performance.now`, periodic reload loop with `PULSE_CHECKS_RELOAD_MS`, debounced reload on 404, retry with delay, failed reload keeps current checks), tests (`client.test.ts`, `scheduler.test.ts`, `check.test.ts`, `tls.test.ts`), docs `README.md`, `docs/troubleshooting.md` and the config docs (new env var, default 60 s, restart no longer needed).
Tests (each fails on old code): stalled headers and stalled body time out and retry; invalid TLS check skipped, others run, id logged; missing or non-finite `intervalMs` skipped; reload adds, removes and changes checks, unchanged timers kept; a 404 triggers one debounced reload; failed periodic reload keeps checks; wall clock stepped back does not pause the scheduler (fake monotonic clock); `timestamp` stays epoch ms while latency uses the monotonic clock; env var validation.
Done when: `npm test`, lint and typecheck pass and docs are updated.
