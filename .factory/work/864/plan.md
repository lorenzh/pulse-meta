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

## Evidence gathered for this spec

- Issue review `.factory/work/864/issue-review.md` (no earlier decisions; open points 1 to 7
  settled below). No shared findings exist yet: `gh api
  repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/864` answered HTTP 404.
- Local measurement in this planning run, Bun 1.4.0, one local `Bun.serve` answering a 421-byte
  brotli body that decodes to 256 MiB, body cancelled without a read:
  - default `fetch`: request carried `accept-encoding: gzip, deflate, br, zstd`; peak RSS
    growth +318 MiB (status 200) and +306 MiB (status 500).
  - `fetch(url, { decompress: false })`: request carried no `accept-encoding`; the response kept
    `content-encoding: br`; peak RSS growth +0 MiB (200 and 500).
- Same fixture, Node 24.19.0 native `fetch` (undici), body read with a 5 MiB counting loop and
  then cancelled: peak RSS growth +12 MiB, with and without `accept-encoding: identity`. Node
  decodes inside the body stream, so a counting reader bounds the decoded bytes. Node ignores the
  unknown `decompress` init member.
- Bun 1.4.0, local TLS origin (self-signed certificate made with `openssl` 3.0.13, trusted through
  Bun's `tls: { ca }`) answering 302 to a plain-http `127.0.0.1` target: `redirect: "follow"`
  reached the target; `redirect: "manual"` returned status 302 and the target got no request.
- Callers of the shared client (all inspected on `main` of each clone):
  - probe `9490141`: `src/client.ts` `fetchChecks`/`loadChecks` use `fetchJson` with the injected
    fetch unwrapped; `postResult` logs `version.error` (`src/client.ts:412-414`); `apiError` puts
    `error.message` into `invalid JSON: …` and `contract version mismatch: …`
    (`src/client.ts:237-239`). Pin `7ce23aaf3fa3e038f65ecfed755188b83bde143f` (`package.json:30`).
  - status `bcd83da`: `src/api-poll.ts:24`, `src/poller.ts:235,328` and the proxy in
    `src/server.ts:412` call `fetchJson` without a redirect guard; `src/settings-poll.ts:109,168`
    and `src/subscribe-client.ts` already use `redirect: "manual"`. The browser page poller runs the
    contract client in the browser: status serves a fixed allowlist of contract dist modules
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
   (browsers drop it silently as a forbidden header). Under Bun (feature check
   `"Bun" in globalThis`, no import), the body then stays encoded as sent, so a response whose
   `Content-Encoding` is present and, after trim and lower-casing, neither `""` nor `identity` is
   refused before any body read. Other runtimes (Node, browsers) decode inside the body stream that
   the counting loop reads, so the existing cap bounds the decoded bytes there (Node measured
   above); they do not refuse on `Content-Encoding`. Refusing in browsers would break the status
   page poller behind any compressing proxy, because a browser cannot ask for identity. No decoder
   is added.
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

## Required behavior

- R1 Bun peak RSS: `fetchJson` and `requestJson` under Bun, against a local answer whose body is a
  brotli encoding of 256 MiB, keep the process's peak RSS growth under 64 MiB, for a `200` answer,
  a `500` answer and a `2xx` write answer. On `main` the growth is about 300 MiB (measured above).
- R2 Encoding refusal (Bun): `2xx` + `content-encoding: br|gzip|deflate|zstd|x-unknown|"identity, gzip"`
  → `network` with the fixed cause; `content-encoding` absent, `identity`, ` IDENTITY ` or `""` →
  normal read. `fetchJson`'s validator is not called for a refused answer.
- R3 Redirects: `fetchJson` never issues a request to a `Location`; statuses 301, 302, 303, 307,
  308 give `{ ok: false, error: { kind: "http", status: <3xx>, wire } }`.
- R4 Fixed texts as in decision 5, at every place a wire check or JSON parse error surfaces:
  `checkWireVersion(...).error`, `fetchJson` `wire-mismatch.message`, `fetchJson` `http.wire.error`,
  `requestJson` `error.message` for a `2xx` mismatch, `requestJson` `response.wire.error` and
  `http.wire.error`, and `invalid-json.message` of both functions.
- R5 Compatibility: every existing contract test keeps passing, except the assertions that this
  spec changes on purpose (listed in the contract section).

## Performance impact

The api's metrics in `api/bench/budgets.json` (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`,
`peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, the `p95_*`, `rps`, `image_mb`, `cold_*`, `eod_*`
keys): none expected, because the api calls no shared-client function and keeps its contract pin.

Other keys of the same file:

- `contract.test_cpu_s`: up by about 1 to 4 s, from the new child-process memory regression (it
  builds a 256 MiB brotli fixture and runs three requests) and the TLS redirect test. `build_cpu_s`:
  unchanged (two source files change by a few lines).
- `probe`, `status`, `notify` `peak_rss_mib` / `idle_rss_mib`: unchanged for normal traffic (the api
  sends identity bodies); they no longer grow with a compressed hostile answer. `startup_*`,
  `load_cpu_s`, `image_mb`: unchanged (one request header more, no new code path in the hot loop).
  `test_cpu_s`: up by under 0.5 s in probe and status (one local-server test each).
- Measure: contract `bun test` CPU time before and after (`/usr/bin/time -v bun test`, report user +
  system seconds); for probe and status the same around `bun test`. No service A/B with
  `bun bench/run.ts` is needed because no service code path changes; if a consumer child changes
  more than its pin and a test, it runs its `bun bench/run.ts --a <old main> --b <branch>` and
  reports the numbers.

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
  `bun.lock`; no new runtime dependency anywhere.

## Rollout order

1. contract merges the fix to `main` (version 2.5.2). Nothing on the wire changes: same paths,
   shapes and `WIRE_VERSION` 1. Every consumer still on an older pin keeps working exactly as
   before, with the old (vulnerable) client behavior, until its pin moves. The api serves identity
   bodies and no redirects on its routes, so the new client behavior changes nothing for traffic
   between pulse services.
2. probe, status, notify and console bump their pins in any order (parallel). Each one works against
   any api, notify or status version, because the change is client-side only. Mixed fleets (for
   example a new probe with an old status) keep working: no service reads another service's error
   texts. A status page served by a new status runs the new client in the browser; the browser path
   only adds `redirect: "manual"` and a header the browser drops, and status's page reads go to
   its own origin without redirects.
3. api is not bumped in this feature (it does not call the client); a later contract change bumps
   it.

## Counterexamples

- Body limit vs. encoding (Bun): a 421-byte `200` answer with `content-encoding: br` that decodes
  to 256 MiB must give `network` (not `too-large`, not `ok`) and peak RSS growth under 64 MiB; a
  wrong fix that only cancels the body or only sends `accept-encoding: identity` still grows by
  about 300 MiB (audit SEC-1 and the measurement above).
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
  `network`) with peak growth under 64 MiB; a fix that refuses on `Content-Encoding` everywhere
  would also refuse in browsers and break the status page behind a compressing proxy.

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
  file. The pinned `check.yml` is identical to the config clone's `main`.
- CI steps at that pin: install, `bun run lint`, `bun run typecheck`, `bun run build`,
  `git diff --exit-code -- dist`, `bun run test` (`check.yml` lines 25-38; `build: true` from
  `ci.yml:18-19`). CI runs on `ubuntu-24.04` (`check.yml:16`).
- `bun run check` = lint, build, typecheck, test (`package.json:28`); lint = `biome check . &&
  pulse-eslint .` (`package.json:25`); build and typecheck use `typescript7` (`package.json:22-23`).
- Biome: `biome.json` extends `@lorenzh/pulse-config/biome.json`
  (pin `51e95b0…`, `package.json:32`), whose `files.includes` (lines 10-17) ignores `**/dist` and
  `**/test/fixtures`; identical to the config clone.
- `bun test` collects coverage with an 80 % line threshold and ignores `test/**`
  (`bunfig.toml:1-4`); only `*.test.ts` files run, so `test/client-memory-child.ts` is not run as a
  test (same pattern as `test/validate-cpu.ts:1-2`).
- `openssl` is not part of the repository or the pinned workflow; it is present in the Factory
  runner (OpenSSL 3.0.13) but its presence on CI's `ubuntu-24.04` image is an assumption. If the
  TLS test cannot run in CI because `openssl` is missing, request a `needs-input` hold rather than
  skipping the test or committing key material.

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

- `test/client-memory-child.ts`: one Bun process per case. It builds a brotli body by streaming a
  1 MiB block of spaces 256 times through `node:zlib`'s brotli compressor (the 256 MiB decoded
  buffer is never held), starts `Bun.serve` on `127.0.0.1` port `0` that answers it with
  `content-encoding: br`, then runs `Bun.gc(true)`, takes the baseline `process.memoryUsage().rss`,
  samples RSS every 5 ms during the call and for 1000 ms after it, and prints one JSON line
  `{ kind, peakGrowthMiB }`. Cases: `fetchJson` `200`, `fetchJson` `500`, `requestJson` POST `200`,
  each with the native `fetch` and the default cap. It imports `../src/index.ts`.
- `test/client-memory.test.ts`: spawns the child with `process.execPath` per case, kills it after
  30 s, and asserts `peakGrowthMiB < 64` (literal budget from the audit's SEC-1 expectation; the
  measured value on `main` is about 300) and the expected `kind` (`network`, `http`,
  `network`). Peak RSS growth = maximum sampled RSS minus the baseline RSS, in MiB, rounded down.
  Test timeout 60 s.
- `test/client-transport.test.ts` (native Bun `fetch`, servers on `127.0.0.1` port `0`, closed
  in `afterAll`):
  - Redirects: same-origin `302` (`location: /dest`), cross-origin `307` and `301` to a second
    server, `303` and `308`; each with header `x-api-key: <marker>`. Expect `ok: false`, `kind`
    `http`, the 3xx status, and a request count of 0 on every destination.
  - HTTPS to HTTP: a TLS `Bun.serve` with a key and self-signed certificate for `127.0.0.1`
    generated by `openssl` into a `mkdtemp` directory (removed afterwards); the test's `fetch`
    wraps the native one as `(input, init) => fetch(input, { ...init, tls: { ca } })`, trusting only
    that certificate. It answers `302` to the plain-http server: `http` 302, destination count 0.
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
- Node evidence (not committed): in a scratch directory outside the repository, a script run with
  Node 24 that imports `dist/index.js` and starts `node:http` servers on `127.0.0.1:0`:
  identity JSON → `ok: true`; `302` → `http` 302 with destination count 0; the 256 MiB brotli
  answer → `too-large` with peak RSS growth under 64 MiB. Report the Node version and output.
- `grep -nE 'from "(node:|bun)' src/client.ts src/version.ts` prints nothing.
- The PR names the merged commit's version `2.5.2` and lists the known limit: a browser caller
  cannot ask for identity and relies on the browser's streaming decoder.

## Repository: probe

Files:
- `package.json`
- `bun.lock`
- `src/client.test.ts`

Behavior change: yes
The pin moves to a contract whose client refuses redirects and encoded bodies and uses fixed texts.

Tool facts: Bun 1.4.0 (`package.json:8`); `bun run check` = lint, typecheck, test
(`package.json:19`); CI uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
(`.github/workflows/ci.yml:18`), identical to the config clone's `check.yml` and to contract's
pinned one (steps: install, lint, typecheck, test); Biome extends the shared config pinned at
`04108fa…` (`package.json:23`), whose `biome.json` equals the clone.

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
runs); `bun run check` passes; `git diff main -- package.json` shows only the contract pin line.

## Repository: status

Files:
- `package.json`
- `bun.lock`
- `src/api-poll.test.ts`
- `README.md`

Behavior change: yes
The api poll, page poller and proxy reads stop following redirects and refuse encoded bodies under
Bun through the new contract pin.

Tool facts: Bun 1.4.0 (`package.json:38`); `bun run check` = lint, typecheck (including `-p e2e`),
test (`package.json:13,19`); CI uses `check.yml@04108fa…` (`.github/workflows/ci.yml:18`), identical
to the config clone; Biome extends the shared config pinned at `04108fa…` (`package.json:24`).

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
passes; the existing `src/settings-poll.test.ts` redirect case still counts 3 reads.

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
- `docs/operation.md:229`: add that the shared client also refuses redirects and compressed
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

## Acceptance evidence (whole feature)

1. contract red run on `1b5e7d3` source fails the memory, redirect and both upstream-text tests;
   the green run passes (contract section). Expected values are literals in the tests: 64 MiB
   budget, 3xx status codes, destination count 0, the two fixed texts.
2. contract `bun run check` and `git diff --exit-code -- dist` after a fresh build pass in CI.
3. Node 24 evidence for identity read, redirect refusal and bounded decoding (contract section).
4. probe, status, notify and console pin the same full contract `main` SHA that contains the fix,
   with `bun.lock` updated, and `bun run check` passes in each; probe's and status's new adoption
   tests fail on the old pin and pass on the new one; notify's hostile-input tests pass unchanged.
