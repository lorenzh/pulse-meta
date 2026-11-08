# Spec #862: probe validates `PULSE_LOCATION` before using it in HTTP headers

## Goal

Public audit finding `security-probe-2026-11-04-1` (P2) still reproduces on probe `main`:

- **Location:** pulse-probe `src/location.ts` (`parseLocation`, `userAgent`). `src/check.ts:502` puts the parsed value into the generated `User-Agent` header of every HTTP check.
- **Class:** missing input validation at a trust boundary. The probe checks its own environment setting only by length. It does not check it against the form that the generated header needs on the real startup path.
- **Impact:** startup accepts a header-incompatible `PULSE_LOCATION`. After that, every HTTP check of that probe reports a false `down`, while TCP checks and a valid control location stay `up`. A wrong `down` at one location feeds quorum and incidents with false data. This is not header injection and discloses no credentials.
- **Fix direction:** reject such values at the settings boundary during startup, with exit 2 and a fixed message that names `PULSE_LOCATION` and never the value. Keep every name whose HTTP checks work today, and keep its result identity.

Disclosure rule (manager decision): this spec, the task acceptance and the PR text name only the location, class, impact and fix direction. They never spell out a concrete value that makes the header unusable: no literal, table, shell command, escaped recipe in prose, test title or assertion message. Tests build such values at runtime from escapes or code points inside the test code. This spec names only the class that each case covers. There is no manual reproduction command.

## Sources and decisions this spec applies

- Issue #862 and both of its "Added requirements" blocks:
  - disclosure;
  - separate scope checks of commits, index and working tree, with fixture proof;
  - `README.md` in scope;
  - every child-process control verified on the recorded base;
  - transport tested at unit level and rejection at process level;
  - the runtime limitation in one sentence.
- `.factory/work/862/issue-review.md`: the eight-file scope, the protected paths, the error contract, the value-free rule scoped to the rejection path, the test layers, the verification gates and the scope-fixture procedure. This spec adopts them, with one exception (next point).
- **Deviation from issue review point 1 (accepted set), with evidence from this run.** The issue review carried forward "tab, space, visible ASCII and Latin-1" from an earlier run. The earlier evidence came from in-process strings only. In this run the real startup path was run on the base (details under Current behavior). Every non-ASCII location, Latin-1 included, passes startup, and then every HTTP check posts `down`. That is exactly the impact of the finding. The issue requires rejecting "locations incompatible with the generated HTTP header", so the Latin-1 class is refused too. Its names never had working HTTP checks, so "keep valid location names" still holds for every name that works today. The probe token already follows the same printable-ASCII rule for the same reason (`docs/configuration.md` Migration, token paragraph). If a manager wants to keep Latin-1 instead, the probe would still accept a value that makes every HTTP check `down` on the pinned runtime. That would not fix the finding.
- **Runtime limitation (one sentence, as the manager requested):** On Bun 1.4.0, a location read from the process environment (or decoded from UTF-8 bytes) is held in a different internal string form than the same text built in the process, and in that form the generated header refuses every non-ASCII character that an in-process string passes, so an in-process transport pass is no proof for the startup path, unit-level transport tests build their values in the environment form, and every child-process control below was first run on the recorded base.
- Earlier Factory comments and the closed spec PRs #872 and #873 are decision history. Their plan-review fixes still apply:
  - the value-free rule covers only rejection diagnostics (the protected `src/main.ts:158` logs an accepted location);
  - the overlength message is checked at runtime, not by a source grep;
  - the focused test run is judged by its results, and only the full `bun run check` enforces exit status and coverage.
- Plan-review fix of this run: the docs no longer say that every refused name made HTTP checks `down`. The delete control is exempt from that statement, because on the base a name with it posted `up` (Current behavior). The docs state its grammar reason in one fixed sentence, and completion check 3 covers it.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/862` answered `HTTP 404` in this run, so there are none yet.

## Current behavior (evidence)

Probe clone `.repos/probe` at `9490141ef9e92044808c70bb8200db3d497d1060`. Runtime checks ran in a scratch copy outside every repository, with `bun install --frozen-lockfile` (pinned contract `7ce23aa`, kit `739188a`), Bun 1.4.0:

- `src/location.ts:5-12`: `parseLocation` trims. It returns `default` for an empty result. It throws `PULSE_LOCATION is longer than 64 characters` when `location.length > 64` (UTF-16 code units; the message is a template over `MAX_LOCATION_LENGTH`, line 9). Otherwise it returns the value without checking its characters. `src/location.ts:14-16`: `userAgent(location)` returns `` `pulse-probe (${location})` ``.
- `src/settings.ts:68-96`: `loadSettings` calls `parseLocation(env.PULSE_LOCATION)` (line 72). A `StartupError` is re-thrown as is. Any other `Error` becomes `new StartupError(<first line of message>, { cause })` (lines 91-94).
- `src/main.ts:241-256`: `start()` calls `loadSettings` (line 242) before `startHealth` (line 246), and before `runChecks` (line 256), which fetches the checks and starts the scheduler.
- Kit at probe's pin `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`, `src/run-service.ts:102-105` (installed package): a `StartupError` from `start` writes `pulse-probe: <message>\n` to stderr and exits 2. A parser error therefore already becomes one stderr line and exit 2, with no further code change.
- `src/check.ts:498-503`: HTTP checks call `deps.fetch` with `{ ...resolvedHeaders(check), "user-agent": userAgent(deps.location) }`. Results carry `deps.location` unchanged (lines 125, 154).
- **Real startup path on the base**: `src/main.ts` was spawned with a local fake API, one HTTP check to a local target, and `PULSE_LOCATION` passed through the child environment:
  - ASCII names with an internal space, an internal tab and punctuation: exit 0 after SIGTERM, posted `up`, posted `location` equal, and the target received exactly `pulse-probe (<name>)`.
  - Names with one character of each of these classes inside: a C0 control other than tab, a Latin-1 letter, the Latin-1 lower and upper edge, a character above Latin-1. Each started and posted `down`, the target got no request, and the posted `location` was still equal (so the child read the value intact).
  - A name with the ASCII delete control inside posted `up`.
  - With the health port held by another server, a C0 control, a Latin-1 letter, a character above Latin-1 and the delete control each made the child exit 2. Stderr was one line, `pulse-probe: cannot listen on ...`, stdout was empty, and the API got 0 requests.
- **Unit-level transport on the base** (real `fetch` to a `node:http` server on `127.0.0.1`, `userAgent(<a><char><b>)`, every code unit from U+0001 to U+01FF):
  - In-process strings: tab and U+0020–U+00FF arrive unchanged.
  - The same strings decoded from UTF-8 bytes with `TextDecoder` (the environment form): only tab and U+0020–U+007F arrive. Every non-ASCII one makes `fetch` throw.
- RFC 9110 §5.5 (`field-vchar = VCHAR / obs-text`) does not allow the delete control in a field value. The contract's header rule excludes it too (`HEADER_VALUE`, contract `src/schema.ts:120` at the pin). It is refused as a grammar rule, although Bun 1.4.0 passes it.
- The contract's `HEADER_VALUE` excludes the tab. Tabs work today, so that validator is not reused, and the contract does not change.
- Docs:
  - `docs/configuration.md`: the table row (line 10) and the Location section (lines 41-46) cover trimming, case, default, 64 characters and the user agent, but not the accepted characters.
  - `docs/troubleshooting.md:34-37` documents the overlength error.
  - `README.md` names `PULSE_LOCATION` only in the quick start (line 15).
- Base suite: `bun run test` passed (423 pass, 0 fail). `bun run lint` and `bun run typecheck` exited 0. One local run used 1.71 s CPU (user+system).

## Decisions

1. **Accepted characters.** After trimming and the unchanged length check, every UTF-16 code unit of the location must be a horizontal tab (U+0009), or a space or visible ASCII character (U+0020–U+007E). That makes 1 + 95 = 96 accepted code units. Everything else is refused: other control characters, the ASCII delete control, and every non-ASCII character (Latin-1, other BMP, supplementary, lone surrogates).
2. **Order.** `trim`, then blank means `default`, then the existing length check (message unchanged, still first), then the new character check, then return the trimmed value unchanged. No encoding, replacement, lowercasing or truncation.
3. **Error text** (fixed, single line, no value): `PULSE_LOCATION must hold only tab, space or visible ASCII characters`. On stderr: `pulse-probe: PULSE_LOCATION must hold only tab, space or visible ASCII characters`, exit 2. `parseLocation` throws it like the existing overlength error, as an `Error` that `loadSettings` wraps into `StartupError`.
4. **Where.** In production code only `src/location.ts` changes. `settings.ts`, `main.ts`, `check.ts` and the scheduler already fail early as required, and stay byte-identical.
5. **Not done:**
   - no catch in `runCheck`;
   - no dropped, re-encoded or sanitized user agent;
   - no validation at check time;
   - no change to the representation of the string;
   - no startup check of the location against the API token.

## Scope

- probe:
  - the character check in `src/location.ts`;
  - regression tests in the location, settings, local HTTP check and child-process startup suites;
  - the accepted values in `README.md`, in `docs/configuration.md` (table row, Location section, migration note) and in `docs/troubleshooting.md` (new entry).

## Non-goals

- No change to contract, api, kit, config, deploy or any other target. No new dependency, no pin update, no tooling or CI change.
- No change to the API's token location rule (the contract's `trimmedText(64)` in `tokens.ts:81`). An operator can still create a token with a non-ASCII location. A probe can never use it for HTTP checks, and now it refuses it at startup. Aligning the API rule is a possible follow-up, not this feature.
- No change to check scheduling, retries, authentication, the token/location match, quorum, metrics, the result shape or the overlength message.
- No validation of other settings. Check-supplied headers do not change; they already go through the contract validator.
- No workaround for the runtime's string-form behavior. Widening the accepted set later needs its own issue with startup-path evidence.

## Required behavior

1. Unset, empty or blank `PULSE_LOCATION` still yields `default`.
2. Surrounding whitespace is trimmed before both checks. Internal tabs and spaces stay.
3. A trimmed value longer than 64 code units fails with `PULSE_LOCATION is longer than 64 characters`, also when it holds a refused character.
4. A trimmed value of 1–64 code units that holds any code unit outside decision 1 fails with the fixed text of decision 3.
5. Every other value is returned exactly as trimmed. The HTTP check sends `pulse-probe (<location>)`, and the result carries `<location>` unchanged. This is true for the environment form of the string too.
6. A probe process with a refused location exits 2. Stderr is one line, the stderr text of decision 3, and stdout is empty. Before the exit it binds no health listener, makes no API request, sends no check request and posts no result.
7. Rejected-location diagnostics carry no setting value. This covers the startup error for a refused location (decision 3 and the overlength message), its stderr output, and the titles and assertion messages of the new tests. None of them contains the location value, the token or another setting value. The rule covers only the rejection path. The existing info line at `src/main.ts:158` logs a location after it was accepted. It stays byte-identical, and with this change a refused value never reaches it.

## Risks

- **Breaking for refused values:**
  - A probe whose location holds a non-ASCII character, a control character other than tab, or the delete control no longer starts.
  - For each of these classes except the delete control, every HTTP check of such a probe reports a false `down` today. TCP, TLS, DNS and domain checks of such a probe work today, and that probe now stops too.
  - The migration note tells operators to choose an accepted name and keep it equal to the token's `location` on the API, which then needs a new token.
- **The delete control:** refused although Bun 1.4.0 passes it. A name with it is not a valid field value under RFC 9110, and a proxy or a later runtime may refuse it. The docs and the migration note cover it on its own: names that hold it used to work, and they are now refused by the grammar rule. No doc sentence says that it made HTTP checks `down` (Documentation and completion check 3).
- **Trim hides cases:** `String.prototype.trim` removes some refused characters at the ends (line terminators and several non-ASCII spaces). Tests place refused characters inside the name, so the check really runs.
- **String form:** a test that builds values only in the in-process form can pass where production fails (runtime limitation above). Transport tests build accepted values in the environment form, and the startup tests go through a real child environment.
- **Child environments** cannot carry some JavaScript strings (a NUL, lone surrogates). Those classes are tested at the parser and settings level only.
- **Disclosure:** a failing assertion could print a refused value into public CI logs. Rejection checks use `assert.throws` with a fixed-message matcher, or exit-code and stderr checks. Value-equality asserts are used only on accepted values.
- **Test CPU:** three new child processes and 96 local requests are added to `bun run test` (see Performance impact).

## Performance impact

The api's `bench/budgets.json` (lines 121-157) lists these probe keys: `startup_cpu_ms` (377), `load_cpu_s` (0.5), `idle_rss_mib` (79), `peak_rss_mib` (83), `test_cpu_s` (2.3), and the reported `startup_wall_ms` (1027) and `image_mb` (124).

- `test_cpu_s` (probe) can rise. Measured in this run:
  - A child that stops at settings costs about 0.11 s CPU.
  - The base `bun run test` used 1.71 s CPU locally.
  - Two rejected children, one full child and 96 loopback requests add roughly 0.3 to 0.45 s, which gives about 2.0 to 2.2 s locally.
  - Fallback if the `HEAD` median is above 2.3 s: drop the C0-control child from T6. That class stays covered by T2 and T4. Report the drop in the PR. Never raise the budget or the coverage threshold.
- `startup_cpu_ms`, `startup_wall_ms`: one regular-expression test over at most 64 code units, below measurement noise.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`: none expected. The check path does not change, and there is no new module or dependency.
- p95 latency and requests per second are api metrics, which this change does not touch.
- How to measure: run `bun run test` in probe at `BASE` and at the final `HEAD`, three times each, under `/usr/bin/time -f '%U %S'`. Report the median of user+system seconds per side. Optionally, from an api checkout, run `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref probe=<branch SHA>` (api `bench/README.md:76-88`). `HEAD` must stay under 2.3 s.

## Security impact

Security impact: yes

The change adds input validation for an environment setting that reaches the probe HTTP client's headers. It also adds a new error text about external data.

Checklist items that apply:

- **Input validation:** an allowlist of accepted code units at the settings boundary, after trim and after the length check. Every other class is refused: control characters other than tab, the ASCII delete control, every non-ASCII character including lone surrogates and supplementary characters.
- **Secrets in errors, logs and responses:** the new message is a fixed literal. Tests show that neither the location nor the token sentinel appears in the error, on stderr or on stdout.
- **Probe HTTP client headers:** the generated `User-Agent` is built only from validated values, and every accepted value passes the header in its environment form. Check-supplied headers do not change.
- Not applicable: admin routes and auth order (unchanged), body and size limits, SSRF and redirects (unchanged), file writes, dependency pins (unchanged).

Hostile inputs for the security state, each built at runtime and named here by class only:

- a C0 control inside the name;
- the delete control inside;
- a Latin-1 character inside, in the environment form and in the in-process form;
- a BMP character above Latin-1;
- a supplementary character;
- a lone high or low surrogate;
- a refused character next to the trim boundary (first or last after the surrounding whitespace);
- a refused character in a 65-unit value (the length message must win);
- an otherwise valid environment whose token sentinel must not leak;
- each refused class that a child environment can carry, through the real entry point.

## Rollout order

One repository: only probe changes. The contract, api and kit stay as they are, so no older consumer is affected. A probe on an old release keeps today's behavior until it is upgraded. An upgraded probe with an accepted location sends the same `User-Agent` and the same result `location` as before, so the api's token/location match does not change.

## Counterexamples

For each rule: inputs that a correct implementation must handle and that a wrong one gets wrong. Refused inputs are named by class, and the tests build them at runtime.

- **Lower edges:** an internal tab must be accepted. An implementation that copies the contract's `HEADER_VALUE` refuses it, which is wrong. Every other C0 control inside the name must be refused. An implementation that allows "all whitespace" accepts some of them, which is wrong.
- **Upper edge:** U+007E must be accepted. The ASCII delete control must be refused. A naive range "space to delete" accepts it, which is wrong.
- **Non-ASCII:** every Latin-1 code unit inside the name must be refused. An implementation that keeps the contract's `\x80-\xff` range, or tests only in-process strings, accepts them, which is wrong. Supplementary characters and lone surrogates must be refused too. An implementation that tests UTF-8 bytes or code points instead of UTF-16 code units must still refuse them.
- **Order:** a 65-code-unit value that also holds a refused character must give `PULSE_LOCATION is longer than 64 characters`, not the new message.
- **Length unit:** 64 ASCII characters are accepted. 65 are refused with the length message.
- **Trim:** a refused character at an end that `trim` removes does not cause a refusal (today's behavior is kept). A refused character that `trim` does not remove, or one inside the name, does. Blank input (spaces and tabs only) means `default`.
- **Identity:** `  Eu-West  ` gives `Eu-West`. A name with an internal tab, punctuation and internal spaces comes back as the same string. The receiver sees `pulse-probe (<that string>)`, and the posted result has `location` equal to it. An implementation that encodes, replaces or lowercases fails this.
- **String form:** each of the 96 accepted code units, inside a name in the environment form, completes a local HTTP check as `up`. A test that uses only in-process strings would also pass a Latin-1 rule, which is wrong.
- **Message:** the stderr line equals the literal of decision 3 with the `pulse-probe: ` prefix. A message that holds the value or a newline, or adds a stack, fails.
- **Startup order:** with a refused location and an occupied `PULSE_HEALTH_PORT`, the location message must win over `cannot listen on ...`. An implementation that validates after `startHealth` prints the bind error, which is wrong (this is what the base does, as verified). The fake API counts 0 requests.
- **Docs claim:** a doc sentence such as "names with other characters made every HTTP check `down`", read so that it covers the delete control, is wrong. On the base a name with the delete control posted `up`. The docs must give the grammar reason for that class (Documentation).

No statistics are involved.

## Contract fields

No new names. There is no new or renamed field, key, setting, route or exported symbol. The new error text is a string literal inside probe. Searches in this run:

- `grep -rn 'PULSE_LOCATION' .repos/contract/src .repos/config`: no match.
- `grep -rn 'must hold only' .repos/contract/src .repos/config .repos/probe/src .repos/kit/src`: no match. The new text does not collide with an existing message.

## Repository: probe

Files:
- `src/location.ts`
- `src/location.test.ts`
- `src/settings.test.ts`
- `src/check.test.ts`
- `src/main.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Behavior change: yes

Startup now refuses header-incompatible `PULSE_LOCATION` values that it used to accept.

If the base already refuses a header-incompatible location at startup with this behavior, request a hold. Do not open a review.

### Tool facts (verified)

- **Bun 1.4.0:** `package.json` has `"packageManager": "bun@1.4.0"` and `"engines": { "bun": "1.4.0" }` (lines 8-11). CI calls pulse-config `.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`ci.yml:18`). That file, at the pin, sets `bun-version: 1.4.0` (lines 22-24). It is identical to the config clone.
- **Check script:** `bun run check` runs `bun run lint && bun run typecheck && bun run test` (`package.json` scripts). `lint` is `biome check . && pulse-eslint . && pulse-workflows`. CI runs Install `bun install --frozen-lockfile`, then Lint, Typecheck and Test as separate steps (pinned `check.yml:25-30,37-38`).
- **Biome 2.6.3** (`package.json` devDependencies). `biome.json` extends `@lorenzh/pulse-config/biome.json`. At the pin, that file:
  - includes `**` minus dist, node_modules, `bun.lock`, `*.html` and `test/fixtures` (lines 8-17);
  - sets line width 100 (line 23);
  - turns `noNonNullAssertion` off only for `**/*.test.ts` and `**/test/**` (lines 53-63).

  It is identical to the config clone, so test files are linted and formatted.
- **Coverage:** `bunfig.toml` `[test]` sets `coverage = true` and `coverageThreshold = { lines = 0.8, functions = 0 }` (lines 1-3).
- **Startup errors:** kit pin `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`, `src/run-service.ts:102-105`: a `StartupError` becomes `pulse-probe: <message>` on stderr and exit 2.

### Behavior

Implement decisions 1–3 in `parseLocation` only. Keep `DEFAULT_LOCATION`, `MAX_LOCATION_LENGTH`, `userAgent` and the overlength message unchanged. A suitable check is one anchored character class over the trimmed string that covers U+0009 and U+0020–U+007E. Write it with escapes, so that the source holds no raw control or non-ASCII character. Add a one-line comment naming the reason: it is an RFC 9110 field value plus tab, limited to ASCII because the generated header refuses non-ASCII locations read from the environment. Do not export a new function only for tests.

### Tests (regression first)

Record `BASE` (`git rev-parse HEAD`) before the first edit. Write the tests below first and run them at `BASE`.

- Every refused value is built at runtime from `String.fromCharCode`/`String.fromCodePoint`, or from escapes in the test code. The test source holds only printable ASCII.
- "Environment form" means a string decoded from its UTF-8 bytes: `new TextDecoder().decode(new TextEncoder().encode(s))`.
- Titles and assertion messages name the class ("C0 control", "delete control", "Latin-1", "above Latin-1", "supplementary", "lone surrogate"). They never name the value or the code point.
- Rejection asserts use `assert.throws(fn, matcher)`, or exit-code and stderr checks. They never use `assert.equal` on a refused value.

| # | File | Exact test title | Covers | Expected at `BASE` |
|---|------|------------------|--------|--------------------|
| T1 | `src/location.test.ts` | `location defaults, trimming and length stay compatible` | Unset, empty and blank (spaces and tabs) give `default`. Trim keeps case. 64 ASCII code units are accepted. 65 are refused with `/64 characters/`. A 65-unit value that holds a refused C0 control gets the length message, not the new one. | passes (compatibility control) |
| T2 | `src/location.test.ts` | `location rejects header-incompatible character classes` | Inside a name, each of these throws: every C0 control other than tab (a loop over the C0 block that skips only tab), the delete control, every Latin-1 code unit (a loop over that block, in both the in-process and the environment form), a higher BMP character, a supplementary character, a lone high surrogate, a lone low surrogate. The message equals the literal of decision 3 and does not include the input. | fails: no throw |
| T3 | `src/location.test.ts` | `location accepts tab, space and visible ASCII unchanged` | A loop builds each accepted code unit, puts it inside a short name, and gets the same string back. The loop counts exactly 96 accepted code units, a literal from decision 1. | passes |
| T4 | `src/settings.test.ts` | `settings reject an incompatible location with a redacted StartupError` | `loadSettings` with the token sentinel `tok-secret` and a refused location, once with a C0 control and once with a Latin-1 letter in the environment form. Each throws `StartupError` whose `message` equals the literal of decision 3, has no newline, and contains neither the location nor `tok-secret`. | fails: no throw |
| T5 | `src/check.test.ts` | `accepted locations complete a local HTTP check with unchanged identity` | For each of the 96 accepted code units, a name in the environment form that holds it inside goes through `parseLocation`, then through `runCheck` with the real `fetch`, against one `node:http` server on `127.0.0.1` port 0. Asserts `status === "up"`, `statusCode === 200`, `reason === null`, `r.location` equal to the parsed name, and the received `user-agent` equal to `pulse-probe (<name>)`. Counts 96 completed checks and closes the server in `finally`. | passes (verified in this run in the environment form for tab and U+0020–U+007E) |
| T6 | `src/main.test.ts` | `incompatible locations exit before startup side effects` | Two child processes through the existing `run` helper, one with a C0 control inside the name and one with a Latin-1 letter inside. Each has `PULSE_PROBE_TOKEN: "tok-secret"`, a fake API that counts requests, `PULSE_HEALTH_HOST=127.0.0.1` and `PULSE_HEALTH_PORT` set to a port held by a blocker server. Each asserts exit code `2`, `stdout === ""`, exactly one stderr line equal to `pulse-probe: PULSE_LOCATION must hold only tab, space or visible ASCII characters`, no `cannot listen`, no `tok-secret`, no location value, and 0 API requests. It waits for the exit for at most 10 s, then kills the child in `finally`. | fails: both children reach `startHealth` and exit 2 with the `cannot listen` line (verified on the base in this run), so the stderr assertion fails |
| T7 | `src/main.test.ts` | `an accepted location posts an up result through the real startup path` | One child process with an ASCII location that holds an internal space, an internal tab (written as an escape) and punctuation, the token sentinel, a fake API that serves one HTTP check to a local target server, and a target that records `user-agent`. It waits until one result is posted, then sends SIGTERM in `finally`. Asserts exit 0, posted `status === "up"`, posted `location` equal to the configured name, and target `user-agent` equal to `pulse-probe (<name>)`. Does not assert on stderr; the base writes an unrelated line there. | passes (verified on the base in this run through the child environment) |

T6 and T7 add the only three new child processes (see Performance impact for the fallback). Close every server in the file's existing `after` hook or in `finally`. No baseline control in this table uses a non-ASCII value through a child environment.

**Red/green evidence:**

1. At `BASE` with the new tests, run `bun test src/location.test.ts src/settings.test.ts src/check.test.ts src/main.test.ts`.
   - T2, T4 and T6 must fail for the reasons in the table: no throw, no throw, and the wrong stderr line.
   - T1, T3, T5 and T7 must pass.
   - If a control fails at `BASE`, redesign or remove it. Never reclassify it as a regression.
2. Implement, then run the same command again. All seven must pass.
3. Report pass or fail per title for both runs. Do not report failure output that holds a value.

The focused run is judged by its test results only: pass or fail per title, and the fail count in the summary. Its exit status is not a criterion. `bunfig.toml:2-3` turns coverage on with a 0.8 line threshold for every `bun test` run, so a run over four files can exit non-zero on coverage while every test passes. Only the full `bun run check` enforces coverage (completion check 2), and it must exit 0.

### Documentation

- `README.md`: one short paragraph after the quick start. It says that `PULSE_LOCATION`:
  - names the probe's location;
  - is trimmed, and unset or blank means `default`;
  - is case-sensitive and at most 64 characters;
  - may hold only tab, space and visible ASCII (space to `~`);
  - stops the start with exit 2 when it holds any other character.

  Link to `docs/configuration.md#location`.
- `docs/configuration.md`:
  - The table row adds "only tab, space or visible ASCII".
  - The Location section states the accepted range in words: tab, plus space through `~` (U+0020 to U+007E).
  - It says that control characters other than tab, the delete control and every non-ASCII character (accented letters included) stop the start with the exact message and exit 2.
  - It says that the message never shows the value, and why the rule exists. The value goes into the `User-Agent` header. Names with a non-ASCII character or a control character other than tab and delete made every HTTP check `down`. The delete control is a separate case: it is refused because of the header grammar, not because of an observed `down`. The doc states it in this exact sentence: `The delete control is refused because the HTTP standard does not allow it in a header field.` The `down` statement must not include the delete control (Current behavior: on the base, a name that holds it posted `up`).
  - Add a migration paragraph under the last `## Migration`. A location with a non-ASCII character or a control character other than tab and delete used to start, and then every HTTP check reported `down`. A location with the delete control used to start and work, and it is now refused by the grammar rule above. Each of these now stops the start with exit 2, also for a probe that runs only TCP, TLS, DNS or domain checks. Choose an accepted name and give the probe a token whose `location` matches it.
  - No doc sentence says or implies that every newly refused name made HTTP checks `down`. Wording such as "such names", "other characters" or "these names" must not cover the delete control when it is followed by a `down` claim.
- `docs/troubleshooting.md`: a new entry after the overlength entry, headed ``## `PULSE_LOCATION must hold only tab, space or visible ASCII characters` ``.
  - Cause: the trimmed name holds another character, for example an accented letter or a pasted control character.
  - Action: rewrite the name with accepted characters, keep it equal to the token's `location`, and restart.
  - Also state: exit 2, the value is not printed.
- No concrete refused example, escaped value, code point or reproduction command in any doc. The words "accented letter" and "control character" name classes only.

### Completion checks (expected values come from this spec)

Run with Bun 1.4.0 in the probe checkout.

1. **Focused run:** `bun test src/location.test.ts src/settings.test.ts src/check.test.ts src/main.test.ts`. T1–T7 are listed as passed under their exact titles, and the summary reports `0 fail`. The exit status of this run is not a criterion (see Red/green evidence); check 2 enforces exit 0 and coverage.
2. **Full check:** `bun run check` exits 0. This includes the full test suite with coverage at or above the 0.8 line threshold of `bunfig.toml`, which stays unchanged. This is the only coverage gate.
3. **Messages in code and docs:**
   - `grep -c 'PULSE_LOCATION must hold only tab, space or visible ASCII characters'` gives at least 1 in each of `src/location.ts`, `docs/configuration.md` and `docs/troubleshooting.md`. The new message is a fixed literal (decision 3), so it appears verbatim in the source.
   - `grep -c 'visible ASCII' README.md` gives at least 1.
   - `grep -c 'The delete control is refused because the HTTP standard does not allow it in a header field.' docs/configuration.md` gives at least 1. The literal comes from the Documentation section of this spec.
   - Review check (no grep can prove it): read every sentence about `down` in the changes to `README.md`, `docs/configuration.md` and `docs/troubleshooting.md`. Each one names only non-ASCII characters and control characters other than tab and delete, never the delete control and never all refused names. The expected value comes from Current behavior in this spec: on the base, a name with the delete control posted `up`.
   - The overlength message is checked at runtime, not with a source grep, because `src/location.ts:9` builds it from a template. In the probe checkout, run:

     ```sh
     bun -e 'import { parseLocation } from "./src/location.ts"; for (const n of [64, 65]) { try { console.log("accepted", parseLocation("a".repeat(n)).length); } catch (e) { console.log(e.message); } }'
     ```

     The expected output is exactly two lines, `accepted 64` and `PULSE_LOCATION is longer than 64 characters`. Both are literals from this spec. On the base this run printed exactly those lines, and `HEAD` must print the same. The input is plain ASCII. T1 proves that the length message wins over the new one.
4. **Disclosure:**
   - `git diff "$BASE" HEAD -- src README.md docs | grep '^+' | LC_ALL=C grep -n '[^ -~]'` prints nothing. Every added line is printable ASCII, so no raw refused or non-ASCII value is in code, tests or docs.
   - `git diff "$BASE" HEAD -- README.md docs | grep '^+' | grep -nE '\\(u|x)[0-9A-Fa-f]'` prints nothing, so the docs hold no escaped values.
5. **Test CPU:** the medians described in Performance impact, for `BASE` and `HEAD`. `HEAD` stays below 2.3 s, or the stated fallback is applied and reported.
6. **Exclusive scope**, checked after the last commit, each step reported separately:
   - G1: `diff <(git diff --name-only "$BASE" HEAD | LC_ALL=C sort) <(printf '%s\n' README.md docs/configuration.md docs/troubleshooting.md src/check.test.ts src/location.test.ts src/location.ts src/main.test.ts src/settings.test.ts | LC_ALL=C sort)` exits 0, so exactly these eight paths changed.
   - G2: `git diff --name-only --cached` prints nothing.
   - G3: `git diff --name-only` prints nothing.
   - G4: `git status --porcelain` prints nothing, untracked files included.
   - G5: `git diff --exit-code "$BASE" HEAD -- src/settings.ts src/main.ts src/check.ts src/check-scheduler.ts src/scheduler.ts src/client.ts src/token.ts src/check-guard.ts src/header-hosts.ts src/reason.ts package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github/workflows/ci.yml Dockerfile AGENTS.md CLAUDE.md docs/operation.md docs/index.md docs/install.md docs/development.md` exits 0. All these paths exist at `9490141`.
7. **Scope fixture proof.** Run it in a disposable `mktemp -d` Git repository outside the probe checkout, and delete it afterwards.
   - Use harmless text edits that are unrelated to the finding.
   - The allowed list is `allowed.txt`, and the protected file is `protected.txt`. The same G1–G5 run with those lists.
   - Expected results (P = pass, F = fail) are fixed by this spec. They were reproduced in this planning run.

   | State | How | G1 | G2 | G3 | G4 | G5 |
   |-------|-----|----|----|----|----|----|
   | S1 clean allowed-only | commit a change to `allowed.txt` | P | P | P | P | P |
   | S2 committed protected | from S1, commit a change to `protected.txt` | F | P | P | P | F |
   | S3 unstaged protected | from S1, edit `protected.txt` without staging | P | P | F | F | P |
   | S4 staged protected | from S1, edit and `git add protected.txt` | P | F | P | F | P |
   | S5 restored worktree, staged | S4, then `git restore --worktree --source="$BASE" -- protected.txt` (index untouched); `git diff "$BASE" -- protected.txt` is empty | P | F | F | F | P |
   | S6 restored worktree, committed | S2, then `git restore --worktree --source="$BASE" -- protected.txt`; `git diff "$BASE" -- protected.txt` is empty | F | P | F | F | F |
   | S7 untracked | from S1, create an untracked `extra.txt` | P | P | P | F | P |
   | S8 clean again | back to S1 (reset the fixture, not the probe checkout) | P | P | P | P | P |

   S5 and S6 show that a diff from the base to the worktree alone misses the change. Report the fixture table separately from the real G1–G5 results. The fixture is acceptance evidence only and adds no file to probe.
8. **Startup exercise** (AGENTS.md: run `bun run start` once before handoff):
   - Run `PULSE_API_URL=http://127.0.0.1:9 PULSE_PROBE_TOKEN=local-only PULSE_LOCATION='eu west-1' bun run start`, with an accepted ASCII location. It passes settings and logs the fetch retry instead of a location error. Stop it with SIGTERM and report exit 0.
   - The rejection path is exercised only by T6, which starts the real `src/main.ts` that `bun run start` runs. There is no manual command with a refused value.

**PR text:**

- Name issue #862 and the finding id, with location, class, impact and fix direction as in Goal.
- Name the narrowed accepted set and the runtime limitation sentence.
- List T1–T7 by title, with their results at `BASE` and `HEAD`.
- Include the G1–G5 results, the fixture table and the test CPU medians.
- List the known limits:
  - the delete control is refused by the grammar rule;
  - the NUL and lone surrogates are tested at the parser level only;
  - non-ASCII names are refused because of the runtime's header handling.
- No refused value, escape recipe, code point or reproduction command.

## Acceptance evidence (feature)

The feature is done when the probe child shows completion checks 1–8:

- T6 shows that a refused location stops startup with exit 2 before any listener or API request.
- T5 and T7 show that an accepted location completes a local HTTP check as `up`, with an unchanged location and `User-Agent`. T5 covers every accepted code unit in the environment form, and T7 covers the real startup path.
