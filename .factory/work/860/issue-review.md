# Issue review: API late request failures and result validation (#860)

## Decision

Ready for `plan`; no blocking question. One implementation target, `api`, is sufficient. No contract, kit, dependency-pin, shared-tooling, Factory-config or design change is needed.

Behavior change: yes
Unexpected failures after response headers have been sent will become visible through the existing error logger. Responses, validation outcomes and error privacy remain unchanged; documentation must describe the late-failure case and the result messages that are actually reachable.

Read [issue #860](https://github.com/lorenzh/pulse-meta/issues/860) and all its comments. At review time the only comment was the current Factory claim; there are no earlier product decisions to recover. The standing requirements in the issue body are binding.

## Inspected evidence

- Meta checkout: `9e55ea26346adbf913e2d7fe28f625175c278c53`. Read `AGENTS.md`, `README.md`, the Factory preamble and issue-review prompt, and the existing API context configuration.
- Read-only API checkout: `e084bde0a5bc199748ec5614ed604ae79b8454cf`, initially clean. Read its `AGENTS.md`, README, relevant source/tests, docs and tooling declarations. The implementation must record its own exact `BASE` before editing and refresh this inventory if its base differs.
- API `package.json` pins contract `1b5e7d3e268372a6241db05ae30272eab7299b10`. The available contract checkout is newer (`6370c25d79123f4b81f2482756b6d5487bebb88c`), so it is not proof of pinned behavior. The pinned Git object was unavailable locally; fetched and read the exact pinned [schema.ts](https://github.com/lorenzh/pulse-contract/blob/1b5e7d3e268372a6241db05ae30272eab7299b10/src/schema.ts), [validate.ts](https://github.com/lorenzh/pulse-contract/blob/1b5e7d3e268372a6241db05ae30272eab7299b10/src/validate.ts) and [validate-core.ts](https://github.com/lorenzh/pulse-contract/blob/1b5e7d3e268372a6241db05ae30272eab7299b10/src/validate-core.ts) through the GitHub read tools instead. No target clone was edited.
- `src/server.ts:972-993`: unexpected errors before headers are sent call `logError("request failed", err)` and return `500 {"error":"internal error"}`. The earlier `res.headersSent` branch destroys the response and returns without logging. `HttpError` and `ManualRouteError` are the existing expected-error classes.
- `src/server.ts:874-912,935-993` exposes injectable handlers and `logError` through `createApiServer`; no new production test seam or exported error helper is necessary. `src/start.ts:541-564` wires that hook to the existing JSON logger, with the original error stack/message in its `error` field.
- `src/server.ts:117-210`: own-accessor rejection and finite nonnegative latency rounding precede `validatePostResultRequest`; the API then rechecks several contract invariants before applying its own bounds, time windows and defaults. Construction projects known fields explicitly into the returned `Result`.
- Pinned contract `src/schema.ts:18-21,46-60,90-97,498-535` guarantees an object, a nonempty `checkId`, integer timestamp, the three result statuses, nullable integer `statusCode` 100..599, integer latency 0..2147483647, nullable reason of at most 1000 UTF-16 code units, optional string location, optional integer attempts >=1, and optional nullable integer certificate days. It does not cap attempts at 100, certificate days at +/-3000000, timestamp age/skew, or trimmed location length at 64. `validate.ts:165-169` delegates to that schema. `validate-core.ts` checks own data fields and returns the original input value on success, not a sanitized Zod projection.
- `src/server.validation.test.ts` already covers timestamp windows, reason length, attempts, latency bounds/rounding, accessors, status-code bounds, certificate days and HTTP ingestion. Many assertions only match a field name; new compatibility assertions should pin the actual error text and precedence. `src/server.target.test.ts` has the existing quiet malformed-target and once-logged pre-header 500 controls. Neither file was executed in this review.
- API requires Bun 1.4.0 (available here). `bunfig.toml` enables coverage with an 80% line threshold. `bun run check` runs lint, typecheck and the full tests. API dependencies are not installed in the read-only clone.

These are source observations and pinned-source verification. The issue's local `{status:204,logErrorCalls:0}` reproduction is reported evidence, not a reproduction performed in this state.

## Resolved scope questions and assumptions

1. **What to log.** Interpret “unexpected” using the existing `HttpError`/`ManualRouteError` distinction. Invoke the existing hook exactly once, with `"request failed"` and the original thrown value, for an unexpected failure whether headers are sent or not. Keep expected errors quiet in this hook, including after headers. Do not broaden this into access logging or a logging-format change. A throwing logger is outside scope; use the existing logger contract.
2. **What the client sees.** A late failure still destroys the response. Never attempt another status line, headers, JSON error body or recovery response after headers were sent. A completed 204 remains a bodyless 204; an incomplete response terminates. Before headers, preserve typed error mapping and the generic private 500 response. Do not add request targets, credentials, request bodies or config to logs or responses.
3. **Which validation to remove.** Remove post-contract checks of object shape, nonempty check id, allowed status, status-code shape/range, latency shape/range, and reason type/length. Timestamp integer/type checks, location type checks, attempts type/lower-bound checks and certificate-day type/integer checks are likewise guaranteed by the pinned validator; the API-specific parts of those checks must remain. Use the validated type at the trust boundary where helpful rather than retaining casts solely to repeat validation. Do not change contract schemas or their pin.
4. **Which validation to preserve.** Keep the own-accessor guard before copying; round only finite nonnegative latency before contract validation; keep timestamp skew based on the active check's interval capped at 60000 ms, the unknown/heartbeat fallback of 60000 ms, and the inclusive seven-day age window. Keep attempts <=100, certificate days in [-3000000,3000000], location trimming/case/64-character limit, missing/blank defaults and token-location assignment. Preserve the exact existing API-only error text, first-error order, known-field result projection, optional certificate-day presence, and attempts default of 1. Contract success does not mean unknown fields should be copied into the returned result.
5. **Order matters.** Contract rejection must still precede timestamp and API-only bounds. Among API rules the current order is timestamp, certificate days, attempts, location. Preserve auth/body failures, heartbeat refusal, location mismatch and unknown-check lookup order at the HTTP boundary. Keep one active-check lookup for a shape-valid request as in the existing HTTP certificate test; do not move it ahead of contract rejection.
6. **Documents.** This is an observable logging change, so README must change under API `AGENTS.md`. The issue's invalid reason message is literally in troubleshooting; REST documentation repeats the misleading validation sequence and links to it. Operations also needs its 500-only description corrected. The exact changed documentation set is `README.md`, `docs/rest-api.md`, `docs/troubleshooting.md`, `docs/operation.md`.
7. **Red tests versus compatibility tests.** New late-failure logging regressions must fail reliably on BASE for missing logging. Validation behavior is expressly unchanged: new parity/boundary tests are baseline controls and must pass there. Do not demand a failing validation test merely to prove removal of dead branches; source review proves the deletion. This distinction reconciles TDD with the requirement to preserve all result rejections.
8. **Task organization.** Prefer one cohesive API implementation task for the server, its tests and the four docs, using the exact seven-file list below. If breakdown splits it, keep the same aggregate scope, explicit per-task lists and all required scope gates; do not silently add files or omit README. No dependent feature or native blocked-by link is required by the inspected code.

## Documentation inventory

Searched API `README.md` and all `docs/*.md` for result validation, reason text, limits, rounding, timestamps, locations, unexpected failures, 500/internal-error responses and logging. Line numbers below refer to the inspected API base. Later states must retain this changed/unchanged classification and record final changed lines rather than only saying “docs updated.” Broad search hits about unrelated endpoint examples, rollups, startup or benchmark behavior are not permission to rewrite them.

| Document and base lines | Disposition and proving claim |
| --- | --- |
| `README.md:80` | **Changed:** extend the existing JSON-log paragraph to explain one error log for an unexpected request failure, including after headers, with termination and no second response. Keep its quiet malformed-target claim. |
| `docs/rest-api.md:52` | **Changed:** qualify generic 500 behavior as before headers; explain that a late failure is logged and closes the response instead. |
| `docs/rest-api.md:80` | **Changed:** contract errors precede timestamp windows, certificate-day bounds, attempts cap and location normalization/length. Remove the claim that API latency/reason checks run after contract validation. Include or link the actual contract reason-length message. |
| `docs/rest-api.md:68-69` | **Changed:** retain the exact latency/rounding and UTF-16 reason rules, but describe the bounds using shared contract `MAX_TIMER_MS` and `MAX_REASON_LENGTH`, without relying on API aliases removed with the duplicate checks. |
| `docs/rest-api.md:45-51,64-67,70-72,76-79,81-92,100-103` | **Unchanged and still true:** ErrorResponse shape, method/auth/body precedence, all remaining field limits, token location, heartbeat/404/204 outcomes, no storage on rejection, idempotence and security headers. |
| `docs/troubleshooting.md:83-90` | **Changed:** replace unreachable `reason must be at most 1000 characters` with `result.reason: must be null or a string of at most 1000 characters`; keep the separate wrong-type `result.reason: must be a string`. Distinguish contract errors from API bounds, including certificate-day shape versus range. Existing timestamp, attempts-cap, certificate-range and trimmed-location diagnostics remain verbatim. |
| `docs/troubleshooting.md:92-104,126-127` | **Unchanged and still true:** 401, heartbeat/location 403, unknown-check 404, method and body-size failures are unaffected. |
| `docs/operation.md:307` | **Changed:** `request failed` is once per unexpected failure; 500 applies before headers, and a late failure closes the already-started response. Preserve the existing `error` stack field description. |
| `docs/operation.md:90,181,293-295,300,320,324,332` | **Unchanged and still true:** served-history normalization, token/location equality, no access/path logging, heartbeat refusal, JSON format/levels, reserved log fields, secret handling, replay/idempotence and seven-day rejection remain intact. Other search hits at 42,57-75 concern rollups and performance, not this error path. |
| `docs/configuration.md:9-17,36-38,98-99,111,173` | **Unchanged and still true:** settings/defaults/log level, process exit codes, probe attempt semantics and both certificate/domain day bounds are unchanged. Other latency/retry hits describe checks-file settings rather than POST-result validation. Protect this file. |
| `docs/concepts.md:17,63-81,98-111` | **Unchanged and still true:** expiry status ownership, trimmed case-sensitive locations <=64, token binding, defaults, auth-before-validation, no write on rejection, uptime and latency aggregation remain unchanged. Protect this file. |
| `docs/install.md:15,29,55` | **Unchanged and still true:** token setup, probe production of results and network exposure advice are unaffected. Protect this file. |
| `docs/development.md:23,33,38-43,47` | **Unchanged and still true:** server owns error mapping, pinned contract, full check and coverage policy, loopback tests and documented bench tooling remain unchanged. This issue's instruction to avoid the Docker bench overrides using it for this task; it does not change the bench product or its docs. Protect this file. |
| `docs/index.md:3,5-11,15-18` | **Unchanged and still true:** API role and documentation/repository links remain correct. Protect this file. |

Changed documents also contain unaffected claims: keep them true during review. Whole-file protection applies to the five unchanged docs; claim-level preservation applies inside the four changed docs. Do not introduce a new docs/test command convention merely to run this issue's focused checks.

## Derived acceptance

### Late request failures

Use exported `createApiServer` with injected handlers and a recording `logError`; real HTTP only on `127.0.0.1` port 0. Use an in-memory database, fixed injected clock and event/promise synchronization. Do not export private handlers, mock globals/modules, or use arbitrary sleeps. Close listeners, sockets and databases in cleanup even after failure.

- **Completed response then unexpected failure:** a handler sends a bodyless 204 and throws/rejects. Assert one logger call, literal `request failed`, original error identity, the existing response status/body, response closure and no second answer. Synchronize failure observation before asserting the count; receiving the response alone is insufficient proof that the catch ran.
- **Started response then unexpected failure:** establish that headers are sent while the response is incomplete, then reject the injected handler. Assert one logger call and terminated response/connection, with no appended internal-error JSON or second status line. Use controlled events so connection termination is not mistaken for a test hang or ordinary completion.
- **Unexpected failure before headers:** retain generic `500 {"error":"internal error"}` and exactly one call with original error, with no stack/message in the response.
- **Expected errors stay quiet:** representative ordinary invalid-result/route errors and typed manual-route errors retain their mapping without this error log; a typed error after headers closes the response without a new answer or unexpected-error log. Use existing injectable paths/classes, not a new exported `HttpError` test seam.
- **Privacy and continued service:** the constant log message and client bytes do not acquire sentinels from request authorization, target/query or body. A later ordinary request still succeeds. Passing the original safe test error to the hook preserves current diagnostic behavior; this is not a demand to sanitize arbitrary exception stacks in a new logger.

The two new late unexpected-failure cases must fail on BASE for `0` log calls versus expected `1`, three runs each, then pass with the fix. A coverage/configuration/import failure or unrelated transport race does not establish the regression.

### Result compatibility and boundaries

Extend `src/server.validation.test.ts` with explicit compatibility assertions through `validateResult` and authenticated HTTP POSTs, using the pinned `validatePostResultRequest` for differential checks and literals for the documented messages. Vary one invalid field at a time and include a few multiple-invalid cases for precedence.

- Contract/API parity for empty check id, invalid status, out-of-range or wrongly typed status code, oversized/non-string reason, invalid latency, noninteger timestamp and invalid optional field types. Compare the whole error text, including `result.` path, then HTTP 400 `ErrorResponse`. An oversized reason must be exactly `result.reason: must be null or a string of at most 1000 characters`; the old API-only reason-length message must not be presented as reachable.
- Reason null, empty, 1000/1001 UTF-16 code units, including a supplementary-character boundary; latency 0, 2147483647, negative/nonfinite/wrong-type inputs and just-over-cap rounded input; finite nonnegative fractions retain `Math.round` behavior (including .5). Compare fractional compatibility after the same pre-validation rounding; the contract alone is expected to reject an unrounded fraction. Do not represent NaN/Infinity as JSON numbers in HTTP tests; exercise them in direct validation and malformed JSON separately if needed.
- API-only attempts 100 accepted and 101 rejected with `attempts must be an integer from 1 to 100`; direct contract accepts 101. Omitted attempts defaults to 1; invalid type/lower bound remains a contract error.
- API-only certificate-day endpoints +/-3000000 accepted, +/-3000001 rejected with `certDaysLeft must be null or an integer from -3000000 to 3000000`; contract accepts the out-of-API-range integers. Preserve null and absence distinctly; bad type/fraction remains a contract error.
- Timestamp age at exactly seven days accepted, one millisecond older rejected; future at exactly the per-check/capped limit accepted and one millisecond beyond rejected; preserve unknown/heartbeat fallback. Use a sufficiently large fixed clock so the age cases are unambiguous. Preserve timestamp-before-bounds precedence.
- Location missing/blank/default handling, trimming/case, exactly 64 characters after trim accepted and 65 rejected, token assignment and mismatch refusal unchanged. Direct validation defaults to `default`; HTTP ingestion uses the authenticated token's location. An invalid type is still rejected by the contract.
- Preserve own-accessor rejection with zero getter calls, explicit known-field output, optional-field presence, one active-check lookup for a shape-valid request, and no check lookup before shape rejection. Auth, heartbeat refusal, unknown-id response, idempotence and no ingestion for rejected results remain unchanged. Do not change storage or auth modules to satisfy these controls.

All new validation compatibility cases should already pass on BASE. Review the server diff against the pinned schema to prove that duplicate branches/constants/imports are removed and API-specific rules remain; do not create a fake behavior difference or test private source layout.

### Exact files and protection

The API plan and task `Files:` list is exactly:

- `src/server.ts`
- `src/server.errors.test.ts` (new)
- `src/server.validation.test.ts`
- `README.md`
- `docs/rest-api.md`
- `docs/troubleshooting.md`
- `docs/operation.md`

The plan must list the same four documentation files and matching acceptance. No README exception is applicable. Keep all other API files unchanged, including dependency pins/lockfile, schemas, logger wiring, service/storage, location constants and all tooling/CI/coverage configuration. No implementation artifacts belong in API `.factory/`.

In **every task's acceptance**, record the exact implementation `BASE` and enforce these independent final gates after the last commit:

1. Compare `git diff --name-only "$BASE" HEAD` with the exact allowed list. Reject any outside path; ensure all required production/test/doc changes for the task are present, rather than accepting an empty diff as completion. Across tasks the union must be the seven paths above.
2. `git diff --name-only --cached` is empty.
3. `git diff --name-only` is empty.
4. `git status --porcelain` is empty, including untracked files.
5. `git diff --exit-code "$BASE" HEAD -- src/start.ts src/main.ts src/service.ts src/state.ts src/db.ts src/migrations.ts src/metrics.ts src/tokens.ts src/token-store.ts src/admin-routes.ts src/manual-incident-routes.ts src/location-limits.ts AGENTS.md CLAUDE.md package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github Dockerfile .dockerignore scripts bench docs/configuration.md docs/concepts.md docs/install.md docs/development.md docs/index.md` exits 0. The exhaustive allowlist additionally protects every path not permitted, not just these named protections.

Prove the actual gate in a disposable local fixture repository, not by modifying protected API paths. Show a clean allowed committed change passing; protected changes separately in worktree, index and commits failing; and both restored-worktree cases failing (stage a protected change, then restore only its worktree bytes to BASE; commit a protected change, then restore only its worktree bytes to BASE). Also reject an allowed uncommitted edit and an untracked file. Report each case. A worktree-only comparison cannot detect a protected change hidden in the index/history.

### Verification and evidence to supply later

- Before a plan labels any baseline control as passing, run that exact command three times at recorded BASE, each exit 0 with the expected pass count. Record commands and counts, not exact coverage percentages as expectations. No baseline test command is certified passing by this review. If a file proves flaky, exclude it from mandatory passing baseline controls and report why; do not remove it from the required final full check.
- Focused tests must use an empty config via `--config` (for example `/dev/null` only after verifying Bun accepts it on BASE), so coverage is disabled for those runs. Verify the override itself on BASE and report pass counts. Preserve the unchanged repository config and its 80% line threshold for the full `bun run check`; no exact coverage number is an expectation.
- Demonstrate late-failure red/green evidence three times for the intended reason, and validation/ordinary-error compatibility controls three times on BASE before relying on them. Later branch runs must have the expected pass count, no failures and exit 0.
- Final `bun run check` must exit 0 with lint, typecheck and all tests passing under the unchanged repository coverage policy. Do not skip hooks or weaken lint/type/coverage/CI rules. Report unrelated baseline failures honestly rather than presenting them as caused by this fix or as successful controls.
- Report test CPU as information from comparable interleaved base/branch runs (at least three pairs), the exact common test command/workload, per-run user+system CPU, aggregate delta and shared-machine noise caveat. Separate new-test overhead from claims about server performance. Do not run the Docker bench, per #834 and the issue instruction.
- Under API's user-visible-change convention, start the actual service with `bun start`, isolated valid configuration/database and loopback port, exercise a safe result-validation request and an ordinary successful request, then shut it down. Report command and result. The injected-handler regression is the way to reproduce a late failure; do not add a production fault-injection endpoint for a manual start.
- The new test file may contain no explanatory comments except one line naming the class and expected outcome. Prefer zero added comments elsewhere unless necessary. Read every added line, including inline directives/comments, and list every added comment in the PR body; write `none` only if that full read confirms none. Preserve existing comments unless the changed code makes them false.
- Handoff evidence includes BASE, exact final file list, pinned-validator comparison, test titles and red/green outcomes, three-run baseline controls, focused counts, full check, manual start, CPU report, doc line inventory, comment inventory, and separate committed/index/worktree/status/protected-path gates plus fixture results.

## Review limitations and recovered lookups

This state writes only this issue-review artifact. No tests, dependency installation, manual service run, CPU measurement or scope fixture was performed; these remain explicit planning/build obligations, not claimed successes. The read-only API clone has no `node_modules`, so installing into it would violate this state's repository boundary.

Initial listing found no work directory for 860; creating this artifact creates the directory. The local pinned-contract object lookup failed and was resolved by reading the exact pin through GitHub. A guessed `src/bootstrap.ts` path did not exist; source search located the actual wiring in `src/start.ts`. Optional managed-environment status tooling was not exposed. These lookups leave no unresolved blocker.

No question requires a `needs-input` hold.
