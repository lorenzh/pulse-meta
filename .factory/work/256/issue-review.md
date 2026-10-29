# Issue review: #256 Status allow-list redaction, safe settings, liveness health

Verdict: specifiable. No blocking question; open points and assumptions below.

## Verified against the code (status `main`)
- `cleanCheck` in `src/api-filter.ts` is a deny-list (`secret`, and `url/host/port/keyword` per type/hide mode; `period`/`grace` only when hidden). Everything else is copied, including `locations` entries.
- `src/start.ts` parses `POLL_MS` with minimum 1; `docs/configuration.md` says `>= 1`. `src/start.test.ts` uses `POLL_MS: "1"`, so existing tests need a new value.
- `/healthz` (`src/server.ts`) is readiness (503 until a poll succeeds); the Dockerfile HEALTHCHECK and `docs/operation.md` use it. Probe has `src/health.ts`, a Dockerfile healthcheck, and docs that need the same split.
- Docs say the browser timeout is the shorter of `POLL_MS` and 4000 ms.

## Open points (non-blocking)
1. Wire-version check: how the status page learns the API's wire version (response header from the contract, a field, or a version endpoint) must be read from `contract` and `api`. The plan must check what the API already exposes. If it exposes nothing, this becomes a cross-target change. Assumption: the existing contract header is used; no contract/api change.
2. `/readyz` vs a field: the issue allows either. Assumption: a separate `/readyz` in both status and probe, with the old readiness semantics. `/healthz` returns 200 whenever the process serves, including during shutdown? Assumption: during shutdown `/healthz` stays 200 until close; `/readyz` goes 503.
3. Breaking change: anything that probes `/healthz` for readiness (compose files, orchestrators, docs in other repos) changes meaning. Document it. The plan should grep `meta` and all targets for `/healthz` users.
4. `POLL_MS` lower bound: assumption 1000 ms, startup error (exit 2) below it. Upper bound is not required. The browser timeout must exceed the proxy timeout (`PULSE_STATUS_UPSTREAM_TIMEOUT_MS`, currently 4 s). Assumption: the browser timeout is the proxy timeout plus a margin (e.g. +2 s), or a fixed 10 s, and it is no longer tied to `POLL_MS`. Poll overlap must be avoided when the timeout exceeds `POLL_MS`. The plan should state this. Upstream timeout configured above the browser timeout needs a rule (derive the browser value from it, or cap the setting).
5. Allow-list scope: "per endpoint" covers `/checks`, `/incidents` (open and resolved), `/maintenance`, `/uptime`. The plan must list the rendered fields per endpoint and per check type (http, tcp, keyword, ssl/cert if present, heartbeat) by reading `public/client.js`. Hide mode removes `url/host/port/keyword/period/grace` and reasons. Assumption: location names are rendered only if the page shows them; otherwise they are dropped. Unknown top-level fields and unknown check types: drop the fields, and decide whether to drop the check or serve the common fields only. Assumption: serve common fields only.
6. Font validation: define the allowed syntax (e.g. a conservative character set or a list of safe family names) and the failure mode (startup error, consistent with other settings). Same for `http:` logo rejection (startup error; `https:` and relative/data URLs unchanged — to confirm which forms exist today).
7. Banner wording: "plain sentences" needs the exact new texts per case; the plan should list them. Config errors that are visitor-visible must not show validator paths or header names.
8. 500 handler: generic body, details in the log only. Check that the log redacts nothing needed.
9. Atomic render: build all sections off-DOM, swap in one step (e.g. `replaceChildren`). Listener or state side-effects in `draw` must also happen after the build.
10. Browser verification ("works in a browser in both hide modes") needs the repo's existing browser/e2e test setup. If none exists, the plan should add a DOM-level test (jsdom or the existing harness) instead.

## Assumptions
- Work is in `status` and `probe` only; `contract`, `api`, `notify`, `config` unchanged unless open point 1 requires it.
- Probe's part is limited to the liveness/readiness split, the Docker healthcheck and docs.
- Related to tracking issue #166; no earlier decisions found in comments that conflict.

## Constraints to keep
- No accessibility rework, no components.
- Hide-mode behavior stays as today (details hidden when on); the allow-list only narrows output.

## Derived acceptance check
1. For each check type (including heartbeat) and both hide modes, `/api/checks` serves exactly the allow-listed fields. A check with extra upstream fields (`retries`, `timeoutMs`, `warnDays`, a new field) serves none of them. Same for incidents, maintenance, uptime.
2. `POLL_MS=999` (or `1`) stops startup with exit 2 and a clear message; `1000` starts. The browser timeout exceeds the proxy timeout, so an API outage shows the proxy's 502 handling, not "timed out".
3. With a mismatching wire version and a reachable API, the page shows "status page and API versions do not match", not "Cannot reach the API" or "Status may be outdated". The readiness poll fails on mismatch.
4. With the API down, `/healthz` is 200 and `/readyz` is 503 in status (and in probe, for its equivalent dependency); Docker healthchecks call `/healthz`. Docs updated.
5. A forced server error returns a generic 500 body with no paths; `PULSE_STATUS_LOGO=http://...` and a font value with an unbalanced quote stop startup; banners contain no validator paths or header names.
6. A render error in `draw` leaves the previous page unchanged.
7. Every change has a test that fails on the old code; `npm test` and lint pass in both repos.
