# Issue review: #179 status page non-JSON upstream answers, wrong /api paths in api docs

Verified against `.repos/status` and `.repos/api` (main). Follow-up of #164 (spec `.factory/work/164/plan.md`). Targets: `status`, `api`. No contract change.

## Findings in the code
- status `src/server.ts` (proxy handler, ~l.123-147): `JSON.parse(text)` runs after the `upstream.ok` check with no content-type check. A `text/html` body `[]` becomes `200 application/json`. The unparsable-body 502 (`invalid API response`) already exists.
- status `src/main.ts` is a top-level script (no exported function). It reads `PULSE_STATUS_HIDE_DETAILS` via `parseHideDetails` and passes `hideDetails` to `createStatusServer`. `settings.test.ts` tests only the parser. `poller.test.ts` ~l.257 "poller requests only allow-listed API paths" does not depend on the setting.
- api `docs/install.md` l.51 lists `/uptime`, `/checks`, `/maintenance`, `/incidents?...` on port 8080 and says "No other path is served". pulse-status serves the proxy under `/api/...`; `/` and static assets are served too.

## Open points (none blocks the spec)
1. Testing `main.ts`: it cannot be imported without starting a server and reading `process.env`. Options: (a) spawn `node main.ts` as a child process with env (`PORT`, `PULSE_API_URL` pointing at a stub API, `PULSE_STATUS_HIDE_DETAILS`), (b) extract a small exported function (for example `startFromEnv(env)`) that `main.ts` calls, and test that. Assumption: prefer (b) if the refactor is minimal, since it must still fail when the env var is ignored. Either is acceptable. The plan must pick one. The test must go through `main.ts` code, not call `parseHideDetails` plus `createStatusServer` itself.
2. Media type check: accept `application/json` with parameters (`; charset=utf-8`), case-insensitive. Assumption: `application/*+json` is NOT accepted (the spec says `application/json`); a missing content-type header gives 502. Existing test mocks that return JSON through `new Response(...)` without a header (default `text/plain`) will break and need the header set; the plan should check `server.test.ts`, `server.privacy.test.ts` and `poller.test.ts`.
3. Scope of the 502: only a successful (2xx) upstream. Non-2xx keeps the existing generic status mapping (`API error`). Error body stays `{"error":"invalid API response"}` (generic, no upstream content).
4. Does the poller (browser side, `poller.ts`) need changes? Assumption: no, it only consumes the server's proxied responses.
5. Hide-details test values: unset (hidden, default), `true` (hidden), `false` (details visible). Assume the stub upstream returns checks with target/keyword/reason and the test asserts they are absent or present in the proxied JSON. The poller allow-list test (P3 remark that it passes on old code) needs no change unless the plan wants it to cover the startup path; not required by "Required behavior".
6. api docs: change the paths to `/api/uptime`, `/api/checks`, `/api/maintenance`, `/api/incidents?status=open|resolved`; replace "No other path is served" with a statement that no other API path is proxied (the page and static assets are also served). Check other mentions in api docs/README for the same wrong paths (the healthcheck `GET /checks` on the api's own port 3000 is correct and must stay).
7. Dependency: the two targets are independent; no `dependsOn` is needed. The api docs change is a docs-only PR.

## Assumptions
- Merged #164 behavior stays as is except the changes above.
- No new env variables or API routes.

## Derived acceptance check
- status: a stub upstream answering `200 text/html` with body `[]` through `/api/checks` yields `502 {"error":"invalid API response"}` (test fails on old code). `200 application/json; charset=utf-8` with valid JSON still yields 200 filtered JSON. An invalid JSON body with JSON content type still yields 502.
- status: the startup-level test runs the real `main.ts` path with `PULSE_STATUS_HIDE_DETAILS` unset, `true`, `false`; unset and `true` hide target/keyword/reason, `false` shows them. The test fails if `main.ts` ignores the variable (for example hard-coded `hideDetails`).
- api: `docs/install.md` names `/api/uptime`, `/api/checks`, `/api/maintenance`, `/api/incidents?status=open|resolved` and says no other API path is proxied; `npm test`/lint of both targets pass.
