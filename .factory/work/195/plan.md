# Spec #195: runtime validators in the contract, used by every consumer

## Goal
`@lorenzh/pulse-contract` gets plain-TypeScript runtime validators and a wire-format version. probe, status, notify and api use them instead of casts and local validators, so one definition of the wire format exists and mixed old/new services can detect a mismatch.

## Verified current state (main of each clone)
- contract: one `src/index.ts`, types only, version `0.0.0`; `dist/` (index.js, index.d.ts) is committed and a smoke test checks it equals a fresh build; the test `package entry imports as an empty module` and the AGENTS.md line "no runtime code" must change. Consumers install from git, so the committed `dist` is what they run.
- Pins: api, probe, status `a1c166e`; notify `c78f73b` (stale).
- probe `client.ts`: `parseCheck` per item, skips with a reason, `as ChecksResponse[number]`, `body as unknown[]`. Reads `GET /checks` and sends `POST /results`.
- notify `api.ts`: `checkIncident` (rejects, reports `rejected[]`, plus a Date-range bound on openedAt/resolvedAt), `fetchChecks` keeps items with string id and name (cast `Check`).
- status `validate.ts`: `parseChecks/Incidents/Maintenance` throw on the first bad entry (poll fails). `poller.ts` reads `/uptime` with `body as UptimeResponse` (non-array gives `[]`). No consumer reads `GET /checks/:id/results`; `ResultsResponse` gets a validator for completeness, no consumer change.
- api `validateResult(body, now)` in `server.ts`: bounds from #163 (timestamp window, statusCode 100..599, latency max, reason length, attempts 1..MAX_ATTEMPTS, location trim/length), defaults `location` and `attempts`. Its 400 error strings are tested in `server.validation.test.ts`.

## Non-goals
No JSON Schema, no new runtime dependency, no change to HTTP bodies, no new endpoint or API prefix.

## Design (binding for all repositories)

### Validation result
```ts
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
```
Never throws. `error` is `<path>: <problem>` with a JSONPath-like path, e.g. `checks[3].intervalMs: must be a finite number > 0`. The default root paths are `check`, `result`, `incident`, etc.; every validator takes an optional `path` argument so callers name the element (`checks[3]`).

### Validators (all exported from the package root)
- Item: `validateCheck` (`Check`, http or tls; ignores state fields), `validateCheckWithState`, `validateResult`, `validateIncident`, `validateMaintenanceWindow`, `validateCheckUptime`, `validatePostResultRequest`.
- Array wrappers (fail on the first bad element, error names the index): `validateChecksResponse`, `validateResultsResponse`, `validateIncidentsResponse`, `validateMaintenanceResponse`, `validateUptimeResponse`. `validateChecksResponse` uses `validateCheckWithState`.
- Consumers that skip bad items loop over the raw array with the item validator and `path` `checks[<i>]`; consumers that fail the poll use the wrapper.
- Behaviour: full-shape validation of the declared type (required fields present and of the right type; enums; non-empty `id`/`checkId`; `intervalMs`, `timeoutMs`, latency numbers finite; `intervalMs` > 0; `port` and `warnDays` integers; `retries` and `attempts` integers; nullable fields accept `null`). Optional fields may be absent or `undefined`. Unknown extra fields are accepted and kept: the validator returns the same object (no stripping), typed. Service-specific bounds (notify Date range, api timestamp window and lengths, probe's rules beyond the above) stay in the service on top of the validator.
- Accepted behaviour change: items are now validated full-shape. The api always serves complete data, so a valid API sees no difference; a check missing e.g. `url` or `intervalMs` is now skipped/rejected by notify, which ignored it before. This is the intended drift fix. Probe validates with `validateCheck` (so a missing `state` never drops a check), notify with `validateCheck` (it needs only id and name, but requires the base shape), status with `validateCheckWithState`.

### PostResultRequest
Change the type to `Omit<Result, "location" | "attempts"> & { location?: string; attempts?: number }`, matching what the api accepts (document that a missing `attempts` means 1 and a missing/blank `location` means `default`). `Result` is unchanged. `validatePostResultRequest` checks: object; `checkId` non-empty string; `timestamp` integer; `status` up/degraded/down; `statusCode` null or integer 100..599; `latencyMs` finite and >= 0; `reason` string or null; `location` absent or string; `attempts` absent or integer >= 1; `certDaysLeft` absent, null or integer. It returns the value as sent (no defaulting). The api keeps normalisation, the `now` window, upper bounds and lengths.

### Wire-format version
- Exports `WIRE_VERSION = 1` (integer; bump on an incompatible wire change) and `WIRE_VERSION_HEADER = "x-pulse-contract"`.
- The api sends `x-pulse-contract: 1` on every response (success and error).
- `checkWireVersion(header: string | null | undefined): WireVersionCheck` with `{ status: "ok" } | { status: "absent" } | { status: "mismatch"; error: string }`. Exact integer comparison against `WIRE_VERSION`; a malformed value is a mismatch.
- Consumer policy: `absent` is tolerated (old API during rollout) with one log line per process; `mismatch` fails the call like a network error (status: poll fails and the previous snapshot rules apply as today; notify: the fetch fails as an API error; probe: the `/checks` fetch is retried with the existing log/retry path, and a `POST /results` response with a mismatch is logged). Never silently continue on mismatch.
- Package version becomes `1.0.0` (`package.json`); the wire version is separate and independent of the package version. Docs say that the package version follows semver and `WIRE_VERSION` changes only with an incompatible wire change.

### Rollout / pins
Contract merges first. Every consumer then pins the same merged contract commit SHA (full 40 chars) in `package.json` and `package-lock.json`. notify jumps from `c78f73b`, so its build must also adapt to contract changes since then (e.g. `degraded`, `locations`, `keyword`, `attempts`, retry fields) and fix compile errors.

## Risks
- Strict full-shape validation could drop items a service handled before: mitigated by the per-item validators and by choosing `validateCheck` for probe and notify.
- A stale `dist`: the contract build must be committed (the existing dist-matches-build test enforces it).
- api messages change: tests are updated knowingly; the status code stays 400 and the bounds are not weakened.

## Acceptance evidence
- Contract exports the validators above, `WIRE_VERSION`, `WIRE_VERSION_HEADER`, `checkWireVersion`; version `1.0.0`; valid and several invalid inputs per type tested, path strings asserted; `npm run check` passes.
- grep shows no `as ChecksResponse`/`as T[]`/`as Incident`/`as UptimeResponse`/`as Check` of API JSON in probe, status, notify, and no local response validators (`status/src/validate.ts` removed).
- Each consumer's existing skip/fail tests still pass; version mismatch and absent-header tests exist.
- All four consumers pin the same contract SHA; notify no longer `c78f73b`.
- api: `POST /results` goes through `validatePostResultRequest`; all #163 bound tests pass; responses carry `x-pulse-contract`.
- Each repo's docs name the validation and the version check; `npm run check` passes in every target.

## Repository: contract
Files: `src/index.ts` (keep types; split into `src/validate.ts`, `src/version.ts` re-exported from `index.ts` if cleaner), `dist/*` rebuilt and committed, `package.json` (version `1.0.0`, description no longer "types only"), `test/*.test.ts`, `docs/index.md`, `README.md`, `AGENTS.md` (replace "shared types only, no runtime code" with "types, plain-TS validators and the wire version; no runtime dependency").
Behaviour: everything under Design above. Update the smoke test `package entry imports as an empty module` to assert the exported names. Keep `import type`/erasable-syntax rules and no `any`.
Tests: for every item and array validator a valid case (taken from `test/types.fixture.ts`, http and tls, all five states, degraded, retries, maintenance) and negative cases (wrong type, missing field, bad enum, non-finite number, non-array, null/array as object, error path asserted incl. nested like `checks[1].locations[0].result.status` and `days[2].uptime`); `validatePostResultRequest` bounds; `checkWireVersion` ok/absent/mismatch/garbage; return value is the same object (extra fields kept). Coverage floor of 80 holds.
Docs: validator API, error format, extra-field rule, header, version policy, pin procedure.
Done when: `npm run check` passes and `dist` matches the build.

## Repository: api
Depends on the merged contract. Files: `package.json`/lock (pin), `src/server.ts`, `src/server.validation.test.ts`, `src/server.headers.test.ts`, docs/README.
Behaviour: add `x-pulse-contract: <WIRE_VERSION>` next to `SECURITY_HEADERS` on every response (also errors and 204). `validateResult` first calls `validatePostResultRequest`; on `ok: false` the 400 `error` is the contract message; then the existing api checks run unchanged (timestamp window vs `now`, latency max, reason length, `MAX_ATTEMPTS`, location trim/length/default, `attempts` default 1, token location check). Only remove api checks that are strictly identical to the contract's; keep any that are stricter. The 403/404 behaviour is unchanged.
Tests: update message expectations only where text changed; every bound test from #163 must still pass; add a test that the header is present on 200, 204, 400 and 404 responses; add a test for a request the contract rejects with a path-naming message. Docs: name the validation and the header.
Done when: `npm run check` passes.

## Repository: probe
Depends on the merged contract. Files: `package.json`/lock (pin), `src/client.ts`, `src/client.test.ts`, docs/README.
Behaviour: remove `parseCheck` and the casts; for each element of the `/checks` body call `validateCheck(raw, "checks[i]")`, skip and log on `ok: false` with the contract error, keep the probe's own extra rules (finite positive `intervalMs`, tls host/port/warnDays only if not already in the contract). Non-array body behaves as today. Check `x-pulse-contract` on the `/checks` response with `checkWireVersion`: absent logs once and continues; mismatch is treated as a failed fetch (retry path). Log a mismatch from the `POST /results` response without changing the retry/drop policy. Probe still sends its own check objects as today (it may keep rebuilding the check or use the validated object; unknown fields need not be forwarded).
Tests: existing skip/log tests keep passing; their message text may change to the contract's; move purely structural cases to the contract; add tests for header absent, matching and mismatch. Docs: validation and version check.
Done when: `npm run check` passes.

## Repository: status
Depends on the merged contract. Files: `package.json`/lock (pin), delete `src/validate.ts`, `src/poller.ts`, tests that covered `validate.ts` (move cases to the contract; keep a poller test that a malformed check/incident/maintenance entry fails the poll, now with a path in the error), docs.
Behaviour: use `validateChecksResponse`, `validateIncidentsResponse`, `validateMaintenanceResponse`; on `ok: false` throw `Error(error)` so the poll fails exactly as today. `/uptime`: keep "non-array gives `[]`, uptime is optional" but validate with `validateUptimeResponse` and degrade to `[]` (log) when invalid instead of casting. Check `x-pulse-contract` of each API response: mismatch fails the poll; absent is logged once. Remove every `as` cast of API JSON.
Tests: poller tests for valid, invalid, uptime invalid, header absent/mismatch. Docs: validation and version check.
Done when: `npm run check` passes.

## Repository: notify
Depends on the merged contract. Files: `package.json`/lock (pin to the merged SHA, replacing `c78f73b`), `src/api.ts`, its tests under `test/`, `src/types.ts` if it duplicates contract types, docs/README.
Behaviour: replace `checkIncident` structural checks and the casts with `validateIncident(raw, "incidents[i]")`; keep the `rejected[]` report and keep the notify-only Date-range bound on `openedAt`/`resolvedAt` on top. `fetchChecks` uses `validateCheck` per item and keeps skipping invalid ones (log as today). Check `x-pulse-contract` on each API response: mismatch is an API error (same path as a failed fetch), absent is logged once. Fix compile errors caused by the pin jump from `c78f73b` without changing notification behaviour.
Tests: existing rejection tests keep passing; moved structural cases covered in the contract; add tests for header absent/mismatch and a check missing a required field. Docs: validation and version check.
Done when: `npm run check` passes.
