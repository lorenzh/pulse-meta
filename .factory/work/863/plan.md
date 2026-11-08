# Spec: probe: refuse API redirects and bound API error logs (#863)

## Goal

Close the remaining findings in the API client of pulse-probe (`src/client.ts`):
security-probe-2026-11-04-2, -3 and -4 (P3), plus the result-post gap that the independent review
of pulse-probe#57 found (#879). That gap covers redirects and runtime decompression, and its memory
case is P2-class.

After this change:

- `POST /results` refuses every redirect. A redirected result is undelivered: it goes through the
  existing retry and buffer path.
- `POST /results` asks for an uncompressed answer and turns off Bun's eager decompression. It
  decides the outcome from status and headers before the body is dropped, and it never reads or
  decodes the body. An encoded 204 is refused (`retry`). Every other encoded answer keeps the
  outcome of its status (Decision 4). So an encoded answer cannot raise the probe's memory.
- Every log line in `src/client.ts` that carries a check ID shows at most 80 UTF-16 units of it,
  then `…`. The validation text of a skipped record is capped too, so a skip line has a bounded
  length.
- Check-list reads (inherited from #864/#879) keep refusing redirects and keep logging the fixed
  invalid-JSON text, on startup and on reload. Regression controls pin this.
- The probe README names that fixed diagnostic: for an API answer that is not valid JSON, the
  startup and the reload line both carry exactly `invalid JSON: response body is not valid JSON`,
  with no parser detail and no body text. The README states it next to the redirect and
  encoded-answer rules (manager decision after the spec review).

## Disclosure rule (binds the plan, every task, every evidence summary and every PR)

- Public text names location, class, impact and fix direction only. It never holds a payload, a
  construction recipe, a response-generation parameter or a reproduction command.
- The response-memory case is P2-class. Do not call the whole issue P3-only.
- Test inputs are built at run time inside test code. Evidence names test titles, classes,
  outcomes and budgets. It never prints bodies, received header values or credentials.
- The issue text and the added requirements disagree on whether the runtime forwards the token on a
  redirect. Rely on neither. The criterion is that the redirect target gets zero requests.

## Evidence gathered for this spec

Clones read in this run: meta `1f6d747`, probe `892cf36` (merge of pulse-probe#57), contract
`96f33aa` (merge of pulse-contract#57, the #864 fix), config `bc87049`, api `515031b`. The issue
review is `.factory/work/863/issue-review.md` (this run's). `gh api …/git/ref/heads/factory/findings/863`
answered HTTP 404 in this run, so no shared findings exist yet.

History: this spec restarts from the reviewed plan of the closed spec PR lorenzh/pulse-meta#886
(head `9577a1b`), whose two plan reviews ended with no open defect. This run re-verified every
cited line against the clones above (unchanged), and adds the manager decision after that review:
the README names the fixed startup and reload diagnostic for an answer that is not valid JSON, and
the task acceptance checks it (R9, docs and completion evidence). It also adds
`docs/development.md` to the files (test layout and real-time exception) and re-checks the pinned
tooling through `gh api` (see the probe section).

- Probe pins contract `96f33aa…` (`package.json:30`), the same SHA as the contract clone. So the
  inherited client is exactly the one read here.
- Check-list reads: `requestChecks` (`src/client.ts:298-312`) calls the contract `fetchJson` for
  `/probe/checks` with the token, for the tokenless `/checks`, and for the `/checks` fallback that
  runs after HTTP 404 only (`:308`). Contract `clientInit` (`contract/src/client.ts:111-115`) sends
  `redirect: "manual"`, `decompress: false` and `accept-encoding: identity`.
  `isEncodingRefused` (`:121-127`) refuses every coding other than empty or `identity` (trimmed,
  lower case) under Bun. `parseBody` (`:140-146`) returns the fixed text
  `response body is not valid JSON`. None of these helpers is exported (`contract/src/index.ts:61-74`
  exports only `fetchJson`, `requestJson` and the manual-incident readers).
- Startup: `fetchChecks` (`src/client.ts:375-392`) logs `fetching checks failed: <message>; retrying in <ms>ms`.
  `toError` (`:236-237`) maps `invalid-json` to `invalid JSON: <message>`, so the line carries the
  fixed contract text. Existing tests `src/client.api-redirect.test.ts:49` ("authenticated check
  read is not redirected") and `:82` ("invalid JSON from the api logs the fixed text") cover the
  authenticated redirect and the startup JSON line.
- Reload: `startReloader` (`src/reloader.ts:45-53`) logs
  `reloading checks failed: <message>; keeping the current checks`. `main.ts:161-172` wires the real
  `loadChecks` into it. No test drives malformed API JSON through that wiring today
  (`src/reloader.test.ts` substitutes the loader).
- Result post: `postResult` (`src/client.ts:395-430`) calls `deps.fetch` directly. It sends a JSON
  body, a bearer token and a 10 s timeout composed with the caller signal (`:401-409`). It sets no
  `redirect`, no `decompress` and no `accept-encoding`. So Bun follows redirects and decodes
  encoded answers. It awaits a body cancel before it classifies (`:411`). It logs a wire mismatch
  for every answer (`:412-415`). Its outcomes: 204 is accepted; 429 and 5xx retry; 401 and 403
  reject with a token line; other statuses reject with `dropping result for <id>: API answered HTTP <status>`,
  except 404, which is `unknown-check` (`:416-425`). A thrown error retries silently (`:426-429`).
  The `PostOutcome` doc (`:55-60`) says that a 3xx is `rejected`.
- Buffer: `createResultBuffer` (`src/buffer.ts:36`) buffers on `retry` (`:98`, `:150-154`) and drops
  every other non-accepted outcome as `rejected`. `main.ts:183-190` wires the real `postResult`.
- ID log sites in `src/client.ts`: `logInvalid` (`:257-265`, the full readable ID plus the
  contract's validation text), the header-denial line (`:282`), the header skip line (`:287-290`),
  and the two drop lines (`:420`, `:424`). Contract check IDs are `nonEmpty` strings with no length
  cap (`contract/src/schema.ts:19`, `:270`, `:324`, `:400`, `:478`). Header names (≤ 256) and env
  names (`PULSE_HEADER_` + ≤ 115) are bounded by the contract (`schema.ts:113-121`). The contract's
  validation text can carry a received key name (`contract/src/validate.ts:97-101`, `unknownKey`;
  the header-name path in `schema.ts:150-155`).
- Existing bound helpers: `quote` (`src/reason.ts:3-8`, 80 UTF-16 units then `…`) and `capReason`
  (`:14-16`, at most 1000 units: 999 then `…`, `MAX_REASON_LENGTH` from `contract/src/schema.ts:13`).
- Skip deduplication: `skipLogger` and `skipKey` (`src/client.ts:184-221`) hash the full ID's UTF-16
  units (SHA-256, cap 10000, one overflow line). Tests: `src/client.test.ts:742`, `:795`, `:809`,
  `:846`, `:918`.
- Duplicate result posts are harmless: the api inserts results with
  `ON CONFLICT (check_id, location, timestamp) DO NOTHING` (`api/src/service.ts:568`).
- The image ships `src` only (`Dockerfile:14`). `.dockerignore` excludes `**/*.test.ts` and `test`.
  `tsconfig.json:3` includes `src` and `test`. `bunfig.toml:4` excludes `test/**` from coverage.
  `src/tls.test.ts:20-21` already builds certificates at run time with the `openssl` CLI.
- Docs today: `README.md:13` says that check reads follow no redirect and refuse a compressed
  answer; it says nothing about result posts and does not name the invalid-JSON text
  (`grep -F 'response body is not valid JSON' README.md` prints nothing on `892cf36`).
  `docs/configuration.md:39` says only "An invalid JSON body is logged with a fixed text, never the
  body". `docs/troubleshooting.md:50-53` lists startup failure reasons without the JSON text.
  `docs/operation.md:14` and `:21`, `docs/configuration.md:28` and `docs/troubleshooting.md:80-87`
  describe 3xx as a final drop and only network/timeout/429/5xx as retryable.
  `docs/development.md:37` says that only `check.test.ts` and `tls.test.ts` use real 50 ms
  timeouts, and `:14-25` lists no `test/` folder.

## Decisions

1. **Probe only.** Contract does not export its init or encoding helpers, and they are three short
   rules. Probe keeps its own `fetch` call for the post and applies the same rules locally. No
   contract change, no pin move, no new dependency.
2. **No switch to `requestJson`.** `requestJson` reads the body of non-2xx answers (up to 5 MiB) for
   an error text, and reads and validates 2xx bodies. `postResult` never reads a body. Switching
   would change delivery semantics.
3. **Request init of the post.** `redirect: "manual"`, `decompress: false` (Bun's option, typed in
   a local, unexported type as in `contract/src/client.ts:105`), and the header
   `accept-encoding: identity`. Method, URL, `content-type`, `authorization`, body and the
   10 s timeout plus caller-signal composition stay as they are.
4. **Outcome order of the post.** The response headers decide the outcome before any body handling:
   1. A thrown error (network, timeout, abort) → `retry`, no line (unchanged).
   2. The wire-version check runs on every answer, as today. A mismatch logs the existing line and
      does not change the outcome.
   3. Status 300–399 (any, with or without `Location`) → `retry`. This step adds no line of its
      own; the only line a 3xx can produce is the wire-mismatch line of step 2, when its wire
      header mismatches. No request goes to the `Location`. Nothing falls back to another route.
   4. Status 204 → `accepted` when `content-encoding` is absent, empty or `identity` (trimmed,
      case-insensitive). Any other value, including unknown and combined values, → `retry`. This
      step adds no line of its own (step 2 still applies). Same as the shared client, where an
      encoded 2xx is an error. A retry after a 204 is safe, because the api ignores a duplicate
      result.
   5. Every other status keeps its current outcome and line, whatever the encoding (429/5xx
      `retry`; 401/403 `rejected` with the token line; 404 `unknown-check`; others `rejected`).
      No body is read for any status.
   6. The body is then cancelled without waiting for the cancel to settle. The rejection is caught
      with a one-line comment. The outcome returns even when the cancel never settles.
   `PostOutcome` keeps its four values. Its doc comment drops "3xx" from `rejected` and adds it to
   `retry`.
5. **Fixed JSON text: already done in code, now documented.** The startup and reload paths
   already get `invalid JSON: response body is not valid JSON` from the pinned contract. `toError`
   does not change. Tests only pin it. Never downgrade the contract to make a failing base.
   "Unreadable or malformed API answer" in the manager decision means a body that does not parse
   as JSON. Timeouts, network errors, a body above 5 MiB, a wire mismatch and a refused encoding
   keep their own existing texts; the README must not relabel them as invalid JSON. The README
   (and `docs/troubleshooting.md`) name the fixed text for startup and reload (R9).
6. **Displayed IDs are bounded; identities are not.** Every check ID in a log line of
   `src/client.ts` goes through `quote` (80 units, then `…`): the lines at `:264`, `:282`,
   `:289` and `:420`/`:424`. The validation text in the `logInvalid` line goes through `capReason`
   (at most 1000 units). Both helpers already exist and stay unchanged. Validators, `ProbeCheck.id`,
   the posted `Result.checkId`, `headerDenial` (the result reason) and `skipKey` keep the full ID.
   So two IDs with the same first 80 units still log one line each.
7. **Memory budget.** Peak RSS growth ≤ 64 MiB per measured case, the literal budget accepted in
   #864 (`.factory/work/864/plan.md`, statistic "Peak RSS growth"). The issue reports 263 MiB peak
   against 64 MiB normal on the base.

## Scope

- probe `src/client.ts`: result-post init and outcome order, bounded ID and validation text in
  log lines, `PostOutcome` doc.
- New probe regression tests and controls, one child helper under `test/`, and the docs that
  describe retryable failures and the post client.

## Non-goals

- No change to check-list reads (`requestChecks`, `loadChecks`, the 404 fallback), `toError`, the
  contract client, or the contract pin.
- No change to monitored-target redirect rules (`src/check.ts`, `src/check-domain.ts`).
- No client retry loop, no new `PostOutcome` value, no change to buffer backoff, retention, order or
  counts (`src/buffer.ts`), the reloader or `main.ts`.
- No schema length cap on check IDs. No redesign of skip deduplication (#647 is done).
- No other service changes. No change to service logs outside `src/client.ts`.

## Required behavior

- R1: A result post that gets any 3xx returns `retry`, and the `Location` target gets zero requests
  (same origin, cross origin, https to http; 301, 302, 303, 307, 308; a 3xx without `Location`).
  The redirect itself logs nothing. Explicit exception: when the 3xx answer's wire header
  mismatches, the existing wire-mismatch diagnostic (Decision 4, step 2) is logged exactly once,
  with its current text. A 3xx with a matching or absent wire header logs no line.
- R2: Through the real buffer, a redirected result is retained, retried with the existing backoff,
  delivered in order after a direct 204, and never counted as `rejected`.
- R3: The post sends `accept-encoding: identity` and turns off Bun's eager decompression. The
  outcome order of Decision 4 holds. No body is read. The outcome does not wait for the body
  cancel to settle.
- R4: Peak RSS growth while handling an encoded result answer stays ≤ 64 MiB (statistic below).
- R5: Check-list reads keep refusing redirects on all three routes and keep the 404-only fallback
  (control).
- R6: Startup and reload logs for malformed API JSON carry the fixed text and no body text, and the
  reload keeps the running checks, then applies a later valid list (control).
- R7: Every ID in a `src/client.ts` log line is at most 80 units plus `…`. A `skipping invalid check`
  line carries at most 1000 units of validation text. Full IDs stay the identity everywhere else.
- R8: No log line carries a response body, a received header value, or the token.
- R9: `README.md` states, in the same paragraph as the API redirect and encoded-answer rules, that
  an API answer that is not valid JSON is logged at startup and on reload with the fixed text
  `invalid JSON: response body is not valid JSON`, without parser details or body text, and that
  the startup retries while the reload keeps the current checks. The README and the operator docs
  (`docs/configuration.md`, `docs/operation.md`, `docs/troubleshooting.md`)
  agree on redirects and encoded 204s using the buffer, on unchanged status outcomes for other
  encoded answers, and on bounded IDs.

## Performance impact

Keys of `api/bench/budgets.json` (api `515031b`, `probe` block at `:121-157`):

- `probe.test_cpu_s` (budget 2.3 s, gating; default floor 0.2 s and 10 %, `api/bench/README.md:108`).
  - Expected: up by 0.1 to 0.2 s. Historical reference only, not re-measured in this run: the
    2026-11-07 nightly (`pulse-api` run 42357126694) measured probe B = 1.53 s. The implementer
    measures base and branch fresh on one machine (below).
  - Basis: one memory child process (Bun start, about 0.05 CPU s), input generation in the parent
    (≤ 0.1 CPU s, asserted), local HTTP servers, one run-time `openssl` certificate, and fake timers.
  - The memory test runs all measured cases in one child (see the probe section) to stay under the
    0.2 s floor.
- `probe.peak_rss_mib` and `probe.idle_rss_mib`: unchanged in the bench, because the api sends
  identity bodies and no redirects. A hostile encoded answer no longer raises them (R4).
- `probe.startup_cpu_ms`, `probe.load_cpu_s`, `probe.startup_wall_ms`: unchanged within noise. Each
  post sends one more header and makes one more header lookup.
- `probe.image_mb`: unchanged. New `*.test.ts` files and `test/` are excluded by `.dockerignore`.
- api, status, notify, contract, kit, config keys: unchanged, because only probe changes.

How to measure:

- Primary: on the implementation base and on the branch, run `TIMEFORMAT='%U %S'; time bun run test`
  three times each (bash builtin, the quantity `api/bench/measure.ts:68` reads via
  `resourceUsage()`, reported as `test_cpu_s` at `api/bench/run.ts:222`). Report the median of
  user + system seconds per side and the difference.
- Fallback, only if the primary delta exceeds +0.2 s: clone pulse-api into a scratch directory
  outside the target, `bun install --frozen-lockfile`, then
  `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref probe=<pushed branch SHA> --rounds 1`
  (flags from `api/bench/README.md:76-88`; needs Docker with Compose). Report the probe rows and
  delete the scratch checkout. A `FAIL` for `probe.test_cpu_s` means: cut test cost (never raise a
  budget, floor or threshold). If it still fails, request a hold.

## Security impact

Security impact: yes
The change touches the probe HTTP client toward the api (redirects, response encoding and memory),
and log texts that carry API-supplied data.

Checklist items that apply:

- SSRF and redirects: result posts follow no redirect. The target gets zero requests, so neither
  the token nor the result body can reach it. Check-list reads keep the inherited refusal.
- Body and size limits: no body is read or decoded on the post. Peak memory for encoded answers is
  bounded (R4).
- Secrets in errors, logs and responses: no token, response body or received header value in any
  line. JSON failures keep the fixed text, and the README documents that text so operators do not
  expect body details.
- Input validation: on a 204, the content coding fails closed for unknown and combined values
  (`retry`). On every other status the coding never changes the outcome, and the body is never
  decoded. API-supplied IDs and validation text are bounded in logs.
- Auth order and status codes: 401/403, 404, 429 and 5xx keep their outcomes, encoded or not. A
  non-204 2xx keeps `rejected`, encoded or not. A 204 with an absent, empty or `identity` coding
  keeps `accepted`. Two outcomes change: every 3xx (from `rejected`, or from whatever the followed
  target answered, to `retry`), and a 204 with any other coding (from `accepted` to `retry`).
- Dependency pins: unchanged (`package.json`, `bun.lock` protected).

The security state after review exercises these hostile classes on the candidate, with inputs built
in test code only.

## Rollout order

One repository: only probe changes. The wire, routes, shapes and `WIRE_VERSION` stay the same, and
the contract pin stays.

- The api needs nothing. It answers `POST /results` with 204 and uncompressed bodies, and it does
  not redirect. Duplicate results that a retry may resend are ignored (`api/src/service.ts:568`).
- Older probes keep their old behavior until they upgrade. Mixed fleets keep working, because no
  service parses probe log text.
- Visible to operators: if `POST /results` sits behind a redirect, results are now buffered and
  retried (later dropped as `buffer_full` or `too_old`), instead of reaching the target or being
  dropped as `rejected`. Check reads already refuse redirects, so such a probe usually fails at
  startup first. The docs say that `PULSE_API_URL` must be the final endpoint for reads and posts.
  The startup and reload JSON lines do not change on this release; only their documentation does.

## Counterexamples

Each case is named by title, class and expected outcome. Inputs are built at run time in test code.

- **Same-origin 307 on a result post.** Redirect following. Expected: `retry`, 0 requests at the
  `Location` path, no log line. A fix that refuses only cross-origin targets gets it wrong. The base
  follows the redirect.
- **Cross-origin 308 on a result post.** Expected: `retry`, the target server gets 0 requests. The
  base posts the result there and returns `accepted` when the target answers 204.
- **HTTPS API redirecting to HTTP.** Transport downgrade. Expected: `retry`, the target gets 0
  requests. Certificate verification stays on: the test trusts its own run-time CA through the
  injected `fetch`, with no global TLS bypass and no committed key material.
- **3xx without `Location` (for example 300, and 302 without a header).** Expected: `retry`. The base
  returns `rejected` and logs a drop line. A fix that checks only for a `Location` header gets it
  wrong.
- **Redirect through the real buffer.** Expected: retained, retried after the first backoff
  (1000 ms, `src/buffer.ts:4`), delivered first-in first-out after a direct 204, 0 `rejected`
  drops. On the base the redirected result is followed or dropped.
- **Encoded 204.** Expected: `retry`. `accepted` is wrong.
- **Identity spelled with spaces and upper case on a 204.** Expected: `accepted`.
- **Combined coding that mentions identity on a 204.** Fail-closed. Expected: `retry`. A check that
  accepts any value containing `identity` gets it wrong.
- **Encoded 503 / 429.** Expected: `retry`. **Encoded 401.** Expected: `rejected` with the token
  line. **Encoded 404.** Expected: `unknown-check`. **Encoded 200.** Expected: `rejected` with the
  drop line. A fix that maps every encoded answer to `retry` gets these wrong.
- **Wire mismatch on a redirect.** Expected: the existing mismatch line once, outcome `retry`.
- **Body held open on a 503.** The server sends the headers and part of a body, then stalls.
  Expected: `retry` before the server ends the body. A fix that waits for the cancel or the body
  end can hang.
- **Large encoded answer (2xx non-204, 503 with wire mismatch, 307).** Eager decompression.
  Expected: outcomes `rejected`, `retry`, `retry`, and peak RSS growth ≤ 64 MiB each. A fix that
  only sends `accept-encoding: identity`, or only skips the cancel, still decodes on the base
  runtime.
- **Tokenless `/checks` 308 and fallback `/checks` 307 after a 404.** Expected:
  `fetching checks failed: HTTP <status>; retrying in <ms>ms`, the target gets 0 requests, and no
  second fallback runs. Passes on base and candidate.
- **Malformed API JSON on reload.** Expected: one line
  `reloading checks failed: invalid JSON: response body is not valid JSON; keeping the current checks`,
  no body marker in any line, the running checks stay, and the next tick applies a valid list.
  Passes on base and candidate.
- **Invalid record with an ID longer than 80 units.** Expected: the line shows the first 80 units
  of the ID, then `…`, then `: ` and the validation text. Each line is ≤ 1200 characters (23 prefix
  + 81 + 2 + 1000, rounded up). The base prints the whole ID.
- **Validation text longer than 1000 units.** Expected: the text part is exactly 1000 units, ending
  with `…`. The base prints it whole.
- **Two long IDs with the same first 80 units.** Expected: two lines, one per ID. Repeating the
  load stays silent. A fix that dedups on the displayed text logs one line.
- **Long ID on the header skip line, the header-denial line, and the two drop lines.** Expected:
  the ID shown as 80 units plus `…`. The posted `checkId` and the `down` reason from
  `headerDenial` stay complete. A fix that shortens the ID before validation or posting gets it
  wrong.
- **README without the fixed JSON text, or with a parser-detail example.** Documentation. The
  README check (completion evidence) must find the literal
  `invalid JSON: response body is not valid JSON` in the API-redirect paragraph, together with
  "startup" and "reload". A README that names only "a fixed text", or that names the text only in
  `docs/`, fails. On `892cf36` the literal is absent (0 matches).
- **Timeout or oversized body on reload described as invalid JSON.** Documentation. The README
  ties the fixed text to a body that is not valid JSON only; timeouts, network errors, a body over
  5 MiB, a wire mismatch and a refused encoding keep their own texts.
- **Skip cache at 10000 IDs.** Expected: unchanged. One overflow line, recovery, missing vs empty
  IDs and lone surrogates as in the existing tests.

Statistics, defined exactly:

- **Peak RSS growth (per case).** In the child process, after the case's server URL is known and
  before the client call: run `Bun.gc(true)`, then read the baseline `process.memoryUsage().rss`.
  Sample RSS at least every 5 ms, from just before the `postResult` call until 1000 ms after it
  returns. Growth is the maximum sample minus the baseline, in MiB (2^20 bytes), rounded down. One
  sample set per case, no averaging. Budget ≤ 64 MiB.
- **Peak RSS growth (whole child).** The maximum of all samples of all cases, minus the first
  case's baseline, same units and rounding. Budget ≤ 64 MiB. This catches a case that reuses memory
  freed by an earlier case.
- **Input CPU.** User + system CPU seconds of the parent's input generation, from
  `process.cpuUsage()`. Budget ≤ 0.1 s.
- **Test CPU.** As in "Performance impact": three runs per side; the median is the middle of the
  three sorted values; delta = median(branch) - median(base). Means are never used.

## Contract fields

No new names: no new export, outcome value, log line, setting, route, header constant or field.
`PostOutcome` keeps its four values. The new request header and init member already exist in the
shared client. Searches in this run:

- `grep -rn 'PostOutcome' .repos/contract/src .repos/config --exclude-dir=node_modules` → no match
  (the name is probe-local).
- `grep -rn 'redirected' .repos/contract/src .repos/config --exclude-dir=node_modules` → no match.
- `grep -rn 'accept-encoding\|decompress' .repos/contract/src .repos/config --exclude-dir=node_modules`
  → only `contract/src/client.ts:104-118`, the unexported shared init that this change mirrors.

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
from Git semantics, not from the task's own output. Never make protected-file edits in the real
target to prove the method.

## Repository: probe

Files:
- `src/client.ts` (required)
- `src/client.api-redirect.test.ts` (required: new read-redirect and reload controls)
- `src/client.result-redirect.test.ts` (new, required)
- `src/client.result-encoding.test.ts` (new, required)
- `src/client.result-memory.test.ts` (new, required)
- `test/client-result-memory-child.ts` (new, required)
- `src/client.long-id.test.ts` (new, required)
- `README.md` (required)
- `docs/configuration.md` (required)
- `docs/troubleshooting.md` (required)
- `docs/operation.md` (required)
- `docs/development.md` (required)

Behavior change: yes
Result posts stop following redirects and decoding answers, 3xx moves from `rejected` to `retry`,
and log lines bound API-supplied IDs and validation text.

The fixed JSON text and the read-redirect refusal are already on the base (#864/#879). They get
compatibility controls only and are not reported as fixes. The rest of the section is not on the
base: if the implementer finds `postResult` already refusing redirects and encodings, or the log
lines already bounded, it requests a hold.

Protected paths (scope check 5): `AGENTS.md`, `CLAUDE.md`, `package.json`, `bun.lock`,
`bunfig.toml`, `biome.json`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `Dockerfile`,
`.dockerignore`, `.github`, `scripts`, `src/buffer.ts`, `src/reloader.ts`, `src/main.ts`,
`src/check.ts`, `src/check-domain.ts`, `src/reason.ts`, `src/scheduler.ts`, `src/client.test.ts`,
`src/buffer.test.ts`, `src/reloader.test.ts`, `src/check.redirect.test.ts`,
`src/client.http-options.test.ts`, `src/client.reserved-header.test.ts`,
`src/client.probed-types.test.ts`, `src/tls.test.ts`, `docs/index.md`, `docs/install.md`,
`LICENSE`.

The allowed list for scope check 1 is exactly the `Files:` list above; every entry is required.
No entry is "only if changed".

Tool facts (verified in this run):
- Bun 1.4.0: `packageManager` and `engines` (`package.json:8-11`). `bun run check` runs lint,
  typecheck and test (`package.json:19`). Lint is `biome check . && pulse-eslint . && pulse-workflows`
  (`package.json:16`). Typecheck is `tsc --noEmit` from `typescript7` (`package.json:14`, `:27`).
  Biome `2.6.3` (`package.json:22`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. The pin is
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:23`). The config clone (`bc87049`)
  is a different commit and lacks the pin's history (shallow), so this run read the pinned files
  with `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa…" --jq .content | base64 -d`
  and compared them with `diff -q`: `biome.json`, `.github/workflows/check.yml` and
  `tsconfig.base.json` at the pin are byte-identical to the clone. The pinned `biome.json`
  `files.includes` is `**` minus dist, node_modules, bun.lock, html and `test/fixtures`
  (`biome.json:10-17` at the pin), so `test/client-result-memory-child.ts` is linted.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. The pinned `check.yml` installs with
  `bun install --frozen-lockfile` (`:25-26`) on Bun 1.4.0 (`:22-24`), then runs lint (`:27-28`),
  typecheck (`:29-30`) and test (`:37-38`).
- `bunfig.toml:1-4`: coverage on, 80 % line threshold, `test/**` and `**/*.test.ts` ignored.
  `tsconfig.json:3` includes `src` and `test`. Bun's default per-test timeout is 5 s, and no
  `bunfig.toml` entry changes it. So the memory test passes its own timeout argument, as
  `contract/test/client-memory.test.ts` does.

No question here is shared with another repository: this feature has one child.

### Behavior

`src/client.ts`:

- `postResult` (`:395-430`) per Decisions 3 and 4:
  - Init: `redirect: "manual"`, `decompress: false` through a local unexported init type (no `as`
    cast to silence the compiler), `accept-encoding: identity` added to the existing headers. The
    URL, method, body, `content-type`, `authorization` and signal composition (`:401-409`) stay.
  - Classify from status and headers first, in the order of Decision 4. Then cancel the body
    without awaiting it (caught, one-line comment why). The wire-mismatch line (`:412-415`) and
    every existing drop line keep their text, except the bounded ID.
  - Keep each function within cognitive complexity 15 (lint). Split a small pure helper beside
    `postResult` if needed (for example one that classifies status and coding).
- `PostOutcome` doc (`:55-60`): 3xx is `retry`.
- Log lines: `logInvalid` (`:262-264`) shows `quote(id)` and `capReason(error)`; `:282` and
  `:289` show `quote(check.id)`; `:420` and `:424` show `quote(result.checkId)`. Import `capReason`
  next to `quote` (`:19`). Do not change `readableId`, `skipKey`, `skipLogger`, `toError`,
  `requestChecks`, `loadChecks` or `fetchChecks` beyond these interpolations.

Docs (short plain sentences, no payloads):

- `README.md:13` (one paragraph, extended in place, under "Quick start"): result posts, like check
  reads, follow no redirect and ask for uncompressed answers. A redirect, or a 204 with an encoded
  body, leaves the result buffered and retried, so `PULSE_API_URL` must be the final endpoint.
  Other answers keep their status outcome whatever their encoding, and the probe never decodes a
  post answer. Do not write that every encoded answer is retried. In the same paragraph: when the
  API's check list is not valid JSON, the startup line and the reload line both say only
  `invalid JSON: response body is not valid JSON` (fixed text, no parser details, no body text);
  at startup the probe retries, on reload it keeps the current checks. Write the literal text in
  backticks exactly as here. Do not apply it to timeouts, network errors, oversized bodies, wire
  mismatches or refused encodings. Check IDs in log lines are cut to 80 characters plus `…`.
  Monitored checks keep their own redirect rules.
- `docs/configuration.md:28`: add "HTTP 3xx" and "an encoded 204" to the list of undelivered
  answers. `:39`: one sentence that `POST /results` follows no redirect, never decodes the answer,
  and retries an encoded 204; other encoded answers keep their status outcome. Replace "logged with
  a fixed text" by the literal `invalid JSON: response body is not valid JSON` (startup and
  reload). Log lines show at most 80 characters of a check ID, then `…`, and at most 1000
  characters of validation text.
- `docs/troubleshooting.md:50-53`: add "the answer is not valid JSON
  (`invalid JSON: response body is not valid JSON`; the body is never logged)" to the startup
  causes, and say the reload line carries the same reason. `:80-87`: the final-drop section no
  longer covers 3xx. The buffering section names 3xx (`PULSE_API_URL` redirects) and an encoded
  204 as causes. Under `skipping invalid check` (`:65`), long IDs and long texts are shortened
  with `…`.
- `docs/operation.md:21`: retryable failures include HTTP 3xx and an encoded 204. `:13-14`: `<id>`
  is shown cut to 80 characters. `:27`: the `rejected` list no longer implies 3xx. `:68`: the
  `error` outcome of `pulse_probe_results_posted_total` includes 3xx and an encoded 204.
- `docs/development.md`: `:37` names the memory test as the other real-time exception (RSS
  sampling and child supervision only), and `:39` says the result-redirect test also needs the
  `openssl` CLI. The layout (`:14-25`) adds one line: `test/` holds a child-process helper for the
  memory test; it is not collected as a test and is not in the image.

### Tests

All servers listen on `127.0.0.1` port `0` and close in `finally`/`afterAll`. No external network.
Tests use the real `fetch` and assert on the servers' request counts. Log assertions check that no
captured line holds the token, a body marker or a received header marker. Names below are the test
titles. "Regression" means it must fail on `BASE` for the stated reason. "Control" means it must
pass on `BASE` and on the branch.

Time rule:

- Retry and reload timing is always injected: the buffer's `sleep` and `now` (`src/buffer.ts:13-15`),
  the reloader's `timer` and `now` (`src/reloader.ts:6-8`), and the `sleep` of `fetchChecks`
  (`src/client.ts:29`, `:364`) are fakes in every new test. No test waits for a real backoff,
  reload interval or retry delay.
- No test relies on the post's real 10 s request timeout (`src/client.ts:407-408`) firing. Stalled
  servers are released by the test itself after the asserted outcome.
- Narrow exception, real time allowed only here:
  1. Memory measurement in `test/client-result-memory-child.ts`: the real RSS sampling interval
     (at least every 5 ms) and the real 1000 ms post-return window of the "Peak RSS growth"
     statistic. A fake clock would not sample the process's memory.
  2. Process supervision in `src/client.result-memory.test.ts`: the real kill timer of the child
     (30 s) and the explicit per-test timeouts (60 s). They only bound a hung child; no assertion
     depends on them firing, and they are cleared when the child exits.
  Nothing else in either file uses real timers.

`src/client.result-redirect.test.ts` (every redirect answer carries the matching wire header,
except in the wire-mismatch control, so "no line" below follows from R1):
- Regression "result post refuses a same-origin redirect": 307 to another path on the API → `retry`,
  0 requests on that path, no line. Base: follows the redirect.
- Regression "result post refuses a cross-origin redirect" for 301, 302, 303, 307, 308: `retry`, the
  target server gets 0 requests. Base: the target gets the request.
- Regression "result post refuses an https-to-http redirect": the API is a local HTTPS server with a
  run-time `openssl` certificate (pattern of `src/tls.test.ts:20-21`, copied locally). The injected
  `fetch` adds the test CA. Verification stays on. Expected: `retry`, the HTTP target gets 0
  requests. Base: the target gets the request.
- Regression "result post retries a 3xx without a location" (300; 302 with no `Location`): `retry`,
  no line. Base: `rejected` with a drop line.
- Regression "a redirected result stays buffered and is delivered after a direct 204": the real
  `postResult` is wired into `createResultBuffer` with fake `sleep`/`now`. The API redirects the
  first attempts, then answers 204. Two results arrive in order. Expected: both retained, delivered
  in order, `onDrop` never called, target 0 requests. Base: target hit, or result dropped as
  `rejected`.
- Control "a wire mismatch on a redirect logs once": the existing mismatch line once, outcome
  `retry` on the branch. (On the base the line also appears; the outcome is the regression part,
  covered above.)

`src/client.result-encoding.test.ts`:
- Regression "result post asks for identity coding": the server sees `accept-encoding` equal to the
  literal `identity`. Base: Bun's default value.
- Regression "an encoded 204 is retried", and "a combined coding on a 204 is retried": `retry`.
  Base: `accepted`.
- Control "identity in any case and spacing on a 204 is accepted": `accepted`.
- Controls "encoded error answers keep their status outcome": encoded 503 and 429 → `retry`; 401 →
  `rejected` plus the token line; 404 → `unknown-check`; 200 → `rejected` plus the drop line. Small
  bodies only. These pass on the base, because the base decodes small bodies.
- Control "a stalled 503 body does not hold the outcome": `retry` resolves while the server still
  holds the body open. Then the server closes.
- Control "a direct 204 is accepted with the same request": method, path, `content-type`, bearer
  token and the JSON body as `src/client.test.ts:42-76`.

`src/client.result-memory.test.ts` with `test/client-result-memory-child.ts`:
- The parent builds the inputs once in `beforeAll` (input CPU ≤ 0.1 s, asserted). It serves them
  from local servers and spawns one child with `process.execPath` (stdout pipe, 30 s kill timer).
  The child imports the real `postResult` from `../src/client.ts`. It runs cases M0 to M3 in this
  order and prints one JSON report: outcome, per-case growth, whole-child growth, and the log lines
  as booleans only (for example "had a mismatch line", "had a marker").
  - M0 control "small identity 204 is accepted with bounded memory": `accepted`, growth ≤ 64 MiB.
  - M1 regression "large encoded 200 is rejected with bounded memory": `rejected`, growth ≤ 64 MiB.
  - M2 regression "large encoded 503 with a wire mismatch is retried with bounded memory": `retry`,
    one mismatch line, growth ≤ 64 MiB. Its discriminating assertion is the growth: on `BASE` the
    outcome `retry` and the mismatch line already hold, so the required base failure is "growth
    above 64 MiB" and nothing else. Basis: #864 measured the same class (a compressed non-success
    answer whose body is never read) at about +396 MiB under Bun with runtime decompression on
    (`.factory/work/864/plan.md:45-52`), and `postResult` on `BASE` sends no `decompress: false`
    (`src/client.ts:401-409`).
  - M3 regression "large encoded 307 is refused with bounded memory": `retry`, the redirect target
    gets 0 requests (counted by the parent), growth ≤ 64 MiB.
  - Regression "whole-child peak growth stays within 64 MiB".
  - Each test gets an explicit timeout (60 s). The statistics are the ones in "Counterexamples".
    Report the numbers per case, never the inputs.
  - Base expectation (required): M0 passes; M1, M2 and the whole-child test fail for growth above
    64 MiB (eager decoding); M3 fails because the target receives a request. Every one of these
    base failures is required, with the stated reason. If M1 or M2 stays at or below 64 MiB on
    `BASE`, the case input is not large enough: enlarge it within the input-CPU budget. If that is
    not possible, request a hold with `needs-input`; never relabel a regression as a control, and
    never lower the 64 MiB budget.

`src/client.long-id.test.ts` (through `fetchChecks`/`loadChecks` against a local API, and
`postResult`):
- Regression "an invalid record with a long id logs 80 units and an ellipsis": the line equals
  `skipping invalid check ` + the first 80 units of the ID + `…: ` + the validation text, and every
  line is ≤ 1200 characters. Base: the whole ID.
- Regression "long validation text is capped at 1000 units": the text part has length 1000 and ends
  with `…`. Base: whole text.
- Regression "header skip and header denial lines bound the id": both lines show 80 units + `…`.
  The denied check's `headerDenial` keeps its text. Base: whole ID.
- Regression "drop lines bound the result id" for 401 and 400: 80 units + `…`. The server receives
  the full `checkId` in the JSON body. Base: whole ID in the line.
- Control "two long ids with the same prefix log one line each and stay quiet on reload": 2 lines,
  then 0 lines on a second load with the same logger.

`src/client.api-redirect.test.ts` (extend; keep both existing tests unchanged):
- Control "tokenless check read is not redirected": `/checks` answers 308 → one line starting
  `fetching checks failed: HTTP 308; `, target 0 requests.
- Control "fallback check read is not redirected": `/probe/checks` 404, `/checks` 307 → API paths
  exactly `/probe/checks`, `/checks`; target 0 requests; no token in any line.
- Control "invalid JSON on reload logs the fixed text and keeps the checks": the real `loadChecks`
  inside `startReloader` with a fake `Timer` and `now`. The first tick gets malformed JSON with a
  marker → exactly one line
  `reloading checks failed: invalid JSON: response body is not valid JSON; keeping the current checks`,
  `apply` not called, and no marker in any line. The retry tick gets a valid list → `apply` is
  called once with that list's IDs.

Existing suites stay green unchanged, in particular `src/client.test.ts` (direct 204, 400, 401/403,
404, 429/5xx, non-204 success, wire mismatch, skip cache at 10000), `src/buffer.test.ts`,
`src/reloader.test.ts` and `src/check.redirect.test.ts`.

### Completion evidence

- `BASE` recorded before the first edit. The scope proof in the fixture and the five checks pass
  with this section's allowed and protected lists.
- Base run: check out `BASE`'s `src/client.ts` in a scratch worktree outside the repository (or
  `git worktree add` at `BASE` in a temp directory, then copy in only the new test files). Run the
  new tests there. Report each title as pass or fail with the class of reason (for example "target
  received a request", "growth above 64 MiB", "full ID printed"). Every regression above fails for
  its stated reason. Every control passes. Remove the scratch worktree.
- Branch run: every new test passes. Report memory numbers per case (MiB, rounded down), whole-child
  growth and input CPU. No inputs.
- `bun run check` passes on the branch (lint, typecheck, test with ≥ 80 % line coverage).
- `git diff "$BASE" HEAD -- package.json bun.lock` is empty (dependency pins unchanged).
- Smoke check (AGENTS.md "End-to-end checks"): start a local fake API on `127.0.0.1` that serves
  one valid check on `/probe/checks` and answers `POST /results` with a 307. Run
  `PULSE_API_URL=<it> PULSE_PROBE_TOKEN=<test value> PULSE_LOCATION=smoke bun run start`. Observe
  `API unreachable or busy: buffering results` and no request at the redirect target. Switch the
  fake API to 204 and observe `buffer empty again: … delivered, 0 dropped`. Report the command
  shape and the observed lines, not the token.
- Test CPU measured as in "Performance impact". The delta is ≤ +0.2 s, or the fallback bench passes.
- Documentation check (R9). Expected values are the literals written here, never read from the
  README itself:
  - `git show "$BASE":README.md | grep -cF 'invalid JSON: response body is not valid JSON'`
    prints `0` (the base lacks the text; this makes the check discriminating).
  - On HEAD, the README paragraph that holds `follow no redirect` (the API transport paragraph
    under "Quick start") contains all of these literals: `invalid JSON: response body is not valid JSON`,
    `startup`, `reload`, `redirect`, `204`, `PULSE_API_URL`. Extract it with
    `awk -v RS= '/follow no redirect/' README.md` and test each literal with `grep -cF`; each count
    is at least `1`.
  - The same paragraph does not contain `every encoded` or `all encoded` (count `0`), so it never
    claims that every encoded answer is retried.
  - `docs/troubleshooting.md` and `docs/configuration.md` each contain
    `invalid JSON: response body is not valid JSON` (count ≥ 1 each); on `BASE` both counts are `0`.
  - Read the README and the three operator docs once more and confirm, in the evidence, that they agree on: 3xx and
    encoded 204 → buffered and retried; other encoded answers keep their status outcome; IDs cut to
    80 characters plus `…`; the fixed JSON text applies to invalid JSON only. No doc holds a
    payload, a response-generation parameter or a reproduction command.

## Acceptance evidence (whole feature)

Every expected value is a literal in the check, or it comes from Git semantics:

- Redirect targets receive 0 requests for result posts (all 3xx classes, including https→http) and
  for the three check-read routes.
- A redirected result is delivered later through the buffer, with 0 `rejected` drops.
- An encoded 204 is `retry`; encoded error answers keep their status outcome; the post asks for
  `identity`.
- Peak RSS growth ≤ 64 MiB per measured case and for the whole child. M1, M2 and the whole-child
  statistic show growth above 64 MiB on `BASE`.
- Startup and reload lines for malformed JSON contain
  `invalid JSON: response body is not valid JSON`, and the body marker appears in no line.
- `README.md` names `invalid JSON: response body is not valid JSON` for startup and reload in the
  paragraph with the API redirect and encoded-answer rules (0 matches on `BASE`, ≥ 1 on HEAD), and
  the README and the three operator docs agree on redirects, encoded 204s, other encoded answers
  and bounded IDs.
- Long-ID lines show 80 units plus `…`, validation text ≤ 1000 units, every skip line ≤ 1200
  characters. Two IDs with the same 80-unit prefix still log one line each.
- `bun run check` passes in probe. The scope checks pass with the listed paths.
