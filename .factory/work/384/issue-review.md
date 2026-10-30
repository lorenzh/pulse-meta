# Issue review #384

Verdict: specifiable. No blocking question.

## Findings in the current code
- probe `src/client.ts` `resolveHeaders` reads `env[raw.env]` with no prefix check. The skip log is built at ~line 160 as `skipping check <id>: header <Name> env <VAR> <problem>`.
- probe `src/check.ts` `attemptHttp` calls `deps.fetch(check.url, {...})` with default redirect policy (`follow`). The check has no redirect handling.
- Existing probe tests use `SVC_TOKEN` (`client.http-options.test.ts`) and a one-server redirect test (`check.http-options.test.ts`, 302 to `/missing`, headers-free check, must stay as is).
- api uses `SVC_TOKEN` / `EXAMPLE_API_TOKEN` in more places than the issue lists: `checks.example.json`, `compose.e2e.yaml` (lines ~28-40), `compose/e2e/target.mjs`, `scripts/compose-e2e.sh` (~323, 342), `src/config.request.test.ts`, `docs/configuration.md`. `website/test/fixtures/api-checks.example.json` is a copy of the api example (not a target of this issue).

## Open points (to settle in the plan, none blocks)
1. **Redirect mechanism.** Use `redirect: "manual"` and follow hops in the probe (needed to compare origins and to stop before sending). Hop limit: assume 20 (fetch default), over the limit ends `down`. Each hop re-sends the same headers only after the origin check passes.
2. **"Sets headers or a body".** Assume: `headers` non-empty or `body` defined. A user-agent alone does not count.
3. **Non-GET 301/302/303.** Not followed, `down` with the status and a reason. 307/308 keep method and body: assume followed under the same-origin and no-downgrade rule. HEAD counts as non-GET, so 301/302/303 on HEAD also ends `down` (the issue says "non-GET"). Assumption: this applies only to checks with headers or body; a headers-free HEAD/POST check keeps today's behavior.
4. **Status vs. expectedStatus.** If `expectedStatus` includes 301/302/303 (e.g. `[302]`), a non-followed redirect should probably be judged normally. Assumption: when the redirect status is in `expectedStatus` the check is judged as today (no follow); otherwise the redirect rule applies. The plan must state this explicitly.
5. **Origin compare.** scheme+host+port after URL normalization (default ports equal). http to https on the same host is a different origin, so it ends `down`. The reason names the target origin only (no path, query, userinfo, which could hold secrets). Relative `Location` is resolved against the current URL; an unparsable `Location` ends `down` with a generic reason.
6. **Reason text for the log/result.** Contract limits on `reason` length/format must be checked by the plan. Sentinel test covers log lines and result reasons.
7. **Env prefix rule.** `PULSE_HEADER_` is a case-sensitive prefix. The bare `PULSE_HEADER_` (empty suffix) matches the contract `ENV_NAME` regex? Plan decides; assume prefix alone is treated as allowed only if it passes `ENV_NAME` and is set. Log text: `skipping check <id>: header <Name> env <VAR> must start with PULSE_HEADER_` (names only), one line per skipped check. The check happens before the env lookup, so a forbidden name never reads the environment.
8. **Contract.** `contract` is not a listed target. The `ENV_NAME` schema stays as is (the api still accepts other names; the probe skips). The contract doc comment at `schema.ts` ~238 mentions env refs; assume no contract change (listing contract would need a release and is outside "Targets"). Plan may note that the rule lives in the probe only.
9. **api compose/e2e.** `compose.e2e.yaml`, `target.mjs`, `compose-e2e.sh` and `config.request.test.ts` must follow the rename, otherwise the e2e breaks. The issue says "compose files if they set such variables": they do. `target.mjs` reads `process.env.SVC_TOKEN` in the target container (its own variable, not a probe header reference); the plan decides whether to rename only the probe-side variable. `server.probe-checks.test.ts` `SVC_TOKEN_SENTINEL` is a test name only; rename for consistency optional.
10. **Migration/release notes.** The PR text is not a repo file; the plan puts the migration text in probe `docs/configuration.md` and the PR body template.
11. **Mutation proof.** Each new test must fail on old code; the PR body contains the failing output (#324).
12. **Order.** probe and api are independent (api is docs/examples/tests only). #380 stays blocked by this issue as stated.
13. **Docs api.** Add the prefix rule, redirect rule, clear-text note and whole-value replacement note to api `docs/configuration.md`; probe doc gets the same plus Migration.
14. **Out of scope**: pulse-meta README line, website fixture copy (it mirrors the api example; a person or its own sync handles it; plan may mention).

## Assumptions
- Same-origin redirect with headers: followed, check judged on the final response.
- Checks without headers/body: unchanged, `redirect: "follow"`.
- No TLS retry or cookie handling changes.

## Acceptance check (derived)
Probe tests (real local servers, no internet):
1. `{"env":"PULSE_PROBE_TOKEN"}` and `{"env":"HOME"}` are skipped with one log line each naming the variable and the prefix rule; `{"env":"PULSE_HEADER_X"}` resolves and is sent.
2. `X-Api-Key` check, server A redirects to server B (other port): result `down`, reason names B's origin, B logs zero requests.
3. Same with https A redirecting to http B (self-signed local https server; test trusts it via the existing test mechanism).
4. Same-origin redirect with the header: followed, `up`.
5. POST with 302: `down`, status 302, server records no second request.
6. Sentinel: header value, body and env value appear in no log line or result reason.
7. Headers-free redirect test unchanged and green.
8. Every new test fails against the old code (mutation output in the PR).
api: `checks.example.json`, docs, compose and e2e use `PULSE_HEADER_*`; `config.examples.test.ts` green; CI green in probe and api.
