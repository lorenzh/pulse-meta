# Spec #864: contract: bound response memory and harden shared API reads

## Goal

The shared API client of pulse-contract (`fetchJson`, `requestJson`, `checkWireVersion`) must not
let an upstream answer get around its documented limits. Four audit findings reproduce on contract
`main` `1b5e7d3e268372a6241db05ae30272eab7299b10` (`audits/security/contract.md`, SEC-1, SEC-3,
SEC-4, SEC-5):

- SEC-1 (P2): Bun's `fetch` asks for `gzip, deflate, br, zstd` and expands a compressed answer in
  memory as it arrives, before `readText` (`src/client.ts:76-102`) can apply the 5 MiB cap. This
  also happens for a non-2xx answer whose body is never read.
- SEC-3 (P3): `exchange` builds `init = { signal }` (`src/client.ts:131`), so `fetchJson` follows
  redirects, including to another origin and from https to http, with custom headers.
- SEC-4 (P3): `checkWireVersion` puts the received header into its error
  (`src/version.ts:26`, `got "${header}"`), reaching `wire-mismatch.message`, `http.wire.error` and
  `requestJson`'s `response.wire.error`.
- SEC-5 (P3): `parseBody` copies the `JSON.parse` message into `invalid-json.message`
  (`src/client.ts:112-116`); that message can quote a token of the body.

Then the consumers that call the shared client move their contract pin to the fixed commit.

## Revision note

This is the second plan run. It answers the four defects of the plan review:

1. Browser compatibility now has runtime evidence: a local Chromium check with literal outcomes
   for compressed JSON, the decoded-body limit and redirect refusal, measured in this run on both
   the old and a prototype of the new client (contract section, "Browser evidence").
2. The memory fixture now has fixed compression parameters (brotli quality 1). Its cost was
   measured, and the contract `test_cpu_s` estimate is reconciled with the budget and with a hosted
   nightly value ("Performance impact").
3. The fallback bench command names the api checkout that owns `bench/run.ts`, its working
   directory and the `--b-ref` arguments for a consumer revision ("Performance impact").
4. `openssl` in CI is verified, not assumed. The GitHub `ubuntu-24.04` image lists OpenSSL 3.0.13,
   and kit's TLS test already runs `openssl` under the same pinned `check.yml` and passes (contract
   section, "Tool facts").

Third plan run: the second plan review found that the fallback bench command allowed
`--b-ref console=…`, which `api/bench/refs.ts:5,37-39` refuses, and that the harness has no console
metrics. The fallback is now limited to `contract`, `probe`, `status` and `notify`, and console is
measured only with the primary `bun run test` timing, without a budget comparison ("Performance
impact" and the console section). The refusal was reproduced in this run by calling `parseBRefs`.

## Evidence gathered for this spec

- Issue review `.factory/work/864/issue-review.md` (no earlier decisions; open points 1 to 7
  settled below). No shared findings exist yet: `gh api
  repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/864` answered HTTP 404 in this run.
- Clones read in this run: contract `1b5e7d3`, probe `9490141`, status `b7dfc7c`, notify
  `dde5261`, console `40c271e`, api `515031b`, kit `536133f`, config `main`.
- First plan run, Bun 1.4.0, one local `Bun.serve` answering a 421-byte brotli body (default
  quality) that decodes to 256 MiB, body cancelled without a read:
  - default `fetch`: request carried `accept-encoding: gzip, deflate, br, zstd`; peak RSS growth
    +318 MiB (status 200) and +306 MiB (status 500).
  - `fetch(url, { decompress: false })`: request carried no `accept-encoding`; the response kept
    `content-encoding: br`; peak RSS growth +0 MiB (200 and 500).
  - TLS origin (self-signed certificate made with `openssl`, trusted through Bun's
    `tls: { ca }`) answering 302 to a plain-http `127.0.0.1` target: `redirect: "follow"` reached
    the target; `redirect: "manual"` returned status 302 and the target got no request.
- This run, fixture cost. 256 blocks of 1 MiB of spaces streamed through `node:zlib`:

  | Encoder and parameters        | Bytes     | CPU s (Bun 1.4.0) | CPU s (Node 24.19.0) |
  | ----------------------------- | --------- | ----------------- | -------------------- |
  | brotli, default (quality 11)  | 421       | 3.51              | 2.57                 |
  | brotli, `BROTLI_PARAM_QUALITY` 1 | 48 289 | 0.06              | 0.04                 |
  | brotli, `BROTLI_PARAM_QUALITY` 0 | 175 188 | 0.09             | 0.07                 |
  | gzip level 9                  | 260 935   | 0.31              | 0.45                 |

  The plan review's 3.41 s per fixture is the default quality 11. Quality 1 costs about 1/60 of it.
- This run, memory child prototype (`Bun.serve` on `127.0.0.1:0`, brotli quality 1 fixture,
  `Bun.gc(true)`, RSS sampled every 5 ms during the call and 1000 ms after it). Each case is a
  separate `bun` process; CPU is the user + system time of that process:

  | Case                       | Client on `1b5e7d3`              | Prototype of this spec       |
  | -------------------------- | -------------------------------- | ---------------------------- |
  | `fetchJson` 200            | `too-large`, +351 MiB, 0.80 CPU s | `network`, +2 MiB, 0.24 CPU s |
  | `fetchJson` 500            | `http`, +348 MiB, 0.50 CPU s     | `http`, +2 MiB, 0.20 CPU s   |
  | `requestJson` POST 200     | `too-large`, +354 MiB, 0.65 CPU s | `network`, +2 MiB, 0.18 CPU s |

  The prototype was a patch of a scratch copy outside the clones (decision 1 to 3 below). It was not
  committed.
- This run, Node 24.19.0 with native `fetch` against `node:http` on `127.0.0.1:0`, importing the
  built `dist/index.js`. On `1b5e7d3`: identity JSON gave `ok`, the brotli 256 MiB answer gave
  `too-large` with +38 MiB, and a `302` to `/dest` was followed (`ok: true`, destination count 1).
  On the prototype: `ok`, `too-large` with +34 MiB, and `http` 302 with destination count 0. Node
  decodes inside the body stream that the counting loop reads, so the cap bounds the decoded
  bytes. It ignores the unknown `decompress` init member.
- This run, Chromium 156.0.8078.4 (Playwright 1.64.1 headless shell) loading a browser bundle of
  the built contract dist from a local `node:http` page origin:

  | Request                                                    | `1b5e7d3`                       | Prototype                 |
  | ---------------------------------------------------------- | ------------------------------- | ------------------------- |
  | `/small`, gzip of `{"a":1}`                                | `ok`, value `{"a":1}`           | `ok`, value `{"a":1}`     |
  | `/big`, gzip level 9 of 256 MiB of spaces                  | `too-large` (74 ms)             | `too-large` (39 ms)       |
  | `/bigbr`, brotli quality 1 of 256 MiB of spaces            | `too-large` (41 ms)             | `too-large` (32 ms)       |
  | `/same`, `302` to same-origin `/dest`                      | `ok`, value `{"a":3}`, dest 1   | `http`, status 0, dest 0  |
  | `/cross`, `307` to a second origin (CORS `*`)              | `ok`, value `{"a":2}`, dest 1   | `http`, status 0, dest 0  |

  The browser sent its own `accept-encoding: gzip, deflate, br, zstd` on every request and dropped
  the client's `identity` silently, without an error. With `redirect: "manual"` a browser returns
  an opaque redirect (status 0).
- `openssl` in CI: the pinned `check.yml` runs on `runs-on: ubuntu-24.04` with no container
  (`lorenzh/pulse-config` `.github/workflows/check.yml:16` at `51e95b0eb463b27a196a33b428607bd92443e4f0`).
  The GitHub runner image readme for that label
  (`actions/runner-images` `images/ubuntu/Ubuntu2404-Readme.md`, commit `dbf2f009b5e1dcce57cf578ff4fdc1391a4d6d1b`,
  image version 20261101.360.1) lists "OpenSSL 3.0.13-0ubuntu3.16" at line 94. kit's
  `test/guarded-fetch.tls.test.ts:30-54` runs `openssl req -x509` in `beforeAll` under the same
  `check.yml@51e95b0…` (`kit/.github/workflows/ci.yml:17`), and kit CI on `main` `536133f` passed
  (https://github.com/lorenzh/pulse-kit/actions/runs/41814062315). probe's `src/tls.test.ts:16-27`
  does the same under `check.yml@04108fa…`, which is byte-identical to the `51e95b0…` file.
- Callers of the shared client (all inspected on `main` of each clone):
  - probe `9490141`: `src/client.ts` `fetchChecks`/`loadChecks` use `fetchJson` with the injected
    fetch unwrapped; `postResult` logs `version.error` (`src/client.ts:412-414`); `apiError` puts
    `error.message` into `invalid JSON: …` and `contract version mismatch: …`
    (`src/client.ts:237-239`). Pin `7ce23aaf3fa3e038f65ecfed755188b83bde143f` (`package.json:30`).
  - status `b7dfc7c`: `src/api-poll.ts:24`, `src/poller.ts:235,328` and the proxy in
    `src/server.ts:419` call `fetchJson` without a redirect guard; `src/settings-poll.ts:112,169`
    and `src/subscribe-client.ts` already use `redirect: "manual"`. The browser page poller runs
    the contract client in the browser: status serves a fixed allowlist of contract dist modules
    (`src/server.ts:219-242`, includes `client.js` and `version.js`), and `README.md:73` documents
    the browser use. Pin `1b5e7d3…` (`package.json:34`).
  - notify `dde5261`: `src/api.ts:146-149` and `:380-381` wrap the fetch with
    `{ ...init, redirect: "manual" }`; `apiError` (`src/api.ts:101-124`) maps every kind to its own
    fixed text. Hostile-input and redirect tests in `test/api-hostile.test.ts`,
    `test/api-limits.test.ts`, `test/security-review.test.ts`. Pin `1b5e7d3…` (`package.json:30`).
  - console `40c271e`: `src/api-read.ts:37` and `src/connection-test.ts:99` wrap with
    `{ ...init, redirect: "manual" }`; writes use `requestJson`. Pin `1b5e7d3…` (`package.json:32`).
  - api `515031b`: no call of `fetchJson`, `requestJson` or `checkWireVersion` in `src/`
    (`grep -rn 'fetchJson\|requestJson\|checkWireVersion' api/src` is empty). Not affected.
  - Every consumer wrapper spreads the `init` it receives (`{ ...init, redirect: "manual" }`) or
    passes it through, so init members that the contract adds reach Bun's `fetch`.
- No pulse service or deploy file compresses responses: `grep -rni
  'content-encoding\|compress\|gzip\|brotli\|zstd'` over the `src/` trees of api, status, probe,
  notify, console and over deploy is empty.

## Decisions (settled from the issue and the evidence)

1. **Encoding policy.** Every request of `fetchJson` and `requestJson` asks for no content coding:
   the init carries Bun's `decompress: false` (other runtimes ignore it) and the header
   `accept-encoding: identity`, set after the caller's headers so it overrides a caller value
   (browsers drop it silently as a forbidden header, measured above). Under Bun (feature check
   `"Bun" in globalThis`, no import), the body then stays encoded as sent, so a response whose
   `Content-Encoding` is present and, after trim and lower-casing, neither `""` nor `identity` is
   refused before any body read. Other runtimes (Node, browsers) decode inside the body stream that
   the counting loop reads, so the existing cap bounds the decoded bytes there (Node and Chromium
   measured above); they do not refuse on `Content-Encoding`. Refusing in browsers would break the
   status page poller behind any compressing proxy, because a browser cannot ask for identity. No
   decoder is added.
2. **Failure shape of a refused encoding.** No new error kind. On the GET path and on a `2xx`
   write it is `{ kind: "network", cause }`, where `cause` is an `Error` with the fixed message
   `response content-encoding is not supported` that does not contain the header value. For a
   non-`2xx` write it stays the `http` error, without `message` (the body is not read). The body is
   dropped without waiting, as today.
3. **Order of checks.** `fetchJson`: HTTP status, wire header, content encoding, size, JSON,
   validation. `requestJson`: HTTP status (for non-`2xx`, the encoding decides whether the
   `ErrorResponse` body is read for `message`), wire header, content encoding, size, empty body,
   JSON, validation. HTTP and wire precedence are unchanged.
4. **Redirects.** `fetchJson` passes `redirect: "manual"`, as `requestJson` already does. A visible
   `3xx` is the existing `http` error with that status; a browser's opaque redirect (status 0) is an
   `http` error with status 0; a runtime that rejects is `network`. Same-origin redirects are
   refused too. No option to allow redirects is added.
5. **Fixed texts.** `invalid-json.message` is always `response body is not valid JSON`.
   `checkWireVersion` mismatch `error` is always `x-pulse-contract: unsupported wire version,
   expected 1`, built from `WIRE_VERSION_HEADER` and `WIRE_VERSION` only. The comparison rule (trim,
   digits only, equal to `WIRE_VERSION`) does not change. `requestJson`'s documented
   `http.message` (`ErrorResponse.error`, at most 1000 characters), the caller's abort `reason`,
   the transport `cause` and validator messages are out of scope and stay as they are.
6. **Consumers.** probe, status, notify and console move their pin; api keeps its pin because it
   calls no shared-client function. kit, config, website, deploy and agent have no contract
   dependency.
7. **Package version.** contract `2.5.1` → `2.5.2` (patch: no type or wire change).
8. **Browser evidence stays local.** The Chromium check is completion evidence run in a scratch
   directory, not a committed test: contract has no browser in its dev tooling and its pinned CI
   installs none (`check.yml` lines 18-38). No dev dependency is added to contract for it.

## Scope

- contract: `src/client.ts`, `src/version.ts`, tests, README, `docs/index.md`, `package.json`
  version, regenerated `dist/`.
- probe, status, notify, console: pin bump with `bun.lock`, one adoption regression in probe and
  status (they have no own redirect guard on the affected reads), doc lines where the repository
  describes the shared client's limits.

## Non-goals

- No streaming decoder for gzip, deflate, brotli or zstd.
- No change to error kinds, result shapes, exported names, `WIRE_VERSION`, `DEFAULT_MAX_BODY_BYTES`,
  timeout, abort, first-interruption or cancellation semantics.
- No change to `requestJson`'s `http.message`, to probe's own check HTTP client (`src/check.ts`),
  or to notify's guards from #553 (they stay even though they become partly redundant).
- No api pin bump, no other audit finding (SEC-2, SEC-6, N1).
- No committed browser test and no Playwright dependency in contract.

## Required behavior

- R1 Bun peak RSS: `fetchJson` and `requestJson` under Bun, against a local answer whose body is a
  brotli encoding of 256 MiB, keep the process's peak RSS growth under 64 MiB, for a `200` answer,
  a `500` answer and a `2xx` write answer. On `main` the growth is about 350 MiB (measured above).
- R2 Encoding refusal (Bun): `2xx` + `content-encoding: br|gzip|deflate|zstd|x-unknown|"identity, gzip"`
  → `network` with the fixed cause; `content-encoding` absent, `identity`, ` IDENTITY ` or `""` →
  normal read. `fetchJson`'s validator is not called for a refused answer.
- R3 Redirects: `fetchJson` never issues a request to a `Location`; statuses 301, 302, 303, 307,
  308 give `{ ok: false, error: { kind: "http", status: <3xx>, wire } }` under Bun and Node, and
  `http` with status 0 in a browser.
- R4 Fixed texts as in decision 5, at every place a wire check or JSON parse error surfaces:
  `checkWireVersion(...).error`, `fetchJson` `wire-mismatch.message`, `fetchJson` `http.wire.error`,
  `requestJson` `error.message` for a `2xx` mismatch, `requestJson` `response.wire.error` and
  `http.wire.error`, and `invalid-json.message` of both functions.
- R5 Compatibility: every existing contract test keeps passing, except the assertions that this
  spec changes on purpose (listed in the contract section). Identity and browser-decoded JSON keep
  reading as before in Bun, Node 24 and Chromium.

## Performance impact

The api's own metrics in `api/bench/budgets.json` (`startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, the `p95_*`, `rps`, `image_mb`,
`cold_*`, `eod_*` keys): none expected, because the api calls no shared-client function and keeps
its contract pin.

Other keys of the same file:

- `contract.test_cpu_s` (budget 9.0 s, floor 2.0 s, `api/bench/budgets.json`; the failure rule is
  `B - A > max(A × 10 %, floor)` or B above the budget, `api/bench/README.md:108-109`): up by
  about 0.6 to 1.0 s. Basis:
  - the three memory children measured 0.18 to 0.24 CPU s each on the prototype, 0.62 s together.
    Fixture generation is part of that (brotli quality 1: 0.04 to 0.06 s; quality 11 at 2.6 to
    3.5 s is forbidden by the test section).
  - the transport tests (local servers, one EC P-256 `openssl` certificate) are estimated at 0.4 s
    at most.
  - Hosted reference: the nightly bench run https://github.com/lorenzh/pulse-api/actions/runs/42357126694
    (2026-11-07) reports contract `test_cpu_s` A 4.72 s, B 3.78 s. B + 1.0 s = 4.78 s stays under
    the 9.0 s budget, and +1.0 s stays under the 2.0 s floor. On the Factory runner (12 cores) the
    current suite took 7.0 and 8.1 s user + system in two runs of `bun run test` in this planning
    run. Compare numbers only within one machine.
  - On the red run (old `src/`) the memory children cost about 1.9 s together, because the old
    client decodes the 256 MiB. That run is evidence only, not CI.
- `contract.build_cpu_s`: unchanged (two source files change by a few lines).
- `probe`, `status`, `notify` `peak_rss_mib` / `idle_rss_mib`: unchanged for normal traffic (the
  api sends identity bodies). They no longer grow with a compressed hostile answer. `startup_*`,
  `load_cpu_s`, `image_mb`: unchanged (one request header more, no new code path in the hot loop).
  `test_cpu_s`: up by under 0.1 s in probe and status (one or two local-server tests each). For
  reference, the same nightly reports B 1.53 s for probe (budget 2.3 s) and B 2.82 s for status
  (budget 3.4 s). Status and notify already show `FAIL regression` against their old A in that
  nightly, before this change.
- How to measure:
  - Primary, in each changed repository: run `bun run test` three times on `main` and three times
    on the branch with bash's builtin `TIMEFORMAT='%U %S'; time bun run test`, and report the median
    of user + system seconds for each side. This is the quantity the harness reads
    (`Bun.spawn(...).resourceUsage()` user + system, `api/bench/measure.ts:51-73`). `/usr/bin/time`
    is not installed on the Factory runner, so use the builtin.
  - Fallback, only for `contract`, `probe`, `status` or `notify`, and only if one of those
    consumer children changes more than its pin and its tests, or the primary contract delta
    exceeds 1.5 s: the harness lives only in the api repository (`bench/run.ts`), so clone it into
    a scratch directory outside the target repository and run it from that checkout's root:
    `git clone https://github.com/lorenzh/pulse-api.git <scratch>/pulse-api && cd <scratch>/pulse-api && bun install --frozen-lockfile`,
    then `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref <target>=<pushed branch name or SHA> --rounds 1`,
    where `<target>` is one of `contract`, `probe`, `status`, `notify`. The flags are from
    `api/bench/README.md:76-88`; `--b-ref` needs `--others-ref` and must name a ref the harness can
    `git fetch` from the public repository. The harness needs Docker with Compose. A run takes
    several minutes per round; report the target's rows of the table.
  - console is outside the harness: `api/bench/refs.ts:5` lists the repositories `api`, `probe`,
    `status`, `notify`, `contract`, `kit`, `config`, `parseBRefs` (`refs.ts:37-39`) refuses any other
    name with a usage error, and `api/bench/budgets.json` (api `515031b`) has no `console` key.
    In this planning run `parseBRefs(["console=main"], "main")` threw
    `--b-ref: not a non-api repository: console`, and the same call accepted each of the other
    four. So no console metric of `bench/budgets.json` can move, and the console child never
    runs the fallback. Its only measurement is the primary one above: the median of three
    `bun run test` runs (user + system seconds, bash `time` builtin) on `main` and on the branch,
    reported without a budget comparison. Expected delta: none beyond run-to-run noise, because the
    child changes only `package.json` and `bun.lock`. console's tests drive the real contract
    client against local `Bun.serve` servers with identity bodies (for example
    `src/connection-test.test.ts:105`, `src/server.security.test.ts:78`), and the fix adds only one
    request header and one header check per answer on that path. If the console delta exceeds 0.5 s, or the child
    needs to change more than its pin, it requests a hold instead of measuring further: that is
    outside this spec.

## Security impact

Security impact: yes
The change hardens a parser and HTTP client at a trust boundary (contract), its redirect handling,
its body limits and error texts that carry external data, and bumps dependency pins.

Checklist items that apply:

- Secrets in errors, logs and responses: invalid-JSON and wire-mismatch texts must carry no body or
  header bytes; the refused-encoding cause carries no header value.
- Body and size limits: the 5 MiB cap (and a custom `maxBytes`) must bound memory under Bun for
  encoded answers, including answers dropped for HTTP or wire errors.
- SSRF and redirects: `fetchJson` follows no redirect (same-origin, cross-origin, https→http); a
  custom credential header never reaches the redirect target.
- Input validation: the content-coding check fails closed for unknown and combined codings.
- Dependency pins: each consumer pins the full merged contract `main` SHA with a consistent
  `bun.lock`; no new runtime or dev dependency anywhere.

## Rollout order

1. contract merges the fix to `main` (version 2.5.2). Nothing on the wire changes: same paths,
   shapes and `WIRE_VERSION` 1. Every consumer still on an older pin keeps working exactly as
   before, with the old (vulnerable) client behavior, until its pin moves. The api serves identity
   bodies and no redirects on its routes, so the new client behavior changes nothing for traffic
   between pulse services.
2. probe, status, notify and console bump their pins in any order (parallel). Each one works against
   any api, notify or status version, because the change is client-side only. Mixed fleets (for
   example a new probe with an old status) keep working: no service reads another service's error
   texts. A status page served by a new status runs the new client in the browser. In the browser
   the only changes are `redirect: "manual"` and a header that the browser drops (measured in
   Chromium above), and the status page reads go to its own origin without redirects.
3. api is not bumped in this feature (it does not call the client); a later contract change bumps
   it.

## Counterexamples

- Body limit vs. encoding (Bun): a 48 289-byte `200` answer with `content-encoding: br` (brotli
  quality 1) that decodes to 256 MiB must give `network` (not `too-large`, not `ok`) and peak RSS
  growth under 64 MiB. A wrong fix that only cancels the body or only sends
  `accept-encoding: identity` still grows by about 300 MiB (audit SEC-1 and the measurements
  above).
- Early discard (Bun): a `500` answer with the same body must give `http` 500 and growth under
  64 MiB; a fix that checks the encoding only before `readText` misses it, because Bun decodes
  before any read unless `decompress: false` is on the request.
- Small encoded body: a 30-byte `200` answer with `content-encoding: gzip` and a 1 MiB `maxBytes`
  must be `network`, never `too-large`.
- Combined coding: `content-encoding: identity, gzip` must be refused; a check for "contains
  identity" gets it wrong.
- Case and space: `content-encoding:  Identity ` must be read normally.
- Precedence: `200` + wire header `2` + `content-encoding: br` → `wire-mismatch`; `503` +
  `content-encoding: br` → `http` 503 (not `network`); `requestJson` `412` with a gzip-encoded
  `ErrorResponse` → `http` 412 without `message` (not `network`, not `too-large`).
- Same-origin redirect: `302` with `location: /other` on the same host must not be followed; a
  fix that refuses only cross-origin targets gets it wrong.
- HTTPS to HTTP: a TLS origin answering `307` to `http://127.0.0.1:<port>/` with a custom header
  `x-api-key` must give `http` 307 and the target must count 0 requests.
- Fixed JSON text: two different malformed bodies, each with its own marker word at the parser's
  failure position, must give byte-equal `invalid-json.message` values equal to the literal
  `response body is not valid JSON`; a fix that only shortens the parser message still leaks a
  short marker.
- Fixed wire text: header values `2` and a 4000-character value containing a marker must both give
  the literal `x-pulse-contract: unsupported wire version, expected 1`; a fix that cuts the value to
  a prefix still leaks the marker.
- Comparison unchanged: `" 1 "` stays `ok`; `"1.0"`, `"01x"`, `""`, `"1e0"` stay `mismatch`.
- Non-Bun runtime (Node 24): a `200` brotli answer decoding to 256 MiB must give `too-large` (not
  `network`) with peak growth under 64 MiB. A fix that refuses on `Content-Encoding` everywhere
  would also refuse in browsers and break the status page behind a compressing proxy.
- Browser: a gzip-encoded `{"a":1}` must give `ok` with value `{"a":1}` (a fix that refuses
  encoded bodies outside Bun gives `network`); a same-origin `302` must give `http` with status 0
  and destination count 0 (the old client gives `ok` with the destination's value).
- Fixture cost: a fixture made with the default brotli quality (11) costs 2.6 to 3.5 CPU s per
  build (measured above). The test must set quality 1.

No statistic is introduced. "Peak RSS growth" is defined in the contract section.

## Contract fields

No new names: no new export, error kind, result field, option, header constant or module file.
New fixed texts and the init member/header the client sends do not collide with existing ones:

- `grep -rn 'not valid JSON' .repos/contract/src .repos/config` → no match.
- `grep -rn 'unsupported wire version' .repos/contract/src .repos/config` → no match.
- `grep -rni 'content-encoding\|decompress\|accept-encoding' .repos/contract/src .repos/config` →
  no match (excluding `node_modules`).

`decompress` is Bun's existing request option, typed in a local, unexported type; it does not
appear in `dist/*.d.ts`.

## Repository: contract

Files:
- `src/client.ts`
- `src/version.ts`
- `test/client.test.ts`
- `test/request-json.test.ts`
- `test/version.test.ts`
- `test/client-transport.test.ts` (new)
- `test/client-memory.test.ts` (new)
- `test/client-memory-child.ts` (new, not a `*.test.ts` file)
- `dist/client.js`, `dist/version.js` (regenerated by `bun run build`; other dist files only if
  the build changes them)
- `README.md`
- `docs/index.md`
- `package.json` (version only)

Behavior change: yes
The shared client changes its redirect handling, its content-coding handling and two error texts.

Tool facts (verified):
- Bun 1.4.0: `package.json` `packageManager` and `engines` (`package.json:7-10`); CI installs Bun
  1.4.0 through `lorenzh/pulse-config/.github/workflows/check.yml` at
  `51e95b0eb463b27a196a33b428607bd92443e4f0` (`.github/workflows/ci.yml:17`), lines 22-24 of that
  file. The pinned `check.yml` (read with `gh api …?ref=51e95b0…`) is identical to the config
  clone's `main`.
- CI steps at that pin: install, `bun run lint`, `bun run typecheck`, `bun run build`,
  `git diff --exit-code -- dist`, `bun run test` (`check.yml` lines 25-38; `build: true` from
  `ci.yml:18-19`). CI runs on `ubuntu-24.04` without a container (`check.yml:16`).
- `bun run check` = lint, build, typecheck, test (`package.json:28`); lint = `biome check . &&
  pulse-eslint .` (`package.json:25`); build and typecheck use `typescript7` (`package.json:22-23`).
- Biome: `biome.json` extends `@lorenzh/pulse-config/biome.json`
  (pin `51e95b0…`, `package.json:32`), whose `files.includes` (lines 10-17) ignores `**/dist` and
  `**/test/fixtures`; identical to the config clone.
- `bun test` collects coverage with an 80 % line threshold and ignores `test/**`
  (`bunfig.toml:1-4`); only `*.test.ts` files run, so `test/client-memory-child.ts` is not run as a
  test (same pattern as `test/validate-cpu.ts`).
- `openssl` in CI is verified (see "Evidence gathered"): OpenSSL 3.0.13 is listed in the
  `ubuntu-24.04` runner image readme (`actions/runner-images@dbf2f009…`
  `images/ubuntu/Ubuntu2404-Readme.md:94`), and kit's `test/guarded-fetch.tls.test.ts:30-54` runs it
  under the same `check.yml@51e95b0…` in a passing CI run. Use the same call form as kit: `execFileSync("openssl", [...], { stdio: "ignore" })`
  with the line comment
  `// eslint-disable-next-line sonarjs/no-os-command-from-path -- openssl from PATH makes a test-only certificate`
  (`kit/test/guarded-fetch.tls.test.ts:32`; kit pins the same config `51e95b0…`). Generate an EC
  P-256 key (`-newkey ec -pkeyopt ec_paramgen_curve:prime256v1`), not RSA, to keep the cost low.
  Commit no key material.

### Behavior

1. `src/client.ts`
   - One shared helper builds the request init for both functions: `signal`, `redirect: "manual"`,
     `decompress: false`, and `headers = new Headers(options.headers)` with
     `accept-encoding: identity` set last (`requestJson` adds `content-type` as today). Type it as a
     local `RequestInit & { decompress?: boolean }`; no `bun-types` or `node:` import.
   - One shared check, run before every body read: under Bun (`"Bun" in globalThis`), a
     `Content-Encoding` that is present and, trimmed and lower-cased, neither `""` nor `identity`
     refuses the body. `fetchJson` and `requestJson` `2xx` then drop the body without waiting and
     return `network` with `cause` `new Error("response content-encoding is not supported")`.
     `requestJson` non-`2xx` drops the body and returns `http` without `message`.
   - `parseBody` returns `{ kind: "invalid-json", message: "response body is not valid JSON" }`
     for every parse failure; the parser's error is not used (a deliberate ignore with a one-line
     comment, per `AGENTS.md` "Errors").
   - Keep `readText`, the Content-Length check, `dropBody`, `interruptible`, the timeout and abort
     semantics, `getManualIncidents`/`getManualIncident` and all exported types unchanged.
   - Update the doc comments of `fetchJson` and `requestJson` (order of checks, no redirect,
     identity only).
2. `src/version.ts`: the mismatch `error` is
   `` `${WIRE_VERSION_HEADER}: unsupported wire version, expected ${WIRE_VERSION}` ``; the header
   value is never interpolated. The `ok`/`absent`/`mismatch` decision is unchanged.
3. No new `src/` module and no new import between dist modules: status serves a fixed allowlist of
   contract dist files to the browser (status `src/server.ts:219-242`).
4. `README.md`: add pulse-console to the consumer list (line 7); state in the client paragraph that
   both functions follow no redirect, ask for identity coding, refuse an encoded body under Bun and
   use fixed texts for invalid JSON and wire mismatches.
5. `docs/index.md` "API client": document the init the client sends, the encoding rule per runtime
   (Bun refuses; Node and browsers decode inside the capped stream; a browser cannot ask for
   identity), the redirect rule (3xx → `http` with that status; browser opaque redirect → `http`
   with status 0), the new order of checks, the two fixed texts, the `network` row "also a refused
   content coding under Bun", and the `requestJson` non-`2xx` encoded case. Add pulse-console to
   "Bump the pin in a consumer" (line 754). Add a "Contract 2.5.2 is a patch …" note next to the
   2.5.1 note (line 524).
6. `package.json` `version` `2.5.2`. Run `bun run build` and commit `dist/`.

### Tests

Write the tests first and keep the red run (decision: the "Done when" of the issue).

- `test/client-memory-child.ts`: one Bun process per case. It builds the fixture by streaming a
  1 MiB block of spaces (`0x20`) 256 times through
  `zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } })` from
  `node:zlib` (the 256 MiB decoded buffer is never held; measured 48 289 bytes and 0.04 to 0.06
  CPU s; do not use the default quality, which took 2.6 to 3.5 CPU s). It starts `Bun.serve` on
  `127.0.0.1` port `0` that answers the fixture with `content-encoding: br` and
  `x-pulse-contract: 1`, then runs `Bun.gc(true)`, takes the baseline
  `process.memoryUsage().rss`, samples RSS every 5 ms during the call and for 1000 ms after it,
  and prints one JSON line `{ kind, peakGrowthMiB }`. Cases: `fetchJson` `200`, `fetchJson` `500`,
  `requestJson` POST `200` (body `"{}"`), each with the native `fetch` and the default cap. It
  imports `../src/index.ts`.
- `test/client-memory.test.ts`: spawns the child with `process.execPath` per case (sequentially),
  kills it after 30 s, and asserts `peakGrowthMiB < 64` and the expected `kind` (`network`,
  `http`, `network`). Sources of the expected values: the 64 MiB budget is a literal, set between
  the measured +2 MiB of the prototype and the +348 to +354 MiB of `1b5e7d3` (this spec's
  measurements); the kinds are literals from decisions 2 and 3. Peak RSS growth = maximum sampled
  RSS minus the baseline RSS, in MiB, rounded down. Test timeout 60 s.
- `test/client-transport.test.ts` (native Bun `fetch`, servers on `127.0.0.1` port `0`, closed
  in `afterAll`):
  - Redirects: same-origin `302` (`location: /dest`), cross-origin `307` and `301` to a second
    server, `303` and `308`; each with header `x-api-key: <marker>`. Expect `ok: false`, `kind`
    `http`, the 3xx status, and a request count of 0 on every destination.
  - HTTPS to HTTP: a TLS `Bun.serve` with an EC key and a self-signed certificate for `127.0.0.1`
    (`-subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 -days 2`) generated by `openssl`
    into a `mkdtemp` directory (removed in `afterAll`). The test's `fetch` wraps the native one as
    `(input, init) => fetch(input, { ...init, tls: { ca } })`, trusting only that certificate. It
    answers `302` to the plain-http server: `http` 302, destination count 0. A missing `openssl`
    must fail the test (no skip).
  - Encoding: `content-encoding` `gzip` on a small valid gzip body, `br`, `zstd`, `x-unknown`,
    `identity, gzip` → `network` whose `cause` is an `Error` with the literal message
    `response content-encoding is not supported` and whose serialized result does not contain the
    header value; `identity` and absent → `ok`; the request carried `accept-encoding: identity`
    (asserted at the server). Precedence cases from "Counterexamples".
  - Identity body over the default cap (Content-Length and chunked) → `too-large` as before.
- `test/client.test.ts` and `test/request-json.test.ts`:
  - Two malformed bodies with different marker words → both `invalid-json.message` equal the
    literal `response body is not valid JSON`; neither marker appears in `JSON.stringify(result)`.
  - Wire header `2` and a 4000-character marker-bearing value → literal
    `x-pulse-contract: unsupported wire version, expected 1` in `wire-mismatch.message` (GET `200`),
    `error.wire.error` (GET `500`), `requestJson` `2xx` `error.message` and `response.wire.error`,
    and `requestJson` `422` `error.wire.error`; no marker in the serialized result.
  - Injected-fetch check that `fetchJson` passes `redirect: "manual"`, `decompress: false` and
    `accept-encoding: identity`, and that a caller header (`authorization`) and a caller
    `accept-encoding: gzip` arrive as `authorization` kept and `accept-encoding` `identity`.
  - Change on purpose: "passes headers and signal to fetch" reads headers through
    `new Headers(seen.headers)`; "wire mismatch is a typed error with the checkWireVersion text"
    asserts the literal text instead of deriving it from `checkWireVersion`.
  - A source check that `src/client.ts` and `src/version.ts` contain no `from "node:` and no
    `from "bun` import (browser compatibility).
- `test/version.test.ts`: the literal text for `"2"`, `""` and a long marker value; keep the
  existing ok/absent/mismatch cases.

### Completion evidence

- Red run: with the new and changed tests in place and `src/` taken from `1b5e7d3`
  (`git checkout 1b5e7d3e268372a6241db05ae30272eab7299b10 -- src`), `bun test
  test/client-memory.test.ts test/client-transport.test.ts test/client.test.ts
  test/request-json.test.ts test/version.test.ts` fails on: memory growth over 64 MiB, followed
  redirects (destination count 1, `ok: true`), and both upstream-text assertions. Report the failing
  test names and the measured `peakGrowthMiB` values; then restore `src/`.
- Green run: `bun run check` passes; `bun run build` followed by `git diff --exit-code -- dist`
  is clean (the build and the committed dist are produced independently).
- Test CPU: the primary measurement of "Performance impact" for contract (three runs per side,
  median of user + system). The expected delta is +0.6 to +1.0 s; above +1.5 s, run the fallback
  harness command and report it.
- Node evidence (not committed): in a scratch directory outside the repository, a script run with
  Node 24 that imports the built `dist/index.js` and starts `node:http` servers on `127.0.0.1:0`.
  Expected literals: identity `{"a":1}` → `ok: true`, value `{"a":1}`; `302` → `http` 302 with
  destination count 0; the brotli quality 1 answer of 256 MiB of spaces → `too-large` with peak
  RSS growth under 64 MiB. Run it once with the dist of `1b5e7d3` too: the `302` case must then
  show `ok: true` and destination count 1. Report the Node version and both outputs.
- Browser evidence (not committed), the runtime check of the browser path:
  - Setup, in a scratch directory outside the repository: `bun add playwright@1.64.1` (the
    version that status and console pin, status `package.json:28`, console `package.json:28`),
    `bunx playwright install chromium`, and a browser bundle of the built client:
    `bun build <contract>/dist/index.js --target=browser --format=esm --outfile=<scratch>/contract.js`.
  - A `node:http` page origin on `127.0.0.1:0` serves an empty HTML page and `contract.js`. A
    second server on `127.0.0.1:0` acts as the cross-origin destination and answers with
    `access-control-allow-origin: *`, so the old client's followed redirect is visible. Each answer
    carries `x-pulse-contract: 1`. In the page, call `fetchJson(path, { fetch: fetch.bind(globalThis), validate: (raw) => ({ ok: true, value: raw }), timeoutMs: 20000 })` for each row.
  - Expected literals on the branch:

    | Path     | Answer                                                   | Expected result                   |
    | -------- | -------------------------------------------------------- | --------------------------------- |
    | `/small` | `200`, `content-encoding: gzip`, gzip of `{"a":1}`       | `ok: true`, value `{"a":1}`       |
    | `/big`   | `200`, `content-encoding: gzip`, gzip level 9 of 256 MiB of spaces | `kind: "too-large"`     |
    | `/bigbr` | `200`, `content-encoding: br`, brotli quality 1 of 256 MiB of spaces | `kind: "too-large"`   |
    | `/same`  | `302`, `location: /dest` (same origin)                   | `kind: "http"`, `status: 0`, `/dest` count 0 |
    | `/cross` | `307`, `location` on the second server                   | `kind: "http"`, `status: 0`, second server count 0 |

  - Run it once with a bundle of the `1b5e7d3` dist too: `/same` and `/cross` must then give
    `ok: true` with each destination counting 1 (measured in this planning run). This proves
    that the check can fail.
  - Report the Chromium version, both outputs and the time of each call. This planning run
    measured 32 to 74 ms for the 256 MiB rows on Chromium 156.0.8078.4.
- `grep -nE 'from "(node:|bun)' src/client.ts src/version.ts` prints nothing.
- The PR names the merged commit's version `2.5.2` and lists the known limit: a browser caller
  cannot ask for identity and relies on the browser's streaming decoder within the cap.

## Repository: probe

Files:
- `package.json`
- `bun.lock`
- `src/client.test.ts`

Behavior change: yes
The pin moves to a contract whose client refuses redirects and encoded bodies and uses fixed texts.

Tool facts: Bun 1.4.0 (`package.json:8`); `bun run check` = lint, typecheck, test
(`package.json:19`); CI uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
(`.github/workflows/ci.yml:18`). That pinned file (read with `gh api …?ref=04108fa…`) is identical
to the config clone's `check.yml` and to contract's pinned one (steps: install, lint, typecheck,
test). Biome extends the shared config pinned at `04108fa…` (`package.json:23`), whose
`biome.json` equals the clone.

Shared finding: the full contract `main` SHA that contains the merged #864 fix is the same for
probe, status, notify and console. The child that starts first records it as a finding; the others
read it before they start.

Behavior:
- Set `@lorenzh/pulse-contract` to `github:lorenzh/pulse-contract#<merged contract main SHA>`
  (`package.json:30`, today `7ce23aaf…`), run `bun install`, commit `package.json` and `bun.lock`
  together. This jump also brings the contract changes between `7ce23aa` and `1b5e7d3` (30
  commits, among them admin shape changes); fix only what `bun run check` shows as needed.
- No change to `fetchChecks`, `postResult` or `apiError` is required: `src/client.ts:237-239` and
  `:414` then print the contract's fixed texts.
- Add to `src/client.test.ts`, with a fake api on `127.0.0.1` port `0` and the native `fetch`
  (follow the retry pattern of the test "fetchChecks treats a contract version mismatch as a failed
  fetch and retries"): the first `/checks` answer is `302` to a second local server and the second
  answer is valid → `fetchChecks` retries once, returns the checks, and the second server counts 0
  requests; the first answer is a `200` non-JSON body with a marker word and the second is valid →
  the first log line contains `invalid JSON: response body is not valid JSON` and not the marker.

Completion evidence: the two new tests fail on the old pin and pass on the new one (report both
runs); `bun run check` passes; `git diff main -- package.json` shows only the contract pin line;
`test_cpu_s` per the primary measurement of "Performance impact" (expected under +0.1 s).

## Repository: status

Files:
- `package.json`
- `bun.lock`
- `src/api-poll.test.ts`
- `README.md`

Behavior change: yes
The api poll, page poller and proxy reads stop following redirects and refuse encoded bodies under
Bun through the new contract pin.

Tool facts: Bun 1.4.0 (`package.json:9`, `:38`); `bun run check` = lint, typecheck (including
`-p e2e`), test (`package.json:13,19`); CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`),
identical to the config clone; Biome extends the shared config pinned at `04108fa…`
(`package.json:24`). `bun test` enforces 80 % line coverage (`bunfig.toml:1-4`).

Shared finding: the merged contract `main` SHA, as in the probe section (the first child records
it; the others read it).

Behavior:
- Set the contract pin (`package.json:34`) to the merged SHA, run `bun install`, commit
  `package.json` and `bun.lock` together.
- Confirm that every contract dist module that `index.js` imports in the new pin is in the
  allowlist at `src/server.ts:219-242` (the contract section adds none); the existing tests that
  serve `/pulse-contract/client.js` and `/pulse-contract/version.js` must pass.
- Add to `src/api-poll.test.ts`: a fake api on `127.0.0.1` port `0` whose `/checks` answers `302`
  to a second local server → the poll fails (not `ok`) and the second server counts 0 requests.
- `README.md:73`: add that every API request follows no redirect and, on the server, refuses a
  compressed answer; the browser poller relies on the browser's decoding inside the 5 MiB cap.

Completion evidence: the new test fails on the old pin and passes on the new one; `bun run check`
passes; the existing `src/settings-poll.test.ts` redirect case (lines 140-156) still counts 3
reads; `test_cpu_s` per the primary measurement of "Performance impact" (expected under +0.1 s).

## Repository: notify

Files:
- `package.json`
- `bun.lock`
- `docs/operation.md`

Behavior change: yes
The pin moves to the fixed contract; notify's own guards stay in place.

Tool facts: Bun 1.4.0 (`package.json:35`); `bun run check` = lint, typecheck, test
(`package.json:17`); CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), identical to the
config clone; Biome extends the shared config pinned at `04108fa…` (`package.json:22`).

Shared finding: the merged contract `main` SHA, as in the probe section (the first child records
it; the others read it).

Behavior:
- Set the contract pin (`package.json:30`) to the merged SHA, run `bun install`, commit
  `package.json` and `bun.lock` together.
- Keep `noRedirect` (`src/api.ts:146-149`), the capture wrapper (`src/api.ts:380-381`), `apiError`'s
  fixed texts (`src/api.ts:101-124`), URL redaction and rejected-item handling unchanged.
- `docs/operation.md:228`: add that the shared client also refuses redirects and compressed
  answers; notify keeps its own `redirect: "manual"` wrapper.

Completion evidence: `bun run check` passes, including `test/api-hostile.test.ts`,
`test/api-limits.test.ts` and `test/security-review.test.ts` unchanged; `git diff main -- src`
is empty.

## Repository: console

Files:
- `package.json`
- `bun.lock`

Behavior change: yes
The pin moves to the fixed contract; console's read and write wrappers stay as they are.

Tool facts: Bun 1.4.0 (`package.json:35`); `bun run check` = lint, typecheck (including `-p e2e`),
test (`package.json:13,18`); CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), identical
to the config clone; Biome extends the shared config pinned at `04108fa…` (`package.json:24`).

Shared finding: the merged contract `main` SHA, as in the probe section (the first child records
it; the others read it).

Behavior:
- Set the contract pin (`package.json:32`) to the merged SHA, run `bun install`, commit
  `package.json` and `bun.lock` together.
- Keep `src/api-read.ts:37` and `src/connection-test.ts:99` (`redirect: "manual"`) and the
  wire-label logic in `src/api-failure.ts` unchanged.

Completion evidence: `bun run check` passes, including the existing redirect tests
(`src/runtime-read.test.ts`, `src/connection-test.test.ts`, `src/check-write.test.ts`,
`src/token-write.test.ts`); `git diff main -- src` is empty.

Performance evidence: console is not part of the api bench harness (`api/bench/refs.ts:5,37-39`
refuses `--b-ref console=…`; `api/bench/budgets.json` has no `console` key), so do not run
`bench/run.ts` for it. Report the median of three `TIMEFORMAT='%U %S'; time bun run test` runs
(user + system seconds) on `main` and on the branch, measured on one machine. Expected: a delta
within 0.5 s (literal from "Performance impact"); above that, request a hold.

## Acceptance evidence (whole feature)

1. contract red run on `1b5e7d3` source fails the memory, redirect and both upstream-text tests;
   the green run passes (contract section). Expected values are literals in the tests: 64 MiB
   budget, 3xx status codes, destination count 0, the two fixed texts.
2. contract `bun run check` and `git diff --exit-code -- dist` after a fresh build pass in CI,
   including the `openssl` TLS test.
3. Node 24 evidence for identity read, redirect refusal and bounded decoding, and Chromium evidence
   for compressed JSON, the decoded-body limit and redirect refusal (status 0, destination count
   0), each with the literal outcomes of the contract section and a red counterpart on `1b5e7d3`.
4. contract `test_cpu_s` delta reported (three runs per side), expected +0.6 to +1.0 s against the
   9.0 s budget and the 2.0 s floor. console reports its own median `bun run test` delta (three
   runs per side), expected within 0.5 s, with no bench harness run (console is not a harness
   repository).
5. probe, status, notify and console pin the same full contract `main` SHA that contains the fix,
   with `bun.lock` updated, and `bun run check` passes in each; probe's and status's new adoption
   tests fail on the old pin and pass on the new one; notify's hostile-input tests pass unchanged.
