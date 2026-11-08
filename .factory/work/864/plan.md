# Spec #864: contract: bound response memory and harden shared API reads

## Goal

The shared API client of pulse-contract (`fetchJson`, `requestJson`) and its wire helper
(`checkWireVersion`) must not let an upstream answer get around the client's documented limits.
The audit findings below reproduce on contract `main` `1b5e7d3e268372a6241db05ae30272eab7299b10`.
They are listed by location, class, impact and fix direction only. This is a public repository, so
no reproduction is given:

| Finding | Location | Class | Impact | Fix direction |
| --- | --- | --- | --- | --- |
| security-contract-2026-11-03-1 (P2) | `src/client.ts` `exchange` (`:125-154`), `requestExchange` (`:303-323`), `readText` (`:76-102`) | The runtime expands a compressed answer before the body cap applies | The process's memory grows with the decoded size, also for a non-2xx answer whose body is never read | Ask for no compression, turn off runtime decompression, and refuse a non-identity coding where the runtime would otherwise expand it outside the counted stream |
| security-contract-2026-11-03-3 (P3) | `src/client.ts:131` (`init = { signal }`) | `fetchJson` lets the runtime follow redirects | Reads reach other origins and downgrade from https to http, with caller headers | `redirect: "manual"`, as `requestJson` already does |
| security-contract-2026-11-03-4 (P3) | `src/version.ts:24-27` | The received wire header is copied into the mismatch text | Untrusted header text reaches errors and logs (`wire-mismatch.message`, `http.wire.error`, `requestJson` `response.wire.error`) | Fixed text built from constants only |
| security-contract-2026-11-03-5 (P3) | `src/client.ts:112-116` (`parseBody`) | The JSON parser's message is copied into `invalid-json.message` | Body text can reach errors and logs | Fixed text |

After the contract fix merges, the consumers that call the shared client (probe, status, notify,
console) move their contract pin to the merged commit and document the changed behavior.

## Disclosure rule (binds the plan, every task, every evidence summary and every PR)

- Name each security case by title, class, expected outcome and budget only. Never write a working
  payload, a construction recipe, a reproduction command, a crafted header value, a ready-made
  redirect or oversized response, or the parameters used to generate a response.
- Tests build their hostile inputs at run time inside the test code. Test output, task evidence and
  PR text report test titles, outcomes and measured numbers, never the inputs.
- The plan and the tasks state no fixture setup, server layout, routing, response order, header
  value, body content or encoder setting for a security case. Those are choices of the test code.
  The plan names only the code under test (location), the case title, its class, the expected
  outcome and the budget.
- The local Node and browser evidence scripts live in a scratch directory outside every repository,
  are not committed, are deleted after the run, and are reported by case title and outcome only.

## Evidence gathered for this spec

New in this run (2026-11-08, Factory runner, Bun 1.4.0, Node 24.19.0, OpenSSL 3.0.13):

- Issue review `.factory/work/864/issue-review.md` read; its decisions 1-6 are kept, and every
  nonblocking point is settled below.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/864` answered
  HTTP 404, so there are no findings yet.
- Clones read: contract `1b5e7d3`, probe `9490141`, status `b7dfc7c`, notify `dde5261`, console
  `40c271e`, api `515031b`, kit `536133f`, config `bc87049`.
- Memory, re-measured in a scratch script outside the clones that imports contract `src` at
  `1b5e7d3`. It ran one child process per case and reported the peak RSS growth defined in
  "Counterexamples":
  - Today's client under Bun, compressed answer far above the cap: `200` gives `too-large` with
    +322 to +516 MiB; `500` gives `http` with +396 MiB.
  - The same client with runtime decompression turned off through the injected fetch: +2 MiB for
    both statuses. The `200` case then returned `invalid-json`, which shows that turning off
    decompression alone is not enough: the client must also refuse the coding.
  - CPU per child (user + system): 0.17 s with decompression off, 0.57 s with today's behavior.
  - The scratch script was deleted.
- Collision searches for the new texts (section "Contract fields") are empty.
- Disclosure audit (this revision, after the third plan review): every security case in this spec
  was checked against the disclosure rule. Fixture setup, peer layout, routing, response order and
  input content were removed from the counterexamples, the contract tests, the Node and browser
  evidence and the probe and status tests. What remains is location, title, class, expected outcome
  and budget.
- Benchmark rule (this revision, after the fourth plan review): the shared fallback rule in
  "Performance impact" now names notify's +0.3 s threshold next to contract's +1.5 s and the
  +0.3 s for probe and status. It now agrees with the notify section. Nothing else changed.
- No pulse service or deploy profile compresses responses: `grep -rni 'content-encoding|gzip|brotli|compress'`
  over `api/src`, `status/src`, `probe/src`, `notify/src`, `console/src` and `deploy` found no
  production match.
- Tool facts (cited in each repository section) were read in this run. The pinned
  `lorenzh/pulse-config` `.github/workflows/check.yml` was read at `51e95b0…` and at `04108fa…`
  with `gh api …?ref=<sha>`. The two are byte-identical, and both equal the config clone. The pinned
  `biome.json` at both SHAs equals the clone.
- `openssl` in CI: the pinned `check.yml:16` is `runs-on: ubuntu-24.04` with no container. The
  `actions/runner-images` `images/ubuntu/Ubuntu2404-Readme.md` (image version 20261101.360.1,
  read in this run) lists "OpenSSL 3.0.13-0ubuntu3.16" at line 94. kit
  `test/guarded-fetch.tls.test.ts:29-54` runs `openssl` to make a test-only certificate under
  `check.yml@51e95b0…` (`kit/.github/workflows/ci.yml:17`). kit CI on `main` `536133f` passed in run
  41814062315 (checked in this run with `gh run list`).
- Contract CI on `main` `1b5e7d3` passed in run 42378361352.

Reported by earlier plan runs of this issue (closed spec PR #871), not re-run here:

- A Node 24 run against the built dist: a compressed answer above the cap gave `too-large` with
  +34 to +38 MiB, because Node decodes inside the stream that the client counts. Node ignores the
  unknown `decompress` init member. A `302` was followed on `1b5e7d3` and refused by a prototype of
  this spec.
- A Chromium 156 run (Playwright 1.64.1) against a browser bundle of the dist gave these outcomes,
  the same on `1b5e7d3` and on the prototype unless a pair is shown:
  - A small compressed JSON read: `ok`.
  - Compressed answers above the cap: `too-large` in 32 to 74 ms.
  - Same-origin and cross-origin redirects: `ok` with the destination reached (`1b5e7d3`), and
    `http` with status 0 and the destination not reached (prototype).
  - The browser drops the client's `accept-encoding: identity` silently.
- `parseBRefs(["console=main"], "main")` of api `bench/refs.ts` threw
  `--b-ref: not a non-api repository: console`. This run re-checked the cause in the source:
  `api/bench/refs.ts:5` lists `api, probe, status, notify, contract, kit, config`, and
  `refs.ts:37-39` refuses other names. `bench/budgets.json` has no `console` key.
- The nightly bench run https://github.com/lorenzh/pulse-api/actions/runs/42357126694 reported
  contract `test_cpu_s` B 3.78 s, probe B 1.53 s and status B 2.82 s.

## Decisions

1. **Encoding policy.** Both functions build their request init in one shared helper. The init has
   `signal`, `redirect: "manual"`, Bun's `decompress: false` (other runtimes ignore an unknown init
   member), and `headers = new Headers(options.headers)`, with `accept-encoding: identity` set
   after the caller's headers, so it replaces a caller value. `requestJson` keeps
   `content-type: application/json` for a body. The caller's `headers` object is never mutated, and
   the caller's other headers (for example `authorization`) are kept. The init is typed with a local,
   unexported `RequestInit & { decompress?: boolean }`. There is no `node:` or `bun` import, and the
   public `fetch` option type is unchanged.
2. **Refusing an encoded body.** Under Bun (feature check `"Bun" in globalThis`, no import), the
   body is not decoded once `decompress: false` is on, so the client checks the answer's
   `Content-Encoding` before any body read:
   - Absent, or `""` / `identity` after trimming and lower-casing: the read goes on.
   - Anything else is refused. That includes every real coding, unknown codings and lists that
     contain more than one coding.

   Node and browsers decode inside the body stream that the counting loop reads, so the existing
   cap already bounds the decoded bytes there. They do not refuse on `Content-Encoding`: a browser
   cannot ask for identity, and refusing there would break the status page poller behind a
   compressing proxy. No decoder is added.
3. **Failure shape of a refused encoding.** No new error kind or field.
   - `fetchJson`, and `requestJson` with a `2xx` answer: `{ kind: "network", cause }`, where `cause`
     is an `Error` whose message is exactly `response content-encoding is not supported`. The message
     never contains the received header.
   - `requestJson` with a non-`2xx` answer: the `http` error without `message`, because the body is
     not read.
   - In every case `requestJson` keeps `response` (status, `ETag`, wire check), and the body is
     dropped without waiting, as today.
4. **Order of checks.**
   - `fetchJson`: HTTP status, wire header, content encoding, size, JSON, validation.
   - `requestJson`: HTTP status, wire header, content encoding, size, empty body, JSON, validation.
     For a non-`2xx` answer, the encoding check decides whether the `ErrorResponse` body may be read
     for `message`.
   - HTTP-before-wire precedence is unchanged. `onWireAbsent` still runs once per response without
     the header, also for a non-2xx or refused answer.
5. **Redirects.** `fetchJson` passes `redirect: "manual"`, and `requestJson` keeps it. A visible
   `3xx` is the existing `http` error with that status. A browser's opaque redirect is an `http`
   error with status 0. A runtime that rejects the redirect gives `network`. Same-origin redirects
   are refused too, and no opt-in is added.
6. **Fixed texts.**
   - `invalid-json.message` is always exactly `response body is not valid JSON`. The parser error is
     deliberately ignored, with a one-line comment (contract `AGENTS.md` "Errors").
   - The `checkWireVersion` mismatch `error` is always exactly
     `x-pulse-contract: unsupported wire version, expected 1`, built from `WIRE_VERSION_HEADER` and
     `WIRE_VERSION`. It therefore reaches `wire-mismatch.message`, `http.wire.error`,
     `requestJson`'s `response.wire.error` and its `2xx` `wire-mismatch` alike.
   - The `ok` / `absent` / `mismatch` decision rule (trim, digits only, equal to `WIRE_VERSION`) is
     unchanged.
   - These stay as they are and are out of scope: `requestJson`'s documented `http.message` (the
     `ErrorResponse.error` text, at most 1000 characters), validator messages, the caller's abort
     `reason` and the transport `cause`.
7. **Package version** `2.5.1` → `2.5.2` (patch). There is no type, export or wire change.
8. **Consumers.** probe, status, notify and console move their pin to the full merged contract
   `main` SHA and regenerate `bun.lock`. api keeps its pin: `grep -rn 'fetchJson\|requestJson\|checkWireVersion' api/src`
   is empty. kit, config, website, deploy and agent have no contract client use.
9. **Browser and Node evidence stays local.** Contract's pinned CI installs no browser
   (`check.yml:18-38`), and no Playwright dependency is added to contract. The checks run in a
   scratch directory with the Playwright version that status and console already pin.

## Scope

- contract: the shared client, the wire helper, regressions, the generated dist, `README.md`,
  `docs/index.md`, and the `package.json` version.
- probe and status: the pin, `bun.lock`, one new adoption test file each, and their docs.
- notify and console: the pin, `bun.lock` and their docs. Their guards and source stay unchanged.

## Non-goals

- No streaming decoder for any content coding.
- No change to error kinds, result shapes, exported names, `WIRE_VERSION`, `DEFAULT_MAX_BODY_BYTES`
  (5 MiB), caller `maxBytes`, timeout, abort, first-interruption or cancellation semantics, or
  retry behavior of any consumer.
- No change to `requestJson`'s `http.message`, to probe's check HTTP client (`src/check.ts` and its
  monitored-target redirect rules), or to notify's #553 guards (`noRedirect`, the capture wrapper,
  `apiError` texts, redaction).
- No api pin bump, no other audit finding, no new runtime dependency, no new setting.
- No committed browser test.

## Required behavior

- R1 Bounded memory (Bun): a compressed answer whose decoded size is far above the cap keeps the
  peak RSS growth of an isolated process at most 64 MiB for these cases: a `fetchJson` `2xx` read, a
  `fetchJson` non-2xx read, a `requestJson` `2xx` write and a `requestJson` non-`2xx` write.
- R2 Encoding refusal (Bun) as in decisions 2-4. The validator is not called for a refused answer.
- R3 Redirect refusal: `fetchJson` never requests a `Location`. Under Bun and Node, every 3xx status
  with a `Location` is `http` with that status. In a browser it is `http` with status 0.
- R4 Fixed texts as in decision 6, at every place a wire check or a JSON parse error surfaces.
- R5 Compatibility: identity bodies read as before in Bun, Node 24 and Chromium. Small compressed
  JSON still reads in Node 24 and Chromium. A decoded body above the cap is `too-large` in Node 24
  and Chromium. Every existing contract test still passes, except the assertions this spec changes
  on purpose (listed in the contract section).

## Performance impact

The api's own metrics in `api/bench/budgets.json` (api `515031b`): `startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, the `p95_*` keys, `rps`,
`image_mb`, and the `cold_*` and `eod_*` keys. None is expected to move, because the api calls no
shared-client function and keeps its contract pin.

Other keys of the same file:

- `contract.test_cpu_s` (budget 9.0 s, floor 2.0 s). The failure rule is
  `B - A > max(A × 10 %, floor)` or B above the budget (`api/bench/README.md:108`).
  - Expected: up by 0.6 to 1.0 s.
  - Basis: four isolated memory children at about 0.17 to 0.24 CPU s each (0.17 s measured in this
    run, 0.18 to 0.24 s reported by the earlier prototype), plus transport tests with local servers
    and one EC `openssl` certificate, at most 0.4 s.
  - Budget: input generation inside a memory child stays at or below 0.1 CPU s per case. The test
    code owns how it meets that budget.
  - The hosted nightly B of 3.78 s plus 1.0 s stays under the 9.0 s budget, and +1.0 s stays under
    the 2.0 s floor.
- `contract.build_cpu_s` (budget 6.4 s): unchanged. Two source files change by a few lines.
- `probe`, `status`, `notify` `peak_rss_mib` and `idle_rss_mib`: unchanged for normal traffic,
  because the api sends identity bodies. A hostile compressed answer no longer raises them.
  `startup_cpu_ms`, `load_cpu_s`, `startup_wall_ms` and `image_mb`: unchanged (one more request
  header, one header check per answer).
- `probe.test_cpu_s` (budget 2.3 s) and `status.test_cpu_s` (budget 3.4 s): up by under 0.1 s each
  (one new test file with local servers). `notify.test_cpu_s` (budget 3.4 s, floor 1.5 s):
  unchanged, because only the pin and docs change.
- How to measure:
  - Primary, in every changed repository: run `bun run test` three times on the implementation base
    and three times on the branch, each as `TIMEFORMAT='%U %S'; time bun run test` (bash builtin,
    because `/usr/bin/time` is not installed on the Factory runner). Report the median of user +
    system seconds per side and their difference. This is the quantity that the harness reads
    (`api/bench/measure.ts:68`, `resourceUsage()`; `run.ts:222`). The child processes of the memory
    test count, because they are children of `bun run test`.
  - Fallback, only for `contract`, `probe`, `status` or `notify`, and only for the repository whose
    own primary delta exceeds its threshold: contract above +1.5 s; probe, status or notify each
    above +0.3 s. These are the same thresholds that each repository section names. Below its
    threshold, a repository does not run the fallback. The harness exists only in the api
    repository. Clone it into a scratch directory outside every target repository:
    `git clone https://github.com/lorenzh/pulse-api.git <scratch>/pulse-api`, then from that
    checkout's root run `bun install --frozen-lockfile`, then
    `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref <target>=<pushed branch or SHA> --rounds 1`.
    The flags come from `api/bench/README.md:73-88`. `--b-ref` needs `--others-ref`, and the ref
    must be fetchable from the public repository. It needs Docker with Compose, `git` and network
    access (`README.md:80`). Report the target's rows. Delete the scratch checkout afterwards.
  - console is outside the harness: `api/bench/refs.ts:5,37-39` refuses `--b-ref console=…`, and
    `api/bench/budgets.json` has no `console` key. No metric of `bench/budgets.json` can move for
    console, and the console child never runs the fallback. Its only measurement is the primary one.
    The expected delta is within 0.5 s, because its tests drive the real contract client against
    local servers with identity bodies (`src/connection-test.test.ts:105`,
    `src/server.security.test.ts:78`). Above 0.5 s, it requests a hold.

## Security impact

Security impact: yes
The change hardens the shared HTTP client and its parsers at the contract trust boundary: redirect
handling, body and memory limits, error texts that carried external data, and dependency pins.

Checklist items that apply:

- Secrets in errors, logs and responses: the invalid-JSON and wire-mismatch texts and the
  refused-encoding cause carry no received byte.
- Body and size limits: the 5 MiB default and a caller `maxBytes` must bound memory under Bun for
  encoded answers, including answers dropped for HTTP or wire errors and non-2xx writes.
- SSRF and redirects: `fetchJson` follows no redirect (same-origin, cross-origin, https→http). Caller
  headers such as `authorization` never reach a redirect target.
- Input validation: the content-coding check fails closed for unknown and combined codings.
- Dependency pins: each consumer pins the full merged contract `main` SHA with a consistent
  `bun.lock`. No new runtime or dev dependency anywhere.

The security state after review must exercise these hostile classes on the candidate. The inputs
are built in test code only, per the disclosure rule.

## Rollout order

1. contract merges the fix to `main` (2.5.2). Nothing on the wire changes: same paths, shapes and
   `WIRE_VERSION` 1.
   - Every consumer on an older pin (probe on `7ce23aa`; status, notify, console and api on
     `1b5e7d3`) keeps working exactly as before, with the old client behavior, until its pin moves.
   - The api serves identity JSON and no redirects on the routes the consumers read, so the new
     behavior changes nothing for traffic between pulse services.
2. probe, status, notify and console move their pins, in any order and in parallel.
   - Each works with any api, notify or status version, because the change is client-side only.
   - Mixed fleets keep working (for example a new probe with an old status): no service parses
     another service's error texts.
   - A new status serves the new client to the browser. There the only changes are
     `redirect: "manual"` and a header that the browser drops. The page reads its own `/api/*` proxy,
     which does not redirect.
3. api is not bumped in this feature, because it calls no shared-client function.

Operator-visible change: a deployment whose `PULSE_API_URL` (or the status/console equivalent) points
at a URL that redirects, or at a proxy that compresses even after an identity request, now fails its
API reads instead of following or decoding. Each consumer's docs say that the URL must be the final
endpoint and that compressed API answers are refused by the server runtime.

## Counterexamples

Each case is named by title, class and expected outcome. Inputs are built at run time in test code.

- **Compressed read body larger than the cap (Bun, 200).** Eager decompression. Expected: `network`
  with the fixed cause, and peak growth ≤ 64 MiB. A fix that only sends `accept-encoding: identity`,
  or only cancels the body, still grows by hundreds of MiB (measured in this run: +322 to +516 MiB).
  A fix that only turns off decompression returns `invalid-json` (measured in this run), not
  `network`.
- **Compressed non-success read (Bun, 5xx).** Eager decompression before the discard. Expected:
  `http` with that status, and peak growth ≤ 64 MiB. A fix that checks the encoding only before
  `readText` misses this case: unless `decompress: false` is on the request, Bun decodes before any
  read (+396 MiB measured in this run).
- **Compressed successful write response larger than the cap (Bun).** Expected: `network` with the
  fixed cause, `response` kept with status `2xx`, and peak growth ≤ 64 MiB.
- **Compressed non-success write response larger than the cap (Bun).** Expected: `http` without
  `message`, `response` kept, and peak growth ≤ 64 MiB. A result of `network` or `too-large` is
  wrong.
- **Small compressed body under the cap (Bun).** Expected: `network` with the fixed cause, never
  `too-large` and never `ok`.
- **Multi-coding header value (Bun).** Fail-closed input validation. Expected: refused with the
  fixed cause. A check that accepts any value that mentions `identity` gets it wrong.
- **Non-canonical identity spelling (Bun).** Expected: read normally (decision 2: trimmed,
  case-insensitive).
- **Precedence.** A mismatching wire header with an encoded `2xx` gives `wire-mismatch`. An encoded
  `503` gives `http` 503, not `network`.
- **Same-origin read redirect.** Expected: `http` with the 3xx status, and the destination gets 0
  requests. A fix that refuses only cross-origin targets gets it wrong.
- **Cross-origin read redirect, with a caller `authorization`-style header.** Expected: `http`, and
  the destination gets 0 requests.
- **HTTPS-to-HTTP read redirect.** Transport downgrade. Expected: `http`, and the destination gets 0
  requests. Constraint: certificate verification stays on, with no global TLS bypass and no
  committed key material.
- **Invalid JSON diagnostic.** Upstream body-text disclosure. Expected: every `invalid-json.message`
  of both functions equals the literal `response body is not valid JSON`, and no received body text
  appears anywhere in the serialized result. A fix that only shortens the parser text is wrong: a
  short received fragment still appears.
- **Wire mismatch diagnostic.** Upstream header-text disclosure. Expected: every surfaced text equals
  the literal `x-pulse-contract: unsupported wire version, expected 1`, for short and long received
  values alike, and no received header text appears. A fix that truncates the value is wrong: a
  prefix still appears.
- **Wire decision unchanged.** Expected: the existing `ok`, `absent` and `mismatch` cases of
  `test/version.test.ts:10-28` keep their decisions.
- **Node 24 compressed answer above the cap.** Expected: `too-large`, not `network`, with peak growth
  ≤ 64 MiB. A fix that refuses on `Content-Encoding` in every runtime would also refuse in browsers.
- **Browser small compressed JSON.** Expected: `ok` with the value. A fix that refuses encoded
  bodies outside Bun gives `network`.
- **Browser read redirect.** Expected: `http` with status 0, and the destination gets 0 requests.
  Today's client gives `ok` with the destination's value.

Statistics, defined exactly:

- **Peak RSS growth.** In one child process per case: run `Bun.gc(true)` after the case's setup,
  then read the baseline `process.memoryUsage().rss`. Sample RSS at least every
  5 ms, from just before the client call until 1000 ms after it returns. Growth is the maximum
  sample minus the baseline, in MiB (2^20 bytes), rounded down. One sample set per case, with no
  averaging. The budget is ≤ 64 MiB, a literal set between the +2 MiB measured with decompression
  off and the +322 MiB or more measured on `1b5e7d3`.
- **Test CPU.** User + system seconds of `bun run test`, from bash `time`, rounded to 0.01 s. Three
  runs per side. The median is the middle value of the three sorted values. The delta is
  median(branch) - median(base). Means are never used.

## Contract fields

No new names: no new export, error kind, result field, option, header constant or module file. The
new texts and the init member and header that the client sends do not collide with existing ones
(searched in this run):

- `grep -rn 'not valid JSON' .repos/contract/src .repos/config --exclude-dir=node_modules` → no match.
- `grep -rn 'unsupported wire version' .repos/contract/src .repos/config --exclude-dir=node_modules` → no match.
- `grep -rni 'content-encoding\|decompress\|accept-encoding' .repos/contract/src .repos/config --exclude-dir=node_modules` → no match.
- `grep -rn 'is not supported' .repos/contract/src` → no match.

`decompress` is Bun's existing request option, typed in a local, unexported type. It must not appear
in `dist/*.d.ts`.

## Scope verification (copied into every task's acceptance)

Before the first edit, record the full implementation base: `BASE=$(git rev-parse HEAD)`, and write
it into the task evidence. After the last commit, run each check on its own and record its output:

1. `git diff --name-only "$BASE" HEAD | sort` equals the task's exact allowed list (sorted), minus
   any path marked "only if changed". Every path marked required is present. Any other path fails.
   Then read the diff of every allowed file for unrelated changes.
2. `git diff --name-only --cached` prints nothing (index against HEAD).
3. `git diff --name-only` prints nothing (working tree against index).
4. `git status --porcelain` prints nothing, untracked files included. Scratch evidence must live
   outside the repository and be gone.
5. `git diff --exit-code "$BASE" HEAD -- <protected paths of the section>` exits 0. Never substitute
   a base-to-working-tree diff (`git diff "$BASE"`).

Prove the method once per task, before relying on it, with a disposable Git fixture in a `mktemp -d`
directory outside the repository. It has one allowed file and one protected file. Record the five
commands' results for each of these states:

| State | Expected detection (literals) |
| --- | --- |
| Clean control (no change) | all five checks pass; check 1 list empty |
| Allowed change committed | check 1 equals the allowed singleton; checks 2-5 pass |
| Protected edit unstaged | check 3 and check 4 fail (non-empty); checks 1, 2, 5 pass |
| Protected edit staged | check 2 and check 4 fail; checks 1, 3, 5 pass |
| Protected edit staged, then worktree copy restored to base | `git diff "$BASE"` is empty, yet checks 2, 3 and 4 fail |
| Protected edit committed, index and worktree clean | check 1 lists the protected path and check 5 exits 1; checks 2-4 pass |
| Protected edit committed, then worktree copy restored to base | `git diff "$BASE"` is empty, yet checks 1, 3, 4 and 5 fail; check 2 passes |

Delete the fixture afterwards. The expected detections are the literals in this table, and they come
from Git semantics, not from the task's own output.

## Repository: contract

Files:
- `src/client.ts` (required)
- `src/version.ts` (required)
- `test/client.test.ts` (required)
- `test/request-json.test.ts` (required)
- `test/version.test.ts` (required)
- `test/client-transport.test.ts` (new, required)
- `test/client-memory.test.ts` (new, required)
- `test/client-memory-child.ts` (new, required; not a `*.test.ts` file)
- `dist/client.js` (required, generated)
- `dist/version.js` (required, generated)
- `dist/client.d.ts` (generated, only if changed by doc comments)
- `dist/version.d.ts` (generated, only if changed by doc comments)
- `README.md` (required)
- `docs/index.md` (required)
- `package.json` (required, `version` line only)

Behavior change: yes
The shared client changes its redirect handling, its content-coding handling and two error texts.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`, `biome.json`,
`bunfig.toml`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `lefthook.yml`,
`bun.lock`, `src/index.ts`, `src/schema.ts`, `src/validate.ts`, `src/validate-core.ts`,
`dist/index.js`, `dist/index.d.ts`, `test/smoke.test.ts`, `test/security-review.test.ts`,
`test/security-adversarial.test.ts`, `test/types.fixture.ts`.

Tool facts (verified in this run):
- Bun 1.4.0: `package.json:7` (`packageManager`) and `:8-10` (`engines`). CI installs Bun 1.4.0
  through `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0`
  (`.github/workflows/ci.yml:17`, `build: true` at `:18-19`), lines 22-24 of that file. The pinned
  file equals the config clone.
- CI steps at that pin: install, `bun run lint`, `bun run typecheck`, `bun run build`,
  `git diff --exit-code -- dist`, `bun run test` (`check.yml:25-38`). It runs on `ubuntu-24.04`
  without a container (`check.yml:16`).
- `bun run check` runs lint, build, typecheck and test (`package.json:28`). Lint is
  `biome check . && pulse-eslint .` (`package.json:25`). Build and typecheck use `typescript7`
  (`package.json:22-23`).
- `test/smoke.test.ts:15` fails when `dist/` differs from a fresh build.
- Biome: `biome.json` extends `@lorenzh/pulse-config/biome.json` (pin `51e95b0…`,
  `package.json:32`). Its `files.includes` ignores `**/dist` and `**/test/fixtures` (config
  `biome.json:10-17`), identical at the pin and in the clone, so `test/` is linted.
- `bunfig.toml:1-4`: coverage on, 80 % line threshold, `test/**` ignored. Only `*.test.ts` files
  run, so `test/client-memory-child.ts` is not collected. The same pattern is used for
  `test/validate-cpu.ts:2`.
- `openssl` is available in CI (see "Evidence gathered"). If the HTTPS case calls it, follow kit's
  lint convention for a test-only `openssl` call from `PATH`
  (`kit/test/guarded-fetch.tls.test.ts:31-32`; kit pins the same config `51e95b0…`). Commit no key
  material, leave no temporary file behind, and fail the test (never skip it) when `openssl` is
  missing.

### Behavior

1. `src/client.ts`:
   - Add the shared init helper (decision 1).
   - Add the encoding check before every body read (decisions 2-4), with the order comments at
     `:140` and `:277` updated.
   - Make `parseBody` return the fixed text (decision 6).
   - Keep `readText`, the Content-Length check, `dropBody`, `interruptible`, the timer cleanup,
     `own.abort()`, `getManualIncidents` / `getManualIncident` and every exported type unchanged.
   - Update the doc comments of `fetchJson` and `requestJson` (order of checks, no redirect,
     identity only).
   - Keep each function within the SonarJS complexity limit of 15.
2. `src/version.ts`: the mismatch `error` is
   `` `${WIRE_VERSION_HEADER}: unsupported wire version, expected ${WIRE_VERSION}` ``. The header
   value is never interpolated.
3. No new `src/` module and no new import between dist modules: status serves a fixed allowlist of
   contract dist files to the browser (status `src/server.ts:219-242`).
4. `README.md`:
   - Add pulse-console to the consumer list (`:7`).
   - In the client paragraph (`:34-39`), state that both functions follow no redirect and ask for
     identity coding, that under Bun an encoded body is refused while Node and browsers decode
     inside the capped stream, and that invalid JSON and wire mismatches use fixed texts.
5. `docs/index.md` "API client" (`:702-750`):
   - Document the init that the client sends, the encoding rule per runtime, and the redirect rule
     (3xx → `http` with that status; browser opaque redirect → `http` with status 0).
   - Document the new order of checks for both functions and the two fixed texts. The `network` row
     gains "or a refused content coding under Bun". Cover the `requestJson` non-`2xx` encoded case.
   - Add pulse-console to "Bump the pin in a consumer" (`:754`).
   - Add a "Contract 2.5.2 is a patch …" note next to the 2.5.1 note (`:524`).
6. `package.json` `version` `2.5.2`. Then run `bun run build` and commit the dist files.

### Tests

Write the tests first and keep the red run ("Done when" of the issue). Hostile inputs are built
inside the test code only.

- `test/client-memory-child.ts` and `test/client-memory.test.ts`. Class: eager decompression,
  memory exhaustion.
  - Each case runs in its own `bun` child process (`process.execPath`), one after another. A child is
    killed after 30 s, and the test timeout is 60 s. The child imports `../src/index.ts`, uses the
    native `fetch` against a local-only peer, measures "Peak RSS growth" as defined above, and
    prints one JSON line with `kind` and the growth. Input generation stays within 0.1 CPU s.
  - Cases (title → expected kind; budget ≤ 64 MiB growth for each):
    - "compressed read body larger than the cap is rejected with a bounded peak memory" → `network`.
    - "compressed non-success read is dropped with a bounded peak memory" → `http`.
    - "compressed successful write response larger than the cap is rejected with a bounded peak
      memory" → `network`, `response` kept.
    - "compressed non-success write response is an http error with a bounded peak memory" → `http`
      without `message`, `response` kept.
  - The literal sources are decision 3 for the kinds and "Counterexamples" for the 64 MiB budget.
- `test/client-transport.test.ts`: native Bun `fetch` against local-only peers, all closed in
  `afterAll`. No external network.
  - Redirect following (class: SSRF and redirects): "same-origin read redirect is refused",
    "cross-origin read redirect is refused" and "https-to-http read redirect is refused". Each
    expects `ok: false`, `kind` `http` with the received 3xx status, 0 requests at every
    destination, and no caller credential at any destination. Each of 301, 302, 303, 307 and 308
    gives that outcome.
  - Content coding (class: eager decompression, fail-closed input validation): "encoded answer is
    refused with a fixed cause" covers real, unknown and multi-coding values, with the literal cause
    `response content-encoding is not supported` and no received header text in the serialized
    result. "identity coding reads normally" covers an absent header and non-canonical spellings of
    `identity` → `ok`. The request carries `accept-encoding: identity`.
  - Precedence and write cases, as in "Counterexamples": wire mismatch before encoding, HTTP status
    before encoding, and `requestJson` non-`2xx` encoded → `http` without `message`, `response`
    kept. `onWireAbsent` is still called once for a refused answer without a wire header.
  - Compatibility: an identity body above the default cap, with and without a declared length, is
    still `too-large`.
- `test/client.test.ts` and `test/request-json.test.ts`:
  - "invalid JSON diagnostic uses a fixed text" (both functions): the literal is
    `response body is not valid JSON`, and no received body text appears in the serialized result.
  - "wire mismatch diagnostic uses a fixed text": the literal
    `x-pulse-contract: unsupported wire version, expected 1` appears in `fetchJson`
    `wire-mismatch.message` (`2xx`), `fetchJson` `error.wire.error` (non-2xx), `requestJson` `2xx`
    `error.message` and `response.wire.error`, and `requestJson` non-`2xx` `error.wire.error`. No
    received header text appears.
  - An injected-fetch check that `fetchJson` and `requestJson` pass `redirect: "manual"`,
    `decompress: false` and `accept-encoding: identity`. A caller `authorization` header is kept, a
    caller `accept-encoding` is replaced by `identity`, and the caller's `headers` object is not
    mutated.
  - Assertions changed on purpose:
    - "passes headers and signal to fetch" (`test/client.test.ts:61-70`) reads headers through
      `new Headers(seen.headers)`.
    - "wire mismatch is a typed error with the checkWireVersion text" (`:82-96`) asserts the literal
      text instead of deriving it from `checkWireVersion`.
    - "invalid json" (`:113-119`, and `test/request-json.test.ts:187`) also asserts the literal.
- `test/version.test.ts`: "mismatch text is fixed" expects the literal text for every non-current
  value, short or long, and no received header text in it. The existing ok / absent / mismatch
  cases (`:10-28`) stay.
- A source check in a test: `src/client.ts` and `src/version.ts` contain no `from "node:` or
  `from "bun` import.

### Completion evidence

- Scope verification (section above) with this section's allowed and protected lists. The
  `package.json` diff is exactly one changed line, `"version": "2.5.2",` (literal):
  `git diff --numstat "$BASE" HEAD -- package.json` prints `1	1	package.json`.
- Red run: with the new and changed tests in place and `src/` taken from the base
  (`git checkout "$BASE" -- src`), run the five test files. They must fail on these points:
  - all four memory cases (growth above 64 MiB or a wrong kind);
  - the three redirect tests (destination count 1, `ok: true`);
  - the invalid-JSON and wire-mismatch fixed-text tests.

  Report the failing test titles and the measured growth values, never the inputs. Then restore
  `src/` with `git checkout HEAD -- src` before the scope checks.
- Green run: `bun run check` passes. `bun run build` followed by `git diff --exit-code -- dist`
  is clean: the fresh build and the committed dist are produced independently.
- `grep -c decompress dist/client.d.ts` prints `0`.
- Test CPU, measured the primary way: three runs per side and the median. Expected +0.6 to +1.0 s.
  Above +1.5 s, run the fallback harness for contract.
- Node evidence (not committed): a scratch script outside the repository, run with Node 24, imports
  the built `dist/index.js` and talks to local-only peers. Expected outcomes:
  - "identity read" → `ok`;
  - "small compressed JSON read" → `ok`;
  - "compressed answer above the cap" → `too-large` with peak growth ≤ 64 MiB;
  - "same-origin redirect" → `http` with the 3xx status and destination count 0.

  Run it against the base's dist too: the redirect case must then show `ok: true` and destination
  count 1. Report the Node version, case titles and outcomes. Delete the script.
- Browser evidence (not committed), the runtime check of the browser path:
  - In a scratch directory outside every repository: `bun add playwright@1.64.1` (the version that
    status `package.json:28` and console `package.json:28` pin), then
    `bunx playwright install chromium`. Bundle the built client with
    `bun build <contract>/dist/index.js --target=browser --format=esm --outfile=<scratch>/contract.js`.
  - The page loads the bundle from a local-only origin. No external network is used. The setup
    must let the base's client show a followed redirect, so that the red counterpart below can
    fail. How the test arranges that is its own choice.
  - In the page, call `fetchJson` with `fetch.bind(globalThis)` for each case. Expected outcomes:
    - "small gzip-compressed JSON" → `ok` with the value;
    - "small brotli-compressed JSON" → `ok` with the value;
    - "gzip answer above the cap" → `too-large`;
    - "brotli answer above the cap" → `too-large`;
    - "same-origin redirect" → `http`, status `0`, destination count 0;
    - "cross-origin redirect" → `http`, status `0`, destination count 0.
  - Run it with a bundle of the base's dist too: both redirect cases must then give `ok: true`
    with destination count 1. This proves that the check can fail.
  - Report the Chromium version, case titles, outcomes and call durations. Delete the scratch
    directory before the scope checks.
- The PR names version 2.5.2, the four finding ids by class only, the checks that ran, and the
  known limit: a browser cannot ask for identity, so it relies on its streaming decoder inside the
  cap.

## Repository: probe

Files:
- `package.json` (required, contract pin line only)
- `bun.lock` (required, contract lines only)
- `src/client.api-redirect.test.ts` (new, required)
- `README.md` (required)
- `docs/configuration.md` (required)

Behavior change: yes
The pin moves to a contract whose API reads refuse redirects and encoded bodies and use fixed texts.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`, `biome.json`,
`bunfig.toml`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `Dockerfile`, `src/client.ts`,
`src/check.ts`, `src/main.ts`, `src/client.test.ts`, `src/client.http-options.test.ts`,
`src/check.redirect.test.ts`, `docs/troubleshooting.md`.

Tool facts (verified in this run):
- Bun 1.4.0 (`package.json:8-10`). `bun run check` runs lint, typecheck and test
  (`package.json:19`). Lint is `biome check . && pulse-eslint . && pulse-workflows`
  (`package.json:16`).
- CI uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`.github/workflows/ci.yml:18`). That pinned file is byte-identical to the `51e95b0…` one and to
  the config clone (install, lint, typecheck, test).
- `biome.json` extends the shared config pinned at `04108fa…` (`package.json:23`), which equals the
  clone. `bunfig.toml:1-4` sets an 80 % line threshold.

Shared finding: the full contract `main` SHA that contains the merged #864 fix is the same for
probe, status, notify and console. The child that starts first records it as a finding. The others
read it before they start.

Behavior:
- Set `@lorenzh/pulse-contract` (`package.json:30`, today `7ce23aaf…`) to
  `github:lorenzh/pulse-contract#<merged contract main SHA>`, run `bun install`, and commit
  `package.json` and `bun.lock` together.
  - The jump also brings the 30 contract commits between `7ce23aa` and `1b5e7d3`. A compare of
    `index.d.ts` found no removed export name.
  - If `bun run check` needs any change outside the allowed list, request a hold.
- No production source changes. `apiError` (`src/client.ts:237-239`) and the `postResult` log
  (`:414`) then carry the contract's fixed texts.
- New `src/client.api-redirect.test.ts`. It drives the real API read path (`requestChecks` and
  `loadChecks`, `src/client.ts:298` and `:318`; `fetchChecks` `:375-387`) with the native `fetch` and
  local-only peers:
  - "authenticated check read is not redirected". Class: redirect following with credentials.
    Expected: the authenticated read fails as an HTTP error with the received 3xx status (logged as
    `fetching checks failed: HTTP <status>; …`, `src/client.ts:233,387`), no check from the redirect
    target is used, the target receives 0 requests and no credential, and the public `/checks`
    fallback is not taken, because it stays limited to 404 (`:308`).
  - "invalid JSON from the api logs the fixed text". Class: upstream body-text disclosure. Expected:
    the failure log line contains the literal `invalid JSON: response body is not valid JSON`
    (`src/client.ts:237`) and no received body text.
- `README.md`: one sentence that API reads follow no redirect (`PULSE_API_URL` must be the final
  endpoint), ask for uncompressed answers and refuse compressed ones. Monitored checks keep their
  own redirect rules.
- `docs/configuration.md:39`: the same facts in the `GET /checks` paragraph.

Completion evidence:
- Scope verification with this section's lists.
- `git diff --numstat "$BASE" HEAD -- package.json` prints `1	1	package.json`.
- `git diff --numstat "$BASE" HEAD -- bun.lock` prints `2	2	bun.lock`, and every changed line
  contains `pulse-contract`. That is the workspace dependency line and the package entry, as at
  `bun.lock:8` and `:78`. zod stays `4.6.7` in both contract versions.
- The two new tests fail on the base pin and pass on the new one. Report both runs by title.
- `bun run check` passes, including the existing `src/client.test.ts` cases for authenticated read,
  404 fallback and version mismatch, and `src/check.redirect.test.ts` for monitored targets.
- Test CPU measured the primary way. Expected delta under +0.1 s. Above +0.3 s, run the fallback
  for probe.

## Repository: status

Files:
- `package.json` (required, contract pin line only)
- `bun.lock` (required, contract lines only)
- `src/server.upstream-redirect.test.ts` (new, required)
- `README.md` (required)

Behavior change: yes
The proxy, readiness poll and page poller reads stop following redirects and, on the server, refuse
encoded bodies, through the new contract pin.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`, `biome.json`,
`bunfig.toml`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `Dockerfile`, `src/server.ts`,
`src/api-poll.ts`, `src/poller.ts`, `src/settings-poll.ts`, `src/subscribe-client.ts`,
`src/server.cache.test.ts`, `src/api-poll.test.ts`, `src/settings-poll.test.ts`,
`src/server.contract-modules.test.ts`.

Tool facts (verified in this run):
- Bun 1.4.0 (`package.json:8-10`, `:38`). `bun run check` runs lint, typecheck (also `-p e2e`) and
  test (`package.json:13,19`).
- CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), which equals the config clone.
- `biome.json` extends the shared config pinned at `04108fa…` (`package.json:24`).
  `bunfig.toml:1-4` sets an 80 % line threshold. Playwright 1.64.1 (`package.json:28`).

Shared finding: the merged contract `main` SHA, as in the probe section. The first child records
it, and the others read it before they start.

Behavior:
- Set the contract pin (`package.json:34`) to the merged SHA, run `bun install`, and commit
  `package.json` and `bun.lock` together.
- Confirm that every dist module that the new contract's `index.js` imports is in the allowlist at
  `src/server.ts:219-242`. The contract section adds none. If one is missing, request a hold: the
  allowlist is protected.
- New `src/server.upstream-redirect.test.ts`. It drives the real proxy path (`createStatusServer`,
  `src/server.ts:786`; `fetchRaw` `:405-430`) and the real readiness poll (`startApiPoll`,
  `src/api-poll.ts:24`) with the native `fetch` and local-only peers. Class: redirect following.
  - "proxy read of a redirecting api is not followed". Expected: the proxy keeps its public mapping
    for an `http` error (`src/server.ts:426-430`, `README.md:71`): the received 3xx status, body
    `{"error":"API error"}`, no `location` header in the proxy answer, and 0 requests at the
    redirect target.
  - "readiness poll counts a redirecting api as an error". Expected: outcome `error`, and 0
    requests at the redirect target.
- `README.md:73`: state that every API request follows no redirect, and that on the server it asks
  for and requires uncompressed answers. The browser poller relies on the browser's decoding inside
  the 5 MiB cap. The version error now shows a fixed text without the received header.

Completion evidence:
- Scope verification with this section's lists.
- `package.json` numstat `1	1`, and `bun.lock` numstat `2	2` with every changed line containing
  `pulse-contract` (as at `bun.lock:8` and the package entry).
- The new tests fail on the base pin (the proxy serves the destination's data with `200`) and pass on
  the new one. Report by title.
- `bun run check` passes, including `src/server.cache.test.ts` (mapping), `src/settings-poll.test.ts`
  (existing redirect guard) and `src/server.contract-modules.test.ts` (allowlist).
- Start `bun start` against a local fake api and load the page once. The page renders checks, and
  `/pulse-contract/client.js` and `/pulse-contract/version.js` answer `200`. Report the command and
  the result.
- Test CPU measured the primary way. Expected delta under +0.1 s. Above +0.3 s, run the fallback
  for status.

## Repository: notify

Files:
- `package.json` (required, contract pin line only)
- `bun.lock` (required, contract lines only)
- `README.md` (required)
- `docs/operation.md` (required)

Behavior change: yes
The pin moves to the fixed contract, so API reads also refuse encoded bodies at the shared client.
notify's own guards stay.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`, `biome.json`,
`bunfig.toml`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `Dockerfile`, every path under
`src/` (`git diff --exit-code "$BASE" HEAD -- src`), and every path under `test/`
(`git diff --exit-code "$BASE" HEAD -- test`). That includes `test/api-hostile.test.ts`,
`test/api-limits.test.ts`, `test/security-review.test.ts` and `test/security.token-header.test.ts`.

Tool facts (verified in this run):
- Bun 1.4.0 (`package.json:9`, `:35`). `bun run check` runs lint, typecheck and test
  (`package.json:17`).
- CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), which equals the config clone.
- `biome.json` extends the shared config pinned at `04108fa…` (`package.json:22`).
  `bunfig.toml:1-4` sets an 80 % line threshold.

Shared finding: the merged contract `main` SHA, as in the probe section. The first child records
it, and the others read it before they start.

Behavior:
- Set the contract pin (`package.json:30`) to the merged SHA, run `bun install`, and commit
  `package.json` and `bun.lock` together.
- These stay unchanged: `noRedirect` (`src/api.ts:146-149`), the service capture wrapper
  (`src/api.ts:380-381`), `apiError`'s fixed texts (`src/api.ts:101-124`), URL redaction and the
  body limits.
- `README.md`: one sentence that API reads go through the shared contract client, which follows no
  redirect, asks for uncompressed answers and refuses compressed ones. notify keeps its own
  no-redirect wrapper.
- `docs/operation.md:229`: the same facts next to "owns the timeout, the size cap and the wire
  check".

Completion evidence:
- Scope verification with this section's lists.
- `package.json` numstat `1	1`, and `bun.lock` numstat `2	2` with every changed line containing
  `pulse-contract`.
- `bun run check` passes, with the hostile-input, limit and security tests unchanged (protected).
- Test CPU measured the primary way. Expected: no change beyond noise. Above +0.3 s, run the fallback
  for notify.
- If anything outside the allowed list must change, request a hold.

## Repository: console

Files:
- `package.json` (required, contract pin line only)
- `bun.lock` (required, contract lines only)
- `README.md` (required)
- `docs/configuration.md` (required)

Behavior change: yes
The pin moves to the fixed contract: reads and writes refuse encoded bodies, and the wire and JSON
texts are fixed. console's own wrappers stay.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`, `biome.json`,
`bunfig.toml`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `Dockerfile`, every path under
`src/` (`git diff --exit-code "$BASE" HEAD -- src`), and every path under `e2e/`. That includes
`src/api-read.ts`, `src/connection-test.ts`, `src/api-failure.ts` and their tests.

Tool facts (verified in this run):
- Bun 1.4.0 (`package.json:9`, `:35`). `bun run check` runs lint, typecheck (also `-p e2e`) and test
  (`package.json:13,18`).
- CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), which equals the config clone.
- `biome.json` extends the shared config pinned at `04108fa…` (`package.json:24`).
  `bunfig.toml:1-4` sets an 80 % line threshold.
- `AGENTS.md:92` requires `README.md` and `docs/configuration.md` in the same change.

Shared finding: the merged contract `main` SHA, as in the probe section. The first child records
it, and the others read it before they start.

Behavior:
- Set the contract pin (`package.json:32`) to the merged SHA, run `bun install`, and commit
  `package.json` and `bun.lock` together.
- These stay unchanged: `src/api-read.ts:37` and `src/connection-test.ts:99`
  (`redirect: "manual"`), the wire-label logic in `src/api-failure.ts`, and the write mapping.
- `README.md`: one sentence in the pulse-api requirements that `PULSE_API_URL` must be the final
  endpoint (no redirect is followed), and that API answers must be uncompressed (compressed answers
  are refused). No new setting.
- `docs/configuration.md`: the same facts next to the API read rules (`:131`). The setup
  connection test (`:63`) reports a compressed answer as a failed connection.

Completion evidence:
- Scope verification with this section's lists.
- `package.json` numstat `1	1`, and `bun.lock` numstat `2	2` with every changed line containing
  `pulse-contract` (as at `bun.lock:8` and `:82`).
- `bun run check` passes, including the existing redirect tests (`src/runtime-read.test.ts`,
  `src/connection-test.test.ts`, `src/check-write.test.ts`, `src/token-write.test.ts`).
- Performance: do not run `bench/run.ts` (console is outside the harness). Report the median of
  three `TIMEFORMAT='%U %S'; time bun run test` runs per side on one machine. The expected delta is
  within 0.5 s (a literal from "Performance impact"). Above that, request a hold.
- If anything outside the allowed list must change, request a hold.

## Acceptance evidence (whole feature)

1. "Done when": contract's red run on base `src/` fails these tests:
   - the four memory cases;
   - the three redirect cases (same-origin, cross-origin, HTTPS-to-HTTP);
   - both fixed-text cases (invalid JSON, wire mismatch).

   The green run passes all of them. The expected values are literals in the tests: the 64 MiB
   budget, the 3xx statuses, destination count 0, the two fixed texts and the fixed cause.
2. contract `bun run check` and `git diff --exit-code -- dist` after a fresh build pass in CI,
   including the `openssl` TLS test.
3. Node 24 and Chromium evidence with the literal outcomes of the contract section, each with a
   red counterpart on the base's dist, reported by case title only.
4. Test CPU deltas reported per repository (three runs per side, median). contract is expected at
   +0.6 to +1.0 s against the 9.0 s budget and 2.0 s floor. console is within 0.5 s, with no
   harness run.
5. probe, status, notify and console pin the same full contract `main` SHA that contains the fix.
   `bun.lock` diffs are limited to the contract lines, and `bun run check` passes in each. probe's
   and status's new adoption tests fail on the old pin and pass on the new one. notify's and
   console's guard tests pass unchanged.
6. Every task records `BASE`, the fixture proof and the five scope checks with their outputs.
   Evidence and PR texts follow the disclosure rule.
