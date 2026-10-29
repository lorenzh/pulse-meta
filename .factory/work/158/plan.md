# Spec #158: keyword check fixes (follow-up of #151)

## Goal
Fix three review errors of #151: the probe drops `keyword`, the api keeps `keyword` of removed checks, and the contract docs lack an example.

## Scope
probe (P2), api (P2), contract docs (P3).

## Non-goals
No change to status. No change to contract types or version. Other stale fields of removed checks (retries, latency objective) stay as they are. A removed check stays in `checks` and `GET /checks`, and the probe keeps running it, now without keyword.

## Required behavior
- probe: `fetchChecks` passes `keyword` through for HTTP checks (not TLS).
- api: at startup upsert, `keyword` of every check not in the checks file is set to NULL, in the same transaction as the upsert. Result history and the check row stay. An empty list clears all keywords. Checks still in the file keep their keyword.
- contract: `docs/index.md` shows an HTTP check example with `keyword`.

## Risks
- SQLite variable limit with `NOT IN (...)`: avoid a long parameter list (clear all keywords first, then upsert the file's checks, in one transaction; or filter per row).
- The probe pins a contract commit; confirm it already contains `keyword` (it does for #151 code, `runCheck` uses it).

## Acceptance evidence
- probe: test with a fake `deps.fetch` serving `{"keyword":"Welcome","retries":1}` through `fetchChecks`, then running the check against a 200 `maintenance` body: `down`, statusCode 200, reason `keyword "Welcome" not found`, `attempts: 2`. Fails on old code.
- api: test: service with a keyword check, `upsertChecks` without it (or restart on same DB): `GET /checks` still lists it with no `keyword`, results unchanged; a check still in the file keeps its keyword. Fails on old code.
- contract: `docs/index.md` contains the example.
- Tests and lint pass in each target.

## Repository: contract
- File: `docs/index.md`, near the `keyword` paragraph (about lines 65-68): add a JSON HTTP check example with `type`, `url`, `intervalMs` and `keyword`, valid against the types. Docs only; no types, no version bump.
- Done when: the example is in the file and checks (lint/tests) pass.

## Repository: probe
- File: `src/client.ts` `fetchChecks`: copy `keyword` in the HTTP branch. Also compare against every `HttpCheck` field of the contract and copy any other dropped field.
- Test in `src/client.test.ts` (or scheduler test): go from the API response through `fetchChecks` to the scheduler/`runCheck` result as in the acceptance evidence. It must fail on the old code.
- Docs: `docs/configuration.md` already correct; change only if a claim is wrong.
- Done when: tests and lint pass.

## Repository: api
- File: `src/service.ts` `upsertChecks`: in the existing transaction, clear `keyword` of checks not in the passed list (`UPDATE checks SET keyword = NULL WHERE keyword IS NOT NULL AND ...`), avoiding the variable limit. Results are untouched.
- Test (e.g. `src/keyword.test.ts`): regression as in the acceptance evidence, including empty list and a kept keyword. Fails on old code.
- Docs: `docs/configuration.md` (and `rest-api.md` if it describes `keyword`): state that the keyword is cleared when the check is removed from the file, while the check and its history stay.
- Done when: tests and lint pass.
