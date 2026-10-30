# Issue review: #325 HTTP checks: method, headers, body, expected status, JSON assertions

Verdict: specifiable. No blocking question; the open points below need a decision in the plan.

## Findings from the current code
- The probe fetches its checks from the api `GET /checks` (probe `client.ts`). That endpoint has no auth (`api/src/server.ts`) and is also what the public status proxy reads. The probe has no checks file.
- The issue requires both "the probe resolves `{"env": ...}` header values" and "`GET /checks` never serves header values or bodies". Together these contradict as written: the probe can only learn headers and body from `GET /checks`, or from another channel.
- The probe now treats any 2xx as up and reads at most 1 MiB for `keyword` (`probe/src/check.ts`). `keyword` is stored in the api db (`checks.keyword`) and allow-listed in `status/src/api-filter.ts`.
- `compose-e2e` is not in this repo. It lives in the api repo (`api/compose`, `api/.github/workflows/ci.yml`).

## Open points (plan must decide)
1. **Delivery channel to the probe** (main point). Options:
   a. New authenticated probe-only endpoint in the api (probe token, e.g. `GET /probe/checks`) that includes headers and body. `GET /checks` stays public and redacted. Secrets live in the api env (env refs resolved by the api), and the api sends resolved values to the probe over the token channel.
   b. Probe has its own secret file or env (`PULSE_PROBE_SECRETS`), keyed by check id. The api serves only an env reference name or a flag.
   c. Api serves env reference names (not values) in `GET /checks`; the probe resolves them from its own env. Body is not secret here but must not be public either.
   The issue says "resolved by the probe", which favors (c) for headers. A body still needs a non-public channel, so (a) or (c) needs one. Recommended: (c) plus a probe-authenticated endpoint for the body, or (a) alone. Plan must state the trust model. Multiple probe locations each need the env var set (c) or none (a).
2. **Env reference names in public output.** Even the env var name is somewhat private; the allow-list must drop it. The same applies to a literal header value in the checks file.
3. **Contract shape.** Header value is `string | {env: string}`. The schema must define: header name validation (RFC 9110 token), forbidden names (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`), duplicates differing in case, maximum count (suggest 20), name and value size (suggest 256 B name, 4 KiB value, 16 KiB total), body limit (suggest 64 KiB), env var name pattern. Shape of the served form (redacted) vs the config form vs the probe form likely needs separate schemas.
4. **`expectedStatus` format.** A list of integers 100-599 and strings `"200-299"`; `lo <= hi`, both within 100-599; maximum list length; default 2xx. Redirects: the probe follows redirects as today, so the status judged is the final one; confirm.
5. **`jsonAssert` syntax.** RFC 6901 pointer only (simplest, recommended). `equals` with any JSON value (deep equality) or `exists: true`; `exists` and `equals` are mutually exclusive; `exists: false` is out of scope unless wanted. Maximum assertion count. Empty pointer `""` = whole document. Pointer to a number vs string: strict type equality.
6. **Body cap interaction.** JSON must be parsed from at most 1 MiB; a body above the cap means `json: invalid body` or a distinct reason (`json: body too large`); decide. `keyword` and `jsonAssert` share one read of the body. HEAD has no body, so `jsonAssert` and `keyword` must be rejected with HEAD. OPTIONS/DELETE bodies allowed.
7. **Reason precision vs secrets.** Reasons print the actual value in `json /status: expected "ok", got "degraded"`. The response value may itself be secret-ish; truncate (e.g. 80 chars) and say that response data, not request secrets, is quoted. Reasons are stored in results and served publicly, so a bound is required.
8. **Database and migration.** Api stores checks in sqlite columns; new fields need columns/migration (`addCheckColumn`) and clearing when removed from the file, as for `keyword`. Secrets at rest in the db: decide (prefer not to store resolved values; store only references or keep them in memory from the file).
9. **Status "details".** Status shows method and expected status only when details are shown. `method` and `expectedStatus` must be allow-listed in `api-filter.ts`; default values (GET, 2xx) are hidden. Define how hidden targets behave (nothing new, as for `keyword`).
10. **Method vs body rules.** Body not allowed with GET/HEAD (validated in contract and api). Default `Content-Type` for a body: none unless the user sets it; decide (suggest none).
11. **Compatibility and versions.** Older probes ignore or reject new fields (probe skips invalid checks); contract version bump and a rollout order (contract, probe/status, api last, as the issue says) keep this safe. An old probe must not run a POST check as a plain GET: plan should make unknown-field handling strict or version-gated.
12. **Heartbeat/TLS checks** must reject all new fields (`z.never`, like `keyword`).
13. **Target scope.** `config`, `kit`, `notify` are untouched unless they validate checks; plan should confirm by reading them. Docs in `contract/docs`, `api/docs`, `probe/docs`, `status/docs`.

## Assumptions
- Methods and defaults as in the issue; unknown methods are rejected; method is case-sensitive upper case.
- Secret grep tests use a unique sentinel for header value and body and assert absence in logs, `/metrics`, `GET /checks` and status proxy output.
- Each test must fail on the old code (the old code ignores or rejects the new fields).
- No scripting, multi-step checks or TLS client certs.

## Derived acceptance check
Run the `compose-e2e` stack with a local target and one HTTP check: `POST`, a JSON body, an `Authorization` header from env, `expectedStatus: [200]`, and `jsonAssert` `/status equals "ok"`.
- The check goes up; with the target returning `{"status":"degraded"}` it goes down with reason `json /status: expected "ok", got "degraded"`; with a 503 it goes down with `HTTP 503 not in 200`; with a non-JSON body it goes down with `json: invalid body`.
- The sentinel token and body do not appear in probe/api logs, `/metrics`, `GET /checks`, or the status page and its proxy output; the status page with details shows at most method and expected status.
- Tests in contract, probe, api and status cover each option and the secret handling.
