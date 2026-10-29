# Spec #179: status page non-JSON upstream answers, wrong /api paths in api docs

Follow-up of #164 (`.factory/work/164/plan.md`). Review of lorenzh/pulse-status#23 and lorenzh/pulse-api#27 found two P2 errors and one test gap. Everything else from #164 stays as merged. Details of the review: `.factory/work/179/issue-review.md`.

## Goal
The status page proxy never forwards a non-JSON upstream answer as JSON, the api install docs name the URLs that work, and the `PULSE_STATUS_HIDE_DETAILS` setting is proven at startup level.

## Scope
- `status`: content-type check in the proxy, startup-level test, updated test mocks.
- `api`: docs only.

## Non-goals
- No contract change, no new env variables or API routes, no poller (`poller.ts`) change.
- No change to the non-2xx mapping (`{"error":"API error"}` with the upstream status) or to the 404/405 handling.
- The api healthcheck `GET /checks` on port 3000 stays (it is correct).

## Required behavior
- A 2xx upstream response is accepted only if its media type is `application/json`: compared case-insensitively, parameters such as `; charset=utf-8` allowed, `application/*+json` and a missing header not accepted. Otherwise the proxy answers `502 {"error":"invalid API response"}` (generic, no upstream content). An unparsable body with a JSON media type keeps the same 502.
- A startup-level test runs the real `main.ts` path with `PULSE_STATUS_HIDE_DETAILS` unset, `true` and `false`.
- api docs name `/api/uptime`, `/api/checks`, `/api/maintenance`, `/api/incidents?status=open|resolved` and say that no other API path is proxied.

## Risks
- Existing test mocks that build `new Response(json)` without a content-type header default to `text/plain` and fail after the check; they need `content-type: application/json`.
- Extracting a start function from `main.ts` must not change its behavior (error message, exit code 1, log line).

## Acceptance evidence
- status: stub upstream `200 text/html` body `[]` via `/api/checks` gives `502 {"error":"invalid API response"}`; the test fails on old code. `200 application/json; charset=utf-8` with valid JSON gives 200 filtered JSON; invalid JSON with JSON type gives 502.
- status: the startup test passes for unset/`true` (target, keyword, reason absent) and `false` (present), and fails if `main.ts` ignores the variable (for example hard-coded `hideDetails`).
- api: `docs/install.md` as above.
- `npm test` and lint of both targets pass.

## Repository: status
- `src/server.ts` (`proxyApi`): after the `upstream.ok` check and before `JSON.parse`, read the `content-type` header of the upstream response; if its media type (part before `;`, trimmed, lower-cased) is not `application/json`, answer `502 {"error":"invalid API response"}`.
- `src/main.ts`: extract the env handling into an exported function, for example `startFromEnv(env: NodeJS.ProcessEnv)` in a new `src/start.ts` (returns the `Server`, or the options it built; keeps the try/catch, log line and `process.exit(1)` in `main.ts`). It reads `PULSE_STATUS_HIDE_DETAILS` via `parseHideDetails` and every other variable as today. `main.ts` only calls it with `process.env` and listens. Do not spawn a process in the test.
- Tests:
  - `server.test.ts`: regression tests for `text/html` body `[]`, missing content-type, `application/json; charset=utf-8` accepted, uppercase accepted, invalid JSON with JSON type. The `text/html` test fails on old code.
  - New `src/start.test.ts`: stub upstream API (own `http` server, or injected `fetch` if `startFromEnv` takes one) returning checks with target, keyword, reason and JSON content type; call `startFromEnv` with `PULSE_API_URL` and `PULSE_STATUS_HIDE_DETAILS` unset, `true`, `false`, listen on port 0, fetch `/api/checks`, assert hidden, hidden, visible. The test must go through the extracted function that `main.ts` uses, so hard-coding or dropping `hideDetails` there fails it. Close all servers after each case.
  - Add `content-type: application/json` to JSON mocks in `server.test.ts`, `server.privacy.test.ts` and `poller.test.ts` where a `Response` is built without it.
- Docs: if the pulse-status README or docs describe the proxy, add that non-JSON upstream answers give a generic 502.
- Checks: the repository's test, lint and type-check commands (see its `AGENTS.md`) pass.
- Done when: the evidence above holds for status.

## Repository: api
- `docs/install.md` (~line 51): replace `GET /uptime`, `/checks`, `/maintenance` and `/incidents?status=open|resolved` with the `/api/...` forms. Replace "No other path is served." with a statement that no other API path is proxied (the status page `/` and its static assets are served as well).
- Grep `docs/` and `README.md` for the same wrong status-page paths on port 8080 and fix them. Leave the api's own `GET /checks` healthcheck on port 3000 and the API route docs as they are.
- Checks: the repository's test/lint (formatting of markdown, if any) pass.
- Done when: `docs/install.md` names the `/api/...` paths and the changed sentence.
