# Spec #384: probe env header secrets only from `PULSE_HEADER_` variables; no secret headers across origins

## Goal
A probe never sends one of its own environment variables unless the operator named it for that purpose (`PULSE_HEADER_` prefix), and never sends a secret header or body to another origin or over plain http after a redirect.

## Scope
- probe: prefix rule in `resolveHeaders` (`src/client.ts`), manual redirect handling in `attemptHttp` (`src/check.ts`), tests, docs incl. Migration note.
- api: docs, examples, compose/e2e files and tests renamed to `PULSE_HEADER_*`; no runtime change.
- meta README line: by a person after the merge.

## Non-goals
No allow-list setting, no secret store, no change to `GET /probe/checks`, no change to the contract (`ENV_NAME` stays; the rule lives in the probe only), no change for checks without headers/body, no other probe findings. `website/test/fixtures/api-checks.example.json` (copy of the api example) is not touched here.

## Decisions (from the issue review's open points)
1. **Prefix**: case-sensitive `PULSE_HEADER_`, fixed. Checked before any env lookup, so a forbidden name never reads the environment. The bare `PULSE_HEADER_` is treated like any other name (set and valid header value required; contract `ENV_NAME` governs what reaches the probe).
2. **Skip log**: unchanged format `skipping check <id>: header <Name> env <VAR> <problem>`, with problem `must start with PULSE_HEADER_`. Names only, never values.
3. **Secret-bearing check**: `headers` has at least one entry or `body` is defined. The probe's own user-agent does not count. Other checks keep `redirect: "follow"` exactly as today.
4. **Redirect mechanism**: for secret-bearing checks use `redirect: "manual"`, and follow hops in the probe. Hop limit 20 (as fetch); more ends `down` with reason `too many redirects`. Each hop gets a fresh timeout signal share: the existing single signal covers the whole run.
5. **Hop rules** (3xx with a `Location`, status in 301,302,303,307,308):
   - If the status is in the check's `expectedStatus`, it is judged as today (not followed).
   - 301/302/303 with a method other than GET: not followed; `down`, status code kept, reason `HTTP <status> redirect not followed for <METHOD>`. (HEAD counts as non-GET.)
   - Otherwise resolve `Location` against the current URL. Unparsable: `down`, reason `redirect to invalid location`.
   - Target origin (scheme, host, port, default ports normalized) differs from the current one, or the hop goes https to http: `down`, status code kept, reason `redirect to <origin> not followed` (origin only: no path, query or userinfo; no header values). http to https on the same host is a different origin, so also `down`.
   - Same origin: follow with same method, headers and body (307/308); 301/302/303 here are GET only, which already follow with GET and the same headers (body is none for GET).
   - A 3xx without `Location` is judged as a normal response by `expectedStatus`.
   Each hop's body is cancelled. Final response is judged as today (status, keyword, jsonAssert).
6. No log line or result reason may contain a header value, body or env value.

## Risks
- Breaking change for configs that reference other variable names: checks are skipped until renamed. Mitigation: Migration note, release notes.
- Old tests using `SVC_TOKEN` must be renamed.
- Existing headers-free redirect test (302 to `/missing`) must stay green unchanged.

## Acceptance evidence
- `{"env":"PULSE_PROBE_TOKEN"}` and `{"env":"HOME"}`: check skipped, one log line each naming the variable and the prefix rule; `{"env":"PULSE_HEADER_X"}` resolves and is sent.
- `X-Api-Key` check redirected to another origin (two local servers) ends `down`, reason names the second origin; the second server receives zero requests. Same for https to http (local https and http servers, no internet).
- Same-origin redirect with the header: followed, `up`.
- POST check answered with 302: `down`, status 302, server sees one request only.
- Sentinel test: header value, body and env value appear in no log line or result reason.
- Every new test fails on the old code: run the mutation (revert the change) and paste the failing output into the PR (#324).
- CI green in probe and api; api `config.examples.test.ts` green.

## Repository: probe
Files:
- `src/client.ts` `resolveHeaders`: reject names without the `PULSE_HEADER_` prefix before reading `env`; problem `must start with PULSE_HEADER_`.
- `src/check.ts` `attemptHttp`: redirect handling per decisions 3-5 (helper for the hop loop; keep `resolvedHeaders`).
- Tests: `src/client.http-options.test.ts` (rename `SVC_TOKEN` to `PULSE_HEADER_SVC_TOKEN`; add prefix tests for `PULSE_PROBE_TOKEN`, `HOME`, `PULSE_HEADER_X`; log line has names only), `src/check.http-options.test.ts` or a new `check.redirect.test.ts` (cross-origin, https to http, same-origin, POST 302, HEAD 302, 307 same-origin keeps body, expectedStatus `[302]`, hop limit, invalid Location, headers-free redirect unchanged, sentinel).
- `docs/configuration.md`: prefix rule; redirect rule; literal header values and bodies are clear text in the checks file and api database; an env reference replaces the whole header value (a bearer token needs the scheme in the variable); a "Migration" section (rename the variable in every probe location and in the checks file, e.g. `SVC_TOKEN` to `PULSE_HEADER_SVC_TOKEN`); examples use `PULSE_HEADER_SVC_TOKEN`.
Done when: probe CI (lint, typecheck, tests) is green; PR body contains release notes saying the same as the Migration note, a "breaking" mark, and the mutation output for each new test.

## Repository: api
Docs, examples, e2e only; no `src` runtime change; independent of the probe release.
Files:
- `checks.example.json`: `EXAMPLE_API_TOKEN` to `PULSE_HEADER_EXAMPLE_API_TOKEN`.
- `docs/configuration.md`: same rules as the probe doc (prefix, redirect rule, clear text, whole-value replacement), examples renamed.
- `compose.e2e.yaml`, `compose/e2e/target.mjs`, `scripts/compose-e2e.sh`: rename the probe-side `SVC_TOKEN` to `PULSE_HEADER_SVC_TOKEN` (the probe container variable and the checks reference); `target.mjs` keeps its own logic but must read whichever name the compose file gives it consistently.
- `src/config.request.test.ts`, `src/server.probe-checks.test.ts` (sentinel name optional): rename.
- Any other compose file that sets such a variable.
Done when: `config.examples.test.ts` and CI are green; `grep -r "EXAMPLE_API_TOKEN\|SVC_TOKEN"` shows only prefixed names.
