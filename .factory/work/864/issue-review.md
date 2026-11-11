# Issue review: #864

Ready for `plan`. No question blocks specification. The supplied comments contain decisions from earlier spec runs; retain those decisions subject to the manager's added disclosure, scope-verification and documentation requirements. This fresh checkout has no previous `.factory/work/864` artifacts, so later states must write the plan and tasks here rather than assume the previously reported files exist.

## Disclosure boundary

This is a public security change covering security-contract-2026-11-03-1 (P2) and security-contract-2026-11-03-3, -4 and -5 (P3). The locations are contract `src/client.ts` and `src/version.ts`, plus their committed distribution files. The classes are response decompression before effective memory limiting, unrestricted read redirects, and upstream text disclosure in diagnostics. The impacts are process memory exhaustion, requests reaching unintended destinations or transport downgrades, and untrusted body/header text entering errors. The fix direction is to prevent eager decompression, refuse read redirects, and replace the two diagnostic texts with constants.

The issue review, plan, task acceptance, evidence summaries and PR text must stay at location, class, impact and fix direction. Name security regression cases only by title, class, expected outcome and budget. Do not copy the earlier comments' fixture details into those artifacts. Include no working payload, construction recipe, reproduction command, crafted wire header, or response-generation parameters. Tests create their security inputs at runtime inside test code; public evidence reports test titles and outcomes without printing those inputs. The manager's disclosure requirement supersedes earlier requests to describe fixture construction in prose.

## Inspection and current behavior

Read meta `AGENTS.md`, `README.md`, the issue-review prompt, approved-package guidance, the supplied issue comments, and the affected targets' `AGENTS.md` files. Inspected the context clones directly. Recorded revisions for this review:

| Repository | Inspected HEAD |
| --- | --- |
| contract | `1b5e7d3e268372a6241db05ae30272eab7299b10` |
| probe | `9490141ef9e92044808c70bb8200db3d497d1060` |
| status | `b7dfc7c4f54934e747f00ad90059bc23feeb7127` |
| notify | `dde5261fca1c5eeaae6d1282387f7da9dbdda165` |
| console | `40c271e1e2a47844fb7cab8ec345d08d7fe07082` |
| api | `515031bd3fd2aa6b8993e325b24ab08f4a3510d6` |

These revisions identify inspected context, not the implementation base of future child branches. Each task must record its actual implementation base separately.

- Contract `src/client.ts:76–101` counts response stream bytes, but neither fetch path disables runtime decompression. The memory exposure concerns work performed by the runtime before this reader can enforce its cap; checking only the reader or the declared length is insufficient evidence of a fix.
- `exchange` at `src/client.ts:125–153` leaves the redirect policy unset. `requestExchange` at `303–322` already requests manual redirects. Both paths share `readText` and `parseBody`; write responses, including non-success responses, therefore belong in the compression coverage.
- `parseBody` at `104–123` returns the JSON parser's exception message. `checkWireVersion` at `src/version.ts:16–27` incorporates the received header in mismatch text. That helper also appears in HTTP errors and write-response metadata; changing only the top-level `wire-mismatch` result would leave disclosure paths.
- `requestBody` at `src/client.ts:265–300` intentionally exposes a bounded `ErrorResponse.error` string for eligible non-2xx write responses. This is a separate documented behavior from the invalid-JSON and wire-mismatch diagnostics.
- Contract is package version `2.5.1`, wire version `1`. Its AGENTS requires rebuilding and committing `dist/`. The client promises web-API compatibility; adding a production `node:` or Bun import would violate that boundary.
- Probe `src/client.ts:303–309` uses `fetchJson` for API check loading, with authenticated and older-API fallback paths. Its current contract pin predates the inspected contract HEAD. Probe's monitoring of user-configured HTTP destinations is separate behavior and must not be changed by API-read hardening.
- Status uses `fetchJson` in server proxy/readiness code and its browser poller (`src/server.ts:419`, `src/api-poll.ts:24`, `src/poller.ts:235,328`). Its README and `server.ts` contract-module allowlist confirm that the browser runs the shared client. Browser compatibility requires runtime evidence; rejecting every compressed browser answer is not acceptable. Existing settings-client redirect guards remain in place.
- Notify `src/api.ts:147–165` already enforces manual redirects and maps parser/wire errors to fixed application text. Its service reads also enforce redirects. Preserve the existing guards and their tests rather than remove them after the pin update. The issue's reference to earlier notify hardening is context, not a request to redo that work.
- Console uses `fetchJson` through `src/api-read.ts` and `src/connection-test.ts`, and uses `requestJson` for writes. Its read wrappers already enforce manual redirects. It still adopts the shared compression and diagnostic fixes through its contract pin.
- Source searches found no `fetchJson` or `requestJson` calls in API. Retain the prior decision to leave its contract pin unchanged. No implementation target is needed for API, kit, config, website, deploy or agent on the inspected behavior.
- All five affected targets require a same-change README update for behavior changes. Console additionally requires `docs/configuration.md`. A dependency adoption that changes response handling is a behavior change even when consumer production source stays identical.

## Decisions carried forward

1. **Compression:** retain the prior runtime-specific direction: both client functions request `accept-encoding: identity` and pass `decompress: false` to the injected fetch. Detect Bun through its global without a production runtime import. Under Bun, reject unsupported non-identity response encoding before reading the body. Preserve bounded decoded-stream reads in Node and browsers, including valid compressed browser responses. Request preference alone is not a safety boundary. Use existing error variants: fixed-cause `network` on the applicable successful-response path; non-2xx writes remain `http` without a body-derived message when encoding is refused.
2. **Redirects:** add `redirect: "manual"` to `fetchJson` and preserve it in `requestJson`. Refuse all read redirects, including same-origin, cross-origin and HTTPS-to-HTTP. Server runtimes return an `http` error for the received 3xx; browser manual redirects may surface as opaque status `0`, also an `http` error. No destination request is permitted.
3. **Fixed text:** invalid JSON returns exactly `response body is not valid JSON`. Wire mismatch text is exactly `x-pulse-contract: unsupported wire version, expected 1`. Fix the shared wire helper so nested HTTP/write metadata uses the same safe text. Preserve absent/current wire handling and the wire version.
4. **Write compatibility:** preserve the bounded, intentional non-2xx `ErrorResponse.error` feature for otherwise supported responses. Do not reinterpret the request as removing all server-supplied application error messages, validator diagnostics, caller abort reasons or network causes. The two identified diagnostic cases are the fixed-text scope.
5. **Release and sequencing:** retain the package patch version `2.5.2`, with no new public names or result variants. Contract merges first; probe, status, notify and console then pin the full merged contract main SHA and regenerate `bun.lock`. Each consumer depends only on contract and can otherwise proceed independently. Do not pin an unmerged branch or copy the client into consumers.
6. **Adoption tests:** retain one focused API-read adoption regression each in probe and status. Notify and console need pin, lockfile and mandatory documentation changes, with existing coverage proving their guards remain intact. Additional consumer production changes require a revised scope, not incidental cleanup.

## Nonblocking points the plan must settle

- **Check ordering and cleanup:** specify the complete order for status, wire check, encoding guard, size, parsing and validation in both read and write paths. Retain status-before-wire precedence and per-response absent-wire callbacks. Cover the non-2xx write branch explicitly; it reads a body today. Keep cancellation, timeout, caller-abort precedence, timer cleanup and write-response metadata intact, including when encoding is refused after headers arrive. Select and document a fixed unsupported-encoding cause message without including the received header.
- **Fetch typing and forwarding:** keep the public injected-fetch signature and browser-compatible imports. A local init type can carry the runtime option without changing exported names. Verify existing wrappers forward the request headers, signal and runtime option; tests that compare the old header representation may require adjustment without weakening their authorization assertions. Normalize supported header inputs without mutating caller-owned headers or dropping credentials.
- **Encoding behavior:** define supported absent/identity handling and unsupported-encoding rejection precisely in implementation/tests. Runtime code must keep the bound effective even if upstream ignores the request preference. Do not rely on browsers honoring a request-controlled encoding header; prior browser evidence says they can omit it. Preserve successful small compressed responses and the decoded-byte cap in Node/browser paths.
- **Memory evidence:** retain the prior separate-process peak-memory regression with a maximum 64 MiB peak growth budget. Record baseline and candidate/runtime identifiers. Measure peak growth, including native buffers; final heap usage alone does not establish bounded memory. Separate fixture setup from the measured client interval and account for process startup. The plan names cases and budgets only; construction details stay inside test code. Previous comments report runtime evidence, but this review did not rerun it.
- **Browser evidence:** retain real local Chromium checks using the existing Playwright `1.64.1` tooling of status/console, without adding Playwright to contract. Exercise the browser distribution path and report literal outcomes for small compressed JSON, decoded-body limits and redirect refusal. An import-only check is insufficient. Keep the temporary browser evidence outside the committed target file scope and clean it up before final scope checks.
- **TLS prerequisites:** retain mandatory local HTTPS-to-HTTP redirect coverage with runtime-generated test credentials and normal certificate verification. No global TLS bypass or skip on missing tooling. Contract's CI pins shared workflow `51e95b0eb463b27a196a33b428607bd92443e4f0`; that workflow uses `ubuntu-24.04` without a container. Kit has an existing OpenSSL test pattern in `test/guarded-fetch.tls.test.ts:32–33`. Prior comments report runner-image and passing CI verification; carry their provenance into the plan, distinguishing reported evidence from checks performed in the new run. Resolve missing prerequisites rather than silently skipping a required regression.
- **Performance:** retain the median of three baseline and three candidate `bun run test` runs, using bash `time` user plus system CPU. Include child-process cost and keep security fixture generation efficient inside test code. Reconcile measured cost with API-owned budgets; contract currently has a 9.0 s test budget and 2.0 s regression floor. No budget, test threshold or shared tooling changes are authorized.
- **Benchmark ownership:** the fallback harness is API's `bench/run.ts`, not a consumer script. Use a disposable writable API checkout inside the authorized workspace and run from its root with the same API revision on both sides, `--others-ref main`, and a candidate `--b-ref` for contract, probe, status or notify only. Identify the actual revisions and harness prerequisites. API `bench/refs.ts:5,37–39` excludes console, and `bench/budgets.json` has no console metrics. Console uses only the primary six-run CPU comparison, with the prior expected delta of at most 0.5 s; a larger delta needs a hold. The earlier console hold rule for changes beyond its pin must now allow its lockfile and the manager-required README/configuration documentation too; production-source expansion still needs a scope decision.

## Required repository scope and documentation

The plan and generated task `Files:` lists must enumerate exact allowed paths, including new test/helper paths and individual generated dist files. Do not use a broad directory allowance as permission to alter unrelated code.

| Target | Required change scope | Matching documentation acceptance |
| --- | --- | --- |
| contract | Shared client, wire helper, focused regressions and any test helpers, package patch metadata/lockfile as needed, generated client/version dist artifacts, `README.md`, `docs/index.md` | README and client reference explain redirect refusal, runtime-specific compression handling, cap and fixed diagnostics; dist matches source; no new runtime dependency or setting. |
| probe | `package.json`, `bun.lock`, one focused API-read adoption test, `README.md` | README explains the adopted final-endpoint/response-handling behavior; monitored-target redirect behavior and unrelated production code stay unchanged. |
| status | `package.json`, `bun.lock`, one focused proxy/API-read adoption test, `README.md` | README distinguishes browser decoded-stream compatibility from server-runtime encoding refusal and documents redirect refusal and existing cap. |
| notify | `package.json`, `bun.lock`, `README.md` | README documents adoption of the shared response-handling fix. Existing redirect, redaction and body-limit guards and their regression coverage remain intact. |
| console | `package.json`, `bun.lock`, `README.md`, `docs/configuration.md` | Both documents describe adopted API response handling and final endpoint requirements; no new setting. Existing authentication, write/read mapping and wrapper guards remain intact. |

Consumer docs are required changes, not optional follow-ups. Do not perpetuate earlier descriptions of notify/console as pin-only. Protect each target's AGENTS, CI, lint/type/coverage configuration, unrelated pins, production modules outside its allowed scope and pre-existing tests outside explicitly allowed edits. The planner must expand that protection into concrete paths and preserve protection of unrelated content within allowed package/lock files by reviewing those diffs.

## Derived acceptance check

Record red results against the implementation baseline and green results against the candidate. A source-only assertion or a test already passing on the baseline is compatibility evidence, not the regression proof. Runtime inputs are generated inside tests; reports contain the titles and expected/actual outcomes below, never input construction or reproduction commands.

| Case title | Class | Required outcome and budget |
| --- | --- | --- |
| Compressed read body larger than the cap | Eager decompression / memory exhaustion | Bun rejects safely with the specified fixed `network` cause; isolated-process peak growth at most 64 MiB. |
| Compressed successful write response larger than the cap | Eager decompression / memory exhaustion | Safe rejection, preserved received-response metadata, isolated-process peak growth at most 64 MiB. |
| Compressed non-success write response larger than the cap | Eager decompression / memory exhaustion | `http` with no body-derived message, preserved metadata, isolated-process peak growth at most 64 MiB. |
| Same-origin read redirect | Redirect following | `http`; zero destination requests. |
| Cross-origin read redirect | Redirect following | `http`; zero destination requests. |
| HTTPS-to-HTTP read redirect | Transport downgrade | `http`; zero destination requests; TLS verification remains active. |
| Invalid JSON diagnostic | Upstream body-text disclosure | Both clients return exactly the fixed invalid-JSON message, with no parser/body marker in the result. |
| Wire mismatch diagnostic | Upstream header-text disclosure | Direct helper, both clients, nested HTTP wire checks and write metadata contain exactly the fixed wire text and no received-header marker. |
| Supported compressed Node response | Runtime compatibility / decoded cap | Node 24: small JSON succeeds; body exceeding the decoded cap returns `too-large`; record peak-memory evidence. |
| Supported compressed browser response | Browser compatibility / decoded cap | Actual Chromium: small JSON succeeds; body exceeding the decoded cap returns `too-large`; test gzip and brotli handling without blocking valid small compressed reads. |
| Browser read redirects | Browser redirect semantics | Actual Chromium: same-origin and cross-origin manual redirects give `http` status `0`, with zero destination requests. |
| Probe API-read adoption | Dependency integration | Real shared-client path refuses redirects; existing authenticated read, 404 fallback and monitoring behavior stay green. |
| Status API-read adoption | Dependency integration | Proxy/shared-client path refuses redirects and retains existing public response mapping; browser polling remains functional. |

Also require all existing timeout, abort, body-limit, validation, absent/current/mismatched-wire, empty-write, non-2xx write-message and response-metadata regressions to pass. Keep the default 5 MiB cap, caller `maxBytes`, public result shapes, wire version and retry behavior. Run each target's required checks (`bun run check`), contract build/dist freshness checks and existing consumer guard tests; identify the tested merged contract SHA. Fulfill each target's handoff/CI requirements without modifying read-only context clones. Report performance comparisons with the prescribed scope and no weakened budget or threshold.

## Scope checks required in every task's acceptance

Record the full implementation-base SHA as `BASE` before edits. After the last implementation commit, check all of these independently:

1. `git diff --name-only "$BASE" HEAD`: compare every changed path against the task's exact allowed list; reject any path outside it. Also require the mandatory docs and intended behavior changes to be present. Inspect allowed-file diffs for unrelated changes.
2. `git diff --name-only --cached`: must be empty. This tests the index separately from commits.
3. `git diff --name-only`: must be empty. This tests the working tree against the index separately.
4. `git status --porcelain`: must be empty, including untracked files. Temporary fixtures/evidence must have been removed.
5. `git diff --exit-code "$BASE" HEAD -- <protected files>`: must exit zero for the task's enumerated protected paths. Do not substitute a base-to-working-tree diff.

Do not claim final cleanliness before the final commit or infer it from one of these checks. Do not expand the allowed list to excuse an accidental edit. Copy the complete acceptance into each task, including consumer adoption tasks, and record the commands' outcomes at task acceptance.

Prove the validation method with a disposable Git fixture covering an unstaged protected edit, a staged protected edit, a committed protected edit with a clean index/worktree, and both staged/committed protected edits followed by restoring only the working-tree copy to the base. Include an allowed-change/clean-state control. A lone `git diff "$BASE"` can be empty for the restored-worktree cases and is insufficient.

This review ran the protected-change fixture locally inside a temporary subdirectory of `.factory/work/864`, using only ordinary text files. Assertions passed for these observations:

| Fixture state | Observed detection |
| --- | --- |
| Clean-state control | Commit diff, index diff, working-tree diff and status are empty. |
| Allowed committed change | Exact singleton allowed-path comparison and protected-path check pass; index, working-tree and status are empty. The same allowed set rejects the protected path. |
| Unstaged protected edit | Working-tree and status checks detect it; index and commits remain unchanged. |
| Staged protected edit | Index and status checks detect it even with no unstaged changes. |
| Staged edit, working tree restored to base | Base-to-working-tree diff is empty; index, working-tree and status checks still detect changes. |
| Committed protected edit, clean index/worktree | Base-to-HEAD path list and protected-path diff detect it despite empty index/worktree/status output. |
| Committed edit, working tree restored to base | Base-to-working-tree diff is empty; base-to-HEAD and protected-path checks detect the commit, and working-tree/status checks detect the restoration. |

Both disposable fixtures were removed after the assertions passed. Later task evidence must exercise its actual allowed and protected lists; this review validates the Git-state observations and a minimal exact-path comparison, not a future task's as-yet unwritten scope checker.

## Review validation and limitations

Only this issue-review artifact is retained. No product files, provider labels/comments, configuration or context clones were changed. No target runtime regression, browser suite, benchmark or build was run in this state; earlier runtime measurements are comment-supplied evidence, not newly measured results. Scope-fixture assertions are new local evidence. Initial searches for the absent issue directory and a guessed notify helper path were corrected by direct listing/source inspection; the guard is in notify `src/api.ts`. Git's ignore check returns 1 for this artifact, meaning it is not ignored. There is no unresolved tool failure or decision requiring a hold.
