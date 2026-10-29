# Issue review: #158 keyword drop (probe) and stale keyword (api)

Verdict: specifiable. No blocking question.

## Verified current behavior
- probe `src/client.ts` `fetchChecks`: the HTTP branch builds `{id, name, url, intervalMs}` and copies `timeoutMs`, `latencyObjectiveMs`, `retries` and so on, but not `keyword`. The TLS branch correctly has none.
- api `src/service.ts` `upsertChecks` only iterates checks from the file. The upsert sets `keyword = excluded.keyword`, so dropping the keyword while the check stays works. Checks missing from the file are never touched, so their row (and `keyword`) stays and `GET /checks` serves it (`r.keyword !== null` -> `c.keyword`).
- contract `docs/index.md` describes `keyword` and the 1 MiB limit (about lines 65-68) but has no HTTP check example with `keyword`.

## Open points (non-blocking)
1. Removed checks stay in the `checks` table and in `GET /checks` (history stays). Only `keyword` is cleared. Other stale fields of a removed check (retries, latency objective) are out of scope. The probe will keep running such a check, now without keyword. This is accepted behavior; docs should say "cleared when removed".
2. Clearing must run in the same transaction as the upsert, for ids not in the passed list. An empty list must clear all keywords. Use `UPDATE checks SET keyword = NULL WHERE keyword IS NOT NULL AND id NOT IN (...)` with bound parameters (watch SQLite's variable limit, or use a temp set / per-row filtering).
3. The probe test must go through `fetchChecks` with a fake `deps.fetch` returning a check with `keyword`. It must assert the keyword on the returned `Check`, and ideally the full scheduler result (`down`, statusCode 200, reason `keyword "Welcome" not found`, `attempts: 2` with `retries: 1`). It must fail on old code.
4. Other fields that `fetchChecks` could silently drop are not audited by the issue. The plan may check that every `HttpCheck` field of the contract is copied (a cheap, in-scope sanity check).
5. The probe depends on the contract version that has `keyword` (merged in contract#18). Confirm the probe's dependency pin already includes it; if not, a bump is needed.
6. Dependency order: contract (docs only) is independent. probe and api are independent of each other. No `dependsOn` is needed, and the contract change touches no types and no version bump.
7. The probe and api docs "stay correct": the api docs (`configuration.md`, `rest-api.md`) should state the keyword is cleared when the check is removed from the file. The probe docs need no change unless they claim otherwise.

## Assumptions
- "Result history stays" means the `results` rows of the removed check are untouched and the check row itself stays.
- The contract example is docs-only (a JSON snippet with `type`/`url`/`keyword`, valid against the types).
- The status target is not changed.

## Acceptance check
- probe: a test serving `{"keyword":"Welcome","retries":1}` via fake fetch to `fetchChecks`, then running the check against a 200 `maintenance` body, yields `down`, statusCode 200, reason `keyword "Welcome" not found`, `attempts: 2`. It fails on old code.
- api: a service with a keyword check, then `upsertChecks` without it (or a restart on the same DB), gives `GET /checks` with the check still listed, no `keyword`, and its results unchanged. A check still in the file keeps its keyword. It fails on old code.
- contract: `docs/index.md` contains an HTTP check example with `keyword`.
- All target test suites and lint pass.
