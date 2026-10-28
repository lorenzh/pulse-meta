# Spec: MVP, watch one HTTP endpoint from probe to status page

## Goal
pulse watches HTTP endpoints end to end. The probe checks them, the API decides up or down and opens or resolves incidents, and the status page shows the result and refreshes on its own.

## Current state
contract, probe, api and status are empty scaffolds (`src/index.ts`, a smoke test, strict TS, ESM, Node >=24 type stripping, `npm run check` = typecheck + `node --test`). No runtime dependencies. Each AGENTS.md requires: `node:test` tests for every change, an injectable clock for time-dependent logic (tests never use real timers), network tests only against local servers started inside the test, erasable TS syntax only.

## Scope
- Checks defined in one JSON file; HTTP GET checks only.
- Probe scheduler, HTTP check execution, result delivery.
- API: validation, SQLite storage, state and incident rules, REST reads.
- Status page: checks with state, open incidents, self-refresh.
- Shared types in pulse-contract, consumed through a Git dependency.

## Non-goals
Authentication, notifications, other check types (TCP, TLS), UI to create checks, a release process, result retention or pruning, retry queues, out-of-order or duplicate result handling.

## Decisions (resolving the issue review's open points)
1. **Contract delivery.** Types only, no runtime code. Node does not strip types under `node_modules`, so the contract commits compiled output on main: `dist/index.js` (empty module) and `dist/index.d.ts`, with `package.json` `exports`/`types` pointing at `dist`. A contract test fails if `dist` is out of date with `src` (the `check` script rebuilds with `tsc` and the test compares). Consumers use `import type` only.
2. **Pinning.** Consumers depend on `"@lorenzh/pulse-contract": "github:lorenzh/pulse-contract#<full commit sha on main>"` and commit the updated lockfile. Contract must be merged to main first; the other three pin that merge commit.
3. **Config file.** One JSON file, owned by the API (`PULSE_CHECKS_FILE`, default `./checks.json`): `{"checks":[Check, ...]}`. The API loads it at startup, validates it, and upserts the checks into SQLite. The probe does not read the file; it fetches `GET /checks` from the API at startup (retrying until it succeeds) and runs those. A sample `checks.example.json` lives in api.
4. **Units.** All durations are milliseconds. `timeoutMs` optional, default 5000. Redirects followed (fetch default); the 2xx test applies to the final response. Method GET.
5. **State rule.** A check with no results is `unknown`. State is `down` from the first down result and `up` from an up result. The consecutive-down counter resets on up. The third consecutive down result opens an incident (if none is open). Further downs do not open another. The first up result resolves the open incident. The counter survives a restart (derived from stored results or stored with the state).
6. **Storage.** `node:sqlite` (no dependency). Path from `PULSE_DB` (default `./pulse.db`), `:memory:` in tests. Results listing: `limit` query param, default 100, max 1000, newest first.
7. **Status page.** A small Node HTTP server serving one HTML page with client JS and proxying `/api/*` to the API (`PULSE_API_URL`), so no CORS. The page polls every `POLL_MS` (default 5000). Shows every check with state, and the open incidents.

## Data shapes (defined once in pulse-contract)
```ts
type CheckStatus = "up" | "down";
type CheckState = CheckStatus | "unknown";

interface Check { id: string; name: string; url: string; intervalMs: number; timeoutMs?: number }

interface Result {
  checkId: string;
  timestamp: number;          // epoch ms, set by the probe
  status: CheckStatus;
  statusCode: number | null;  // null when no response arrived
  latencyMs: number;
  reason: string | null;      // null when up; otherwise e.g. "HTTP 503", "timeout after 1000ms", "ECONNREFUSED"
}

interface Incident { id: number; checkId: string; openedAt: number; resolvedAt: number | null; reason: string | null }

interface CheckWithState extends Check {
  state: CheckState;
  consecutiveDown: number;
  lastResultAt: number | null;
  lastReason: string | null;
}
type PostResultRequest = Result;               // body of POST /results
type ChecksResponse = CheckWithState[];        // GET /checks
type ResultsResponse = Result[];               // GET /checks/:id/results
type IncidentsResponse = Incident[];           // GET /incidents
interface ErrorResponse { error: string }
```
`reason` of an incident is the reason of the result that opened it.

## API (implemented by api, consumed by probe and status)
- `POST /results` body `Result`. 204 on success. 400 on invalid body, 404 on unknown `checkId`.
- `GET /checks` → `ChecksResponse`.
- `GET /checks/:id/results?limit=N` → `ResultsResponse`; 404 for an unknown check.
- `GET /incidents?status=open|resolved` → `IncidentsResponse` (both when omitted; open first, newest first). 400 on a bad `status`.
- Errors are `ErrorResponse` JSON. Port from `PORT` (default 3000).

## Required behavior and risks
- Probe: each check runs on its own interval; a slow check never overlaps with itself. If the API is unreachable when posting, log and drop, keep probing.
- The first probe run happens immediately at start, then every interval.
- Risk: Git dependency without a build step, hence committed `dist`. Risk: `node:sqlite` prints an experimental warning; acceptable. Risk: cross-repo ordering, so contract merges first.

## Acceptance evidence
Per repository: `npm run check` passes in CI with the tests listed below. End to end (documented as a manual procedure plus a script `scripts/e2e.md` in pulse-meta after all four are merged; not part of per-repo CI):
1. Start a local HTTP server on a fixed port returning 200; one check with interval 1000 and timeout 1000 in `checks.json`.
2. Start API (temp DB), probe, status; the page shows the check `up`, no open incidents.
3. Stop the test server: the page shows `down` after the first failed probe, and an incident under open incidents after the third; `GET /incidents?status=open` lists it.
4. Start the server again: the page shows `up`, the open list is empty, `GET /incidents?status=resolved` shows it with `resolvedAt`. The page updated without a manual reload.

## Repository: contract
Files: `src/index.ts` (types above), `package.json` (`exports` and `types` to `dist`, `files`, `build` script `tsc -p tsconfig.build.json`, `check` runs build then typecheck and tests), `tsconfig.build.json`, committed `dist/index.js` and `dist/index.d.ts`, `.gitignore` must not ignore `dist`, `README.md`.
Behavior: types only, no runtime logic. Remove the "Event" mention or leave it out of the MVP.
Checks (`node:test`): a test that type-level fixtures compile (a `.ts` file that uses every type, covered by `typecheck`); a test that `dist/index.d.ts` is identical to a fresh build output; a test that `import("@lorenzh/pulse-contract")` of the package entry works under Node (empty module).
Completion: `npm run check` green; merged to main, and the merge SHA reported for the pins.

## Repository: probe
Depends on contract.
Files: `src/check.ts` (run one HTTP check: GET with `AbortSignal` timeout, returns `Result`; takes `fetch` and a clock `now(): number`), `src/scheduler.ts` (runs each check on its interval; takes an injectable timer interface `{setTimeout, clearTimeout}` and clock, no overlap per check, `stop()`), `src/client.ts` (`fetchChecks`, `postResult` against `PULSE_API_URL`), `src/main.ts` (wiring, `npm start`, env `PULSE_API_URL` default `http://localhost:3000`), `package.json` (Git dependency on pulse-contract pinned to the merged SHA, `start` script), lockfile, README.
Behavior: as above. Down reasons: `HTTP <code>` for non-2xx, `timeout after <n>ms`, or the error code or message for connection errors. `latencyMs` from the clock. Posting failures are logged and dropped.
Checks: against local servers started in the test: up on 200, down on 500 with reason, down on timeout (server never answers), down on connection refused, redirect followed to 200. Scheduler with a fake timer and clock: immediate first run, repeated runs per interval, no overlap, stop. Client against a fake local API: posts `Result` JSON, survives an unreachable API, fetches checks with retry.
Completion: `npm run check` green with the pinned dependency installed through `npm ci`.

## Repository: api
Depends on contract.
Files: `src/config.ts` (load and validate checks file), `src/db.ts` (SQLite schema: `checks`, `results`, `incidents`; open and reopen), `src/state.ts` (pure state and incident rule), `src/service.ts` (ingest result, queries; injectable clock for `resolvedAt`/`openedAt` is taken from the result timestamp, and any other time via the clock), `src/server.ts` (HTTP routes), `src/main.ts` (`npm start`, env `PORT`, `PULSE_DB`, `PULSE_CHECKS_FILE`), `checks.example.json`, `package.json` (pinned contract, `start`), lockfile, README.
Behavior: exactly the API and rules above. `openedAt` and `resolvedAt` are the timestamps of the opening and resolving results. Request body validation without dependencies. Consecutive-down counter persists.
Checks: state machine table (2 downs: no incident; 3 downs: one open; 4th down: still one; up: resolved; up-down-down-up: no incident; unknown before any result; a second incident after a recovery). Persistence across closing and reopening a file DB, including the counter in the middle of a down streak. Config validation (missing field, bad interval, duplicate id). Endpoint tests against the server started on port 0: every route, 204/400/404 cases, limit and ordering, status filter.
Completion: `npm run check` green.

## Repository: status
Depends on contract.
Files: `src/server.ts` (serves the page, proxies `/api/*` to `PULSE_API_URL`, `PORT` default 8080), `src/render.ts` (pure functions from `ChecksResponse` and `IncidentsResponse` to HTML), `src/poller.ts` (polling loop with injectable timer, clock and fetch), `public/index.html` plus the client script (the client may be plain JS or TS served after Node type stripping; no bundler), `src/main.ts` (`npm start`, `POLL_MS` default 5000), `package.json` (pinned contract, `start`), lockfile, README.
Behavior: lists every check with name, URL, state (`up`, `down`, `unknown`) and last reason; lists open incidents (check name, opened time, reason), or an empty-state text. Refreshes every `POLL_MS` without a reload; if the API is unreachable the page shows an error banner and keeps the last data.
Checks: render tests for each state, for open incidents, for the empty state and HTML escaping of names, URLs and reasons. Poller with a fake timer: refreshes on schedule, error banner on failure, recovers. Server tests against a local fake API: serves the page, proxies `/api/checks` and `/api/incidents`, returns 502 when the API is down.
Completion: `npm run check` green.
