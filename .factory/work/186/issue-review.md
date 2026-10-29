# Issue review #186: removed checks stay active; probe never reloads checks

Verdict: specifiable. No blocking question. Findings verified against `.repos/api` and `.repos/probe` on main.

## Verified findings
- api `upsertChecks` (service.ts ~234) only upserts and clears keywords. `listChecks`, `getUptime` and ingest read all rows of `checks`; nothing marks a row inactive. Confirmed.
- probe `main.ts` calls `fetchChecks` once, then `startScheduler(checks)`. The scheduler has no add/remove/update. Confirmed.
- probe `fetchChecks`: `deps.fetch` has no signal/timeout (postResult has 10 s). Confirmed. The body (`res.json()`) is also outside any timeout.
- probe `fetchChecks`: an invalid TLS check throws inside `map`, so the whole list fails and retries forever. Confirmed. HTTP checks are not validated at all (`url`, `intervalMs`).
- probe: `intervalMs` undefined gives `Math.max(0, NaN)` = NaN, so `setTimeout(NaN)` fires after 1 ms. Confirmed.
- probe: `main.ts` `now = Date.now`, scheduler uses `deps.now()` for elapsed time, `check.ts` uses `deps.now()` for latency, retry budget and `timestamp`. Confirmed.
- Docs in api (`operation.md`, `install.md`, `troubleshooting.md`) say "probe reads checks once, restart API then probe". Probe `troubleshooting.md` says the same. `scripts/compose-e2e.sh` restarts api then probe (~l.197).

## Open points (to settle in the plan)
1. **Inactive representation (api).** Needs a column (for example `active`) or deletion of rows is not allowed (history stays; `results`/`incidents` have FKs to `checks`). Plan picks column + migration in `db.ts`. At startup: set `active=1` for file checks, `active=0` for the rest. Re-adding keeps history.
2. **Incident on removal: resolve or close.** Contract has only `resolvedAt`; there is no "closed" status. Recommended: set `resolved_at` = startup time, reason unchanged, and log it. Plan must document this. State (`state`, `consecutive_down`) of the check should be reset or ignored so re-adding does not resurrect a stale `down`.
3. **"Readable where it is today".** `server.ts:250` uses `hasCheck` for the results/history endpoint. Plan must split "known" (any row, history reads) from "active" (ingest, `GET /checks`). Ingest of an inactive check must give the same 404 `unknown check "<id>"` as an unknown one. Decide the surfaces for inactive checks: `GET /incidents` (keeps resolved ones: yes, history), `GET /uptime` (recommended: leave out, like `/checks`, since the status page lists checks from `/checks`), `GET /maintenance` (windows are from the file; a window for a removed check is irrelevant). Plan must list each endpoint explicitly and test it.
4. **Retention** (`deleteExpiredResults`) must still cover inactive checks' results; the keep-newest-per-check rule is unchanged. Confirm in the plan.
5. **Probe reload design.** Needs: env var for interval (for example `PULSE_CHECKS_RELOAD_MS`; name and default, say 60 s, are plan decisions, with validation like the other probe env vars); a scheduler API to `sync(checks)` (add, remove, replace when settings change, keep timer of unchanged checks so reload does not restart or double-run them); a trigger on 404 from `postResult` (currently returns boolean and only logs; needs to signal "unknown check", with debounce so many 404s cause one reload). A removed check that is mid-run must not post a result after removal (scheduler `stop` already guards; do the same per check).
6. **Failed periodic reload** keeps the current checks running (do not stop everything) and retries with delay; the startup fetch retries until success as today. "Retried with a delay and logged" is covered by the existing loop plus the timeout. Plan states whether a periodic failure waits for the next interval or retries sooner.
7. **Validation rules** for "invalid check": define per type (HTTP: non-empty string `id`, `url`; TLS: host/port/warnDays as today; both: finite positive `intervalMs`). The log line must name the id (or say id missing/unusable). Contract is not changed (wave 3 adds runtime validators), so the checks live in the probe.
8. **Monotonic clock.** Use `performance.now()` for scheduler elapsed time and for latency/retry budget in `check.ts`. `timestamp` stays `Date.now()`. TLS expiry (`validTo - now`) must stay wall clock, since it compares to a certificate date. So `check.ts` needs two clocks (`now` wall, `monotonic`), and the retry-budget test `now + retryDelay >= start + interval` moves to monotonic. Scheduler tests should use a fake monotonic clock; the test for a wall clock step back must fail on old code.
9. **Test per fix** (issue requirement), api: removal makes a check absent in `/checks`, ingest 404, no incident possible, open incident resolved, re-add restores history; probe: timeout covers a stalled body, TLS invalid skipped, missing interval skipped, reload adds/removes/changes, 404 triggers reload, wall clock step back does not pause. Each must fail on the old code.
10. **compose-e2e.** Keep green. Its reload step (api restart then probe restart) may become api restart then waiting up to the reload interval (or setting a short interval in the compose env). The plan decides; the restart order for the API stays documented: restart the API after a checks file change, the probe follows by itself.
11. **Cross-repo order.** The two targets are independent in code (the API contract does not change; `GET /checks` shape is the same). The probe feature works against old API; the API feature works with old probe (it just gets 404s). Suggest no `dependsOn`. Docs: api `operation.md`, `install.md`, `troubleshooting.md` (lines saying "restart the probe") and `README`; probe `README`, `docs/troubleshooting.md`, plus config docs for the new env var. The meta README is updated by a person (do not touch).
12. Other targets (`status`, `notify`, `config`, `contract`) are not changed. `status` and `notify` read `/checks`, `/incidents`; a removal-resolved incident may trigger a "resolved" notification. Plan should state whether that is acceptable (assumed yes, documented).

## Assumptions
- Targets: `api` and `probe` only.
- "Not in the checks file at startup" means the loaded `checks.json` list, after validation by `loadConfig`.
- Changed-check detection compares the normalized check fields (deep equality); a changed check restarts its timer and runs immediately.
- Default reload interval is about 60 s; the configured value has a sane lower bound.

## Derived acceptance check
1. Start API with checks A and B, a probe and a down incident on B. Remove B from `checks.json`, restart the API. `GET /checks` lists only A; B's incident is resolved; `POST /results` for B gives 404 `unknown check`; B's results/history are still readable. Re-add B and restart: B is active again with its history.
2. Without restarting the probe, within one reload interval it stops running B. Add check C to the file, restart the API: the probe starts running C within one interval (or at once after a 404), and changes to A's `intervalMs` take effect.
3. Stalled `GET /checks` (headers or body) times out, is logged and retried; an invalid check is skipped with a log naming its id while others run; a missing `intervalMs` does not loop.
4. A wall clock step back does not delay the next run; posted `timestamp` is epoch ms.
5. `npm test`/lint pass in both repos, `compose-e2e` green, docs updated in both repos.
