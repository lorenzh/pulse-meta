# Issue review: #195 runtime validators in the contract

Verdict: specifiable. No blocking question. Open points and assumptions below.

## Verified against the clones (main)
- contract: single `src/index.ts`, types only, package version `0.0.0`, no runtime code, one smoke test plus a type fixture (positive only). `exports` points to `dist`; consumers pin a git commit (`github:lorenzh/pulse-contract#<sha>`), so the build runs on install (check `prepare`/dist handling in the plan; `dist/` is in the clone).
- Pins: api, probe, status at `a1c166e`; notify at `c78f73b` (stale, confirmed).
- probe `client.ts`: local `parseCheck` per item (skips invalid with a reason, rejects bad intervalMs, tls host/port/warnDays), cast to `ChecksResponse[number]`; `body as unknown[]`.
- notify `api.ts`: `checkIncident` (rejects, reports `rejected[]`, plus Date-range bound on openedAt/resolvedAt that is NOT in the contract types), `fetchChecks` filters on string id and name only (casts `Check`).
- status `validate.ts`: `parseChecks/Incidents/Maintenance` throw on the first malformed entry (fail the poll). It checks only a few fields.
- api `server.ts`: `validateResult(body, now)` returns an error string or `Result`; has timestamp bounds relative to `now` (#163), location trim/length, default `attempts` 1, default location.

## Open points (for the plan to decide)
1. Granularity: consumers behave differently on invalid data (probe and notify skip the item, status fails the poll). The contract needs per-item validators (`validateCheck`, `validateIncident`, ...) plus array wrappers, so consumers keep their policy. Error type/shape (throw vs `Result` union) is the plan's call; it must name the path (`checks[3].intervalMs`).
2. Strictness vs consumer needs: notify only needs id and name of checks; status only a few fields; probe needs intervalMs/url/host. If the contract validates the full `CheckWithState` (locations, state, consecutiveDown...), a field that a consumer ignores today could now drop the item or fail the poll, changing behavior. The plan must say whether validators are full-shape (and which behavior change is accepted) or offer a way to keep current leniency. Probe's `/checks` items also may be validated as a `Check` rather than `CheckWithState`.
3. Extra bounds that are not in the types: notify's Date range check, probe's finite and positive intervalMs, api timestamp window and string lengths. Assumption: the contract validates shape and universal invariants (finite numbers, integers where documented, enums, non-empty ids); service-specific bounds stay in the service on top.
4. Unknown fields: assumption is that validators accept and keep/ignore extra fields (forward compatibility), and return the typed value without stripping unless the plan says otherwise. Probe currently rebuilds the check (drops unknown fields).
5. Wire-format version: the issue leaves it to the plan (constant + response header, or field). Must not change the HTTP body shape, so a response header (e.g. `X-Pulse-Contract`) plus an exported constant and a `checkVersion(header)` helper is the likely choice. Open: what a consumer does on mismatch (fail the poll / log and continue), behavior when the header is absent (old API during rollout: assumption is tolerate and log), and compare major only or exact. Probe's `POST /results` and api's responses both need the header; CORS exposure if status is browser-facing is unlikely to matter (server-side fetch).
6. Package version: pick a real version (e.g. `1.0.0`) and tie the wire version to it or keep it separate; where a git-pinned consumer reads it from (`package.json` import vs generated constant in `src`).
7. api `POST /results`: contract validator may be used only if it does not weaken #163 bounds. The api needs a `now`-based timestamp check, location normalisation, and default `attempts`; the contract's `PostResultRequest = Result` has required `location`/`attempts` while the api accepts them missing. The plan must decide whether the contract validates a request type with optional location/attempts (the type may need a real `PostResultRequest`, a contract change) or the api keeps normalisation and uses the contract validator after defaulting. Error messages of the api (tests in `server.validation.test.ts`) must stay or be updated knowingly: the API responds with `error` strings that tests and clients may match.
8. Coverage of "results as far as consumed": confirm which consumer reads `GET /checks/:id/results` (status?) and `GET /uptime`; validators are needed for every type actually read, including `UptimeResponse` and `ResultsResponse` if consumed.
9. Ordering and pin sequence: contract PR must merge first, then each consumer pins the merged commit SHA. Children depend on the contract (`dependsOn`); the plan sees only `main` of the targets, so the contract change must be marked as the dependency for probe, status, notify and api. notify's pin jump spans many merges: the notify build must also absorb any contract type changes since `c78f73b` (e.g. `degraded`, `locations`, `keyword`, `attempts`) and fix compile errors.
10. No new runtime dependency; the contract package currently has none. Keep plain TS, and note `dist` must contain the runtime JS (build config `tsconfig.build.json` emits JS; verify the declaration-only setup does not skip it).
11. "Negative tests for every type" and "coverage does not drop": contract `test` script has a line-coverage floor of 80; consumers' removed validator tests move to the contract, and consumers keep integration tests for their skip/fail policy.
12. Docs: each repo's README/docs name the validation and the version check; the contract `docs/index.md` documents the validator API and the header.

## Assumptions made
- Tracking issue #166, wave 3; no earlier issue comments carry decisions (none read).
- Plain TypeScript hand-written validators, no JSON Schema.
- Header-based version signal; absence tolerated during rollout.
- Per-service bounds stay in the services.

## Derived acceptance check
- `@lorenzh/pulse-contract` exports validators for `ChecksResponse`, `IncidentsResponse`, `UptimeResponse`, `MaintenanceResponse`, `ResultsResponse` (as consumed) and `PostResultRequest`; each returns the typed value, or an error naming the path (e.g. `checks[3].intervalMs`); tests cover valid and several invalid inputs per type.
- The package has a non-zero version and exports a wire-format version; the API sends it in a response header; a consumer checks it and a mismatch is detected, with a test.
- probe, status, notify contain no `as` casts of API JSON and no local response validators; each behaves as before for invalid data (same skip/log or poll-fail tests pass); all four consumers pin the same merged contract SHA (notify no longer `c78f73b`).
- api validates `POST /results` through the contract validator while the #163 bound tests still pass.
- Each repo's docs mention validation and the version check; `npm run check` passes in every target.
