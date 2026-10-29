# Spec: Status allow-list redaction, safe settings, liveness health (#256)

## Goal
Make the public status page safe by default and robust: only fields the page renders leave the server, settings cannot overload the API, a version mismatch is reported as such, liveness and readiness are separate, errors leak nothing, and a render error leaves the page intact. Tracking: #166.

## Scope
- `status`: all items. `probe`: only the liveness/readiness split, Docker healthcheck, docs.
- `contract`, `api`, `notify`, `config`: no change. Verified: the api already sends the wire-version header (`WIRE_VERSION_HEADER`), the status proxy already forwards it, and `poller.ts` already uses `checkWireVersion`. Only the background readiness poll (`src/api-poll.ts`) ignores it.

## Non-goals
Accessibility rework, components, hide-mode semantics (details stay hidden when on; the allow-list only narrows output).

## Current behavior (verified)
- `cleanCheck` in `status/src/api-filter.ts` copies all fields and deletes `secret`, and `url/host/port/keyword` (always for heartbeat, in hide mode for all) plus `period/grace` in hide mode. `/incidents` only has its `reason` cleaned; `/maintenance` and `/uptime` pass unfiltered.
- `POLL_MS` has minimum 1 (`start.ts`, `docs/configuration.md`); `start.test.ts` uses `POLL_MS: "1"`. Browser timeout is `min(pollMs, 4000)` (`poller.ts`), proxy default is 4000 ms.
- `/healthz` in `server.ts` is readiness (503 until a successful poll, and during shutdown); status Dockerfile healthcheck and probe Dockerfile healthcheck use it. Probe `health.ts` serves `/healthz` (readiness: checks fetched, not shutting down) and `/metrics`.
- 500 handler returns `String(err)`. `resolveLogo` accepts `http(s)://`. `FONT_RE` in `theme-config.ts` allows quotes but not balanced ones. `poller.ts` prefixes every failure with "Cannot reach the API: <validator message>"; `draw` in `public/client.js` assigns sections one by one.

## Repository: status

### Redaction as allow-list (`src/api-filter.ts`)
Replace delete-based cleaning with building a new object from a per-endpoint, per-type field list. Fields not listed are dropped; a new upstream field stays private.
- `/api/checks`, common fields (all types): `id`, `name`, `type`, `state`, `lastResultAt`, `lastReason` (sanitized; `null` in hide mode), `locations`, `maintenance`, `certDaysLeft`.
  - `locations[]`: only `stale` and `result.{timestamp,status,latencyMs,reason}` (`reason` sanitized, `null` in hide mode). Drop `location` names, `checkId`, `statusCode`, `attempts` unless `render.ts` reads them (verify with grep of `render.ts`/`client.js` and keep exactly what is read; the schema validator in `contract` must still accept the result, so keep any field it requires, but then with its value unchanged).
  - `maintenance`: `start`, `end`, `note`, `checkId` if the validator requires it.
  - http (`type` absent or `"http"`): plus `latencyObjectiveMs`; plus `url` (sanitized) and `keyword` only when not hidden.
  - tls: plus `host`, `port` only when not hidden.
  - heartbeat: plus nothing else when hidden; `period`, `grace` only when not hidden (as today they are removed when hidden); never `url/host/port/keyword`.
  - Never: `secret`, `retries`, `retryDelayMs`, `timeoutMs`, `intervalMs`, `warnDays`, `consecutiveDown`, unknown fields.
  - Unknown `type`: serve the common fields only.
  - Before cutting any field, grep `src/render.ts`, `src/poller.ts` and `public/client.js` for its use and the `contract` validators for required fields; the final allow-list must keep the page working. Placeholders in `poller.ts` (`withTargetPlaceholder`) keep handling hidden fields.
- `/api/incidents` (open and resolved): `id`, `checkId`, `openedAt`, `resolvedAt`, `reason` (sanitized, `null` hidden).
- `/api/maintenance`: `checkId`, `start`, `end`, `note`.
- `/api/uptime`: `checkId`, `uptime`, `days[].{date,uptime}` (+ any field `render.ts` reads; `results` is dropped unless read).
- Non-object items and non-array bodies: keep today's handling for non-arrays; array items that are not objects are dropped.
- Tests (`api-filter` and `server.privacy.test.ts`): per check type (http, keyword http, tls, heartbeat) and both hide modes, assert the served key set exactly; upstream fixtures carry `retries`, `timeoutMs`, `warnDays`, `intervalMs`, location names and an invented `futureField`, and none is served; same for incidents, maintenance, uptime; unknown type serves common fields only.

### Settings
- `POLL_MS`: integer >= 1000; below it startup fails (exit 2) with `POLL_MS: must be an integer >= 1000`. Update `start.ts`, `start.test.ts` (replace `"1"`; add 999 rejected, 1000 accepted), `docs/configuration.md` (also fix the contradicting "not checked" sentence), `README.md` if it lists it.
- Browser timeout: no longer `min(pollMs, 4000)`. The server computes `browserTimeoutMs = upstreamTimeoutMs + 2000` and injects it into the page (`data-timeout-ms` on `<body>`, next to `data-poll-ms`); `client.js` passes it as `timeoutMs` to `createPoller`. The `poller.ts` default becomes a fixed 10000 ms. With the proxy default the browser waits 6 s, so the proxy's 502 arrives first.
- Poll overlap: if a refresh is still running when the next is due, the next tick starts only after the refresh ends (the existing chain schedules after completion, so verify this and add a test with timeout > pollMs).
- Docs: `docs/operation.md` line about "shorter of poll interval or 4000 ms" and `docs/troubleshooting.md` line 37 are rewritten.
- Logo: `http:` URLs rejected at startup (`PULSE_STATUS_LOGO: URL must use https`); `https:` URLs, local files unchanged. Remove the `http` mention in `ServerOptions` doc and docs. Test rejects `http://x/logo.png`, accepts https.
- Fonts: in `theme-config.ts` additionally require balanced quotes: after removing every complete `'...'` or `"..."` pair, no quote remains, and no quote of one kind inside the other kind's pair is mis-parsed; keep the character set. Invalid values keep the module's existing failure mode (check how `pickScalars` reports; the issue demands startup refusal for an unbalanced quote, so an invalid font value must throw at startup like other settings, not be silently ignored — adjust and document if today it is skipped). Test: `"Foo`, `'Foo"`, `Foo'` break startup; `'Space Grotesk', sans-serif` passes; `theme.css` output contains no unbalanced quote.

### Wire version
- `src/api-poll.ts`: read the `WIRE_VERSION_HEADER` from the `/checks` response with `checkWireVersion`; on `mismatch` record the poll as an error and set a distinct state so `/readyz` reports `API version mismatch` (`metrics.recordPoll` gets a third outcome or a reason). `absent` stays accepted (as in `poller.ts`). Test: mismatching header with 200 fails readiness with that reason; matching passes.
- Page: `poller.ts` marks a `WireVersionError` with a separate state field, e.g. `error: { kind: "version" | "unreachable" | "invalid", ... }` or a `PollerState.errorKind`. Banner and unavailable text for `version`: "The status page and the API versions do not match." (the visitor sentence "status page and API versions do not match" must appear). Summary/updated for `version` use "Status unavailable: versions do not match" and the suffix is not "API unreachable".

### Visitor texts (`poller.ts`, `render.ts`)
Visitors see no validator paths or header names; details go to `console.error` / log only.
- unreachable/timeout/HTTP error: banner "Cannot reach the API. Showing the last known status." (or without the second sentence when no data); summary "Status may be outdated"; updated suffix " · API unreachable".
- invalid response (validator failure): banner "The API sent an unexpected answer."; details logged via the poller `log`.
- version mismatch: as above.
- Update `render.test.ts`, `poller.test.ts` accordingly.

### Health
- `/healthz` (liveness): 200 `ok` whenever the server handles the request, also while shutting down until the listener closes; never depends on the API.
- `/readyz` (readiness): the old `/healthz` semantics (200 after a successful poll within `max(3 x POLL_MS, 30 s)`, 503 with reason otherwise and during shutdown, 503 on version mismatch).
- Dockerfile `HEALTHCHECK` keeps `/healthz` (now liveness). `docs/operation.md`, `README.md`, `docs/install.md` (it says `GET /`; fix to `/healthz`), `docs/development.md` updated, with an explicit note that `/healthz` changed meaning (breaking) and orchestrators must use `/readyz` for traffic readiness. Update `server.health.test.ts`, `shutdown.test.ts` (in shutdown `/healthz` is still 200, `/readyz` 503), `main.startup.test.ts`.
- Test with API down: `/healthz` 200, `/readyz` 503.

### Errors
- 500 handler: body `{"error":"internal error"}`; the error (message and stack) goes to the structured log via `src/log.ts` (add a logger option to `createStatusServer`; default no-op in tests, `main.ts` wires the real one). Test: a forced read failure on a path returns the generic body with no `/` path fragment; the log receives the detail.

### Atomic render (`public/client.js`)
`draw` builds the HTML of all sections first (banner, summary, updated, checks or unavailable, incidents, resolved, maintenance), then assigns them in one step (e.g. a loop over a `[[id, html]]` list after all `render*` calls returned, or `replaceChildren` with parsed templates). `lastState` is set only after a successful build. A throw in any `render*` leaves the DOM untouched. Because `client.js` is not unit-testable today, move the build part into a function exported from a TS module that is served as a browser module (like `render.ts`; add to `tsModules` in `server.ts`), e.g. `buildSections(state, env): Record<string,string>`, with a test that a throwing renderer yields no partial result, plus a DOM test (jsdom devDependency or the existing harness; check `package.json`) that runs `draw` with a throwing renderer and asserts the old content stays. Both hide modes: the same DOM test runs with checks served by the filter in both modes.

### Verification in a browser
Check `package.json` for an existing browser/e2e setup. If none, the DOM test above plus a server-level test that serves the page and `/api/*` in both hide modes is the evidence. Also run the server manually in both modes and note it in the PR.

### Done when (status)
All tests fail on old code where behavior changed, `npm test`, lint and typecheck pass, `docs/` and README updated.

## Repository: probe
Independent of `status`; no dependency.
- `src/health.ts`: `GET /healthz` returns `200 ok` whenever the listener serves (also during shutdown until it closes). New `GET /readyz` returns the old readiness (checks fetched at least once, not shutting down; 503 with reason). `/metrics` unchanged; other paths 404. Keep `HealthDeps.readiness`; `/healthz` ignores it.
- `Dockerfile` healthcheck keeps `/healthz` (now liveness); `src/main.test.ts` and `src/health.test.ts` updated: tests for `/healthz` 200 while not ready and during shutdown, `/readyz` 503/200.
- Docs: `docs/operation.md` (health section and shutdown paragraph: `/readyz` goes 503 on signal, `/healthz` stays 200), `docs/install.md`, `docs/configuration.md` wording if needed, README if it mentions `/healthz`. Mark as a breaking change of meaning.
- Done when: `npm test`, lint, typecheck pass; tests fail on old code.

## Risks
- Breaking meaning of `/healthz`: any probe in other repos (`api/scripts/compose-e2e.sh` references `healthz` for api, unrelated to status/probe; grep compose files and docs in `meta` found none for status/probe) must be checked by the implementer: grep each target for status/probe health URLs.
- Over-trimming the allow-list breaks rendering or contract validation in `poller.ts`; mitigated by validating the filtered output with the same validators in tests.
- Font strictness may reject themes that worked; document it.

## Acceptance evidence
1. Per type and mode, served keys equal the allow-list; extra upstream fields never appear (incl. incidents, maintenance, uptime).
2. `POLL_MS=999` exits 2; `1000` starts; browser timeout (proxy + 2 s) exceeds proxy timeout; API down shows proxy-502 handling, not "timed out".
3. Mismatching wire version with a reachable API: page shows "status page and API versions do not match"; `/readyz` 503.
4. API down: status `/healthz` 200, `/readyz` 503; probe the same with its dependency; Docker healthchecks use `/healthz`; docs updated.
5. Forced 500 is generic; `http:` logo and unbalanced font quote stop startup; banners hold no validator paths or header names.
6. A throwing render leaves the previous page.
7. `npm test` and lint pass in both repos.
