# Issue review: MVP, watch one HTTP endpoint from probe to status page

## Current state of the repositories
contract, probe, api and status are all empty scaffolds. Each has `src/index.ts` (about 2 lines), a smoke test, strict TS, ESM, Node >=24 type stripping and `node --test`. None has runtime dependencies. contract has no `exports`, `main`, `types` or build step. api, probe and status are `private`.

## Open points (none block the spec)
1. **Contract as a Git dependency vs. type stripping.** Node refuses to strip types for files under `node_modules`. The consumers can only import `.ts` from the contract at runtime if the contract ships JS. Options: (a) the contract exports only types, and consumers use `import type` (erased, so it works); (b) the contract commits or builds JS plus `.d.ts` on main, which a Git dependency needs because there is no `prepare` release step. The spec should pick one. Recommendation: (a) for types, with any runtime helpers (such as validators) shipped as compiled JS only if needed. The contract also needs `exports`/`types` fields.
2. **Dependency pinning.** A Git dependency on a commit of main means contract must be merged before the other three can pin a commit. The build order is contract first, then probe/api/status, each pinning the merged SHA. The lockfiles must be updated. The spec should state this ordering. During development the pin may be a placeholder SHA.
3. **Shapes are underspecified.** The spec must define the fields:
   - Check: id, name, url, interval (unit?), plus timeout.
   - Result: checkId, timestamp, status up/down, reason, and likely statusCode and latencyMs.
   - Incident: id, checkId, openedAt, resolvedAt|null.
   - Per-check state (up/down/unknown) with the consecutive-down count and lastResultAt.
   - API request and response shapes.
   The issue says "check, result, incident", but the API also serves a check with its current state, so a CheckState/CheckStatus shape is needed.
4. **Config file.** Format and location are unspecified. Checks are "configured in a file", but it is unclear who reads it. The probe must run them, and the API and status page must list them with state. Options: the probe reads the file and registers the checks with the API; the API reads the same file; or both read it. The spec should choose one source of truth. Assumption: the API owns the file, and the probe and the API each get the path by env/CLI arg (same file locally). The simplest option is JSON, to avoid a YAML dependency.
5. **Timeout and interval.** The timeout value is not given. Assumption: a per-check optional `timeoutMs`, default 5000 ms. The interval unit is not given. Assumption: milliseconds in the contract, with the config using the same unit.
6. **Redirects.** Not stated. Assumption: follow redirects (fetch default), and 2xx is judged on the final response. Only GET is used.
7. **Result delivery.** The probe-to-API endpoint (e.g. `POST /results`) is not defined. The spec should cover what happens if the API is unreachable (assumption: log, drop, and keep probing; no retry queue in the MVP). The API should validate input and reject results for unknown check ids. The result timestamp is assigned by the probe (injectable clock).
8. **State and incident rules.**
   - "Three consecutive down" is counted per check, across results, in timestamp/arrival order.
   - A check with no results has state `unknown`.
   - An up result resets the counter.
   - A further down result after an incident is open does not open another incident.
   - "First up result after that" resolves it only if an incident is open; up results before the third down do not create or resolve anything.
   - Whether the check's state turns `down` on the first down result or only when the incident opens is ambiguous. The issue's done-when says "the check go down, an incident open". Assumption: state is `down` from the first down result, and the incident opens at the third.
   - The API restart must preserve the counter. Derive it from the stored results or store it with the state.
   - Out-of-order or duplicate results are not handled in the MVP.
9. **Storage.** SQLite is required. Assumptions: the built-in `node:sqlite` (Node 24, no extra dependency; it emits an experimental warning), with the DB path configurable and `:memory:` in tests. Retention and pruning of results are out of scope. The results endpoint needs a limit or "latest N" (assumption: default 100, newest first).
10. **API surface.** The issue lists three reads. The proposed paths are `GET /checks`, `GET /checks/:id/results`, `GET /incidents` (with an optional `?status=open|resolved`), and `POST /results`. The spec should fix them and the error shapes (404 for unknown checks).
11. **Status page.** It is not defined whether it is a server-rendered page, a static page with client JS, or a Node server that proxies the API. It must "refresh on its own". Because the status repo has no framework, the assumption is a small Node HTTP server that serves one static HTML page plus JS polling the API every N seconds. It needs either CORS on the API or same-origin proxying. Assumption: the status server proxies `/api/*`, which avoids CORS. Resolved incidents are not required on the page (only open ones), though the API serves both. The poll interval is configurable. The page shows reason/last result time as an optional extra.
12. **Process wiring and ports.** Each service needs a start script (`npm start`) and env config (API URL, port, DB path, config path). Defaults are unspecified.
13. **End-to-end verification spans repos.** "Done when" is a manual scenario across 4 repos. No repo can host it by itself without depending on the others. Proposal: the acceptance script goes in pulse-meta (a documented script, or a documented manual procedure in a README), and each repo's tests cover its part with local servers. The spec must say where the e2e lives and that it is not part of the per-repo CI (the build agents only work in single repos).
14. **Clock injection.** The probe scheduler and the API incident logic need an injectable clock. A scheduler test must not use real timers, so the scheduler must be designed to take a fake timer/clock.
15. **Out of scope (confirmed by the issue).** Authentication, notifications, TCP/TLS/other check types, UI for creating checks, a release process, and retention.

## Assumptions to carry into the spec
Everything marked "Assumption" above. No contradictory requirements were found. No answer from a person is needed.

## Derived acceptance check
1. Start a local test HTTP server returning 200, with one check in the config (interval short, e.g. 1 s, timeout 1 s).
2. Start the API (temp SQLite file), the probe and the status page.
3. The status page shows the check as `up`, with no open incidents.
4. Stop the test server. After the first failed probe the check shows `down`. After the third consecutive down result an incident appears under open incidents (with a reason such as connection refused/timeout). `GET /incidents` shows it open.
5. Start the test server again on the same port. After the next probe the check shows `up` and the incident is gone from the open list. `GET /incidents` shows it resolved with a `resolvedAt`.
6. Page refreshes happen without a manual reload.

Per-repo test checks:
- contract: types compile when consumed through the Git-dependency path.
- probe: up on 2xx, down on non-2xx, timeout and connection error (each with a reason). Interval scheduling with a fake clock. Results posted to a local fake API.
- api: the state machine (2 downs: no incident; 3 downs: open; 4th: still one; up: resolved; up-down-down-up: none). SQLite persistence across reopen. Endpoint tests against a local server.
- status: rendering of the states and incidents, and polling with a fake clock/timer, against a local fake API.
