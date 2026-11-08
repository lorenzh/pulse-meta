# Spec #862: probe validates `PULSE_LOCATION` before using it in HTTP headers

## Goal

Public audit finding `security-probe-2026-11-04-1` (P2) still reproduces on probe `main`:

- **Location:** pulse-probe `src/location.ts` (`parseLocation`, `userAgent`). `src/check.ts:502` reads the parsed value into the generated `User-Agent` header of every HTTP check.
- **Class:** missing input validation at a trust boundary. The probe validates its own environment setting by length only, not against the HTTP header field grammar that its generated header needs.
- **Impact:** a header-incompatible `PULSE_LOCATION` passes startup. After that, every HTTP check of that probe reports a false `down`, while TCP checks and a valid control location stay `up`. The configured value also reaches a startup log line (`src/main.ts:158`) unescaped. A wrong `down` at one location can feed quorum and incidents with false data.
- **Fix direction:** reject such values at the settings boundary during startup, with exit 2 and a fixed message that names `PULSE_LOCATION` and never the value. Keep every name that works today, and keep its result identity.

Disclosure rule (manager decision): this spec, the task acceptance and the PR text name the location, class, impact and fix direction only. They never spell out a concrete value that makes the header unusable. That covers literals, tables, shell commands, escaped recipes in prose, test titles and assertion messages. Tests build such values at runtime from escapes or code points inside the test code. This spec names only the class that each case covers. There is no manual reproduction command.

## Sources and decisions this spec applies

- Issue #862 and its "Added requirements (manager decision after the spec review)": disclosure, the separate scope checks with fixture proof, and `README.md` in scope.
- `.factory/work/862/issue-review.md`: the eight-file scope, the protected paths, resolved assumptions 1 to 7, the derived acceptance and the scope-fixture procedure. This spec adopts them and fixes the open points (error text, red/green evidence, exact paths).
- Earlier Factory comments on #862 describe a previous spec run. Its artifacts are not in this checkout, so this spec is rebuilt from the clones. The comments are decision history only. Two decisions from them are kept: the accepted character range, and that the probe gets its own rule rather than the contract's header validator.
- The plan-review of this spec found three defects, and this revision fixes them. First, required behavior 7 now covers only rejected-location diagnostics, because the protected `src/main.ts:158` logs an accepted location. Second, completion check 3 checks the overlength message at runtime instead of with a source grep, because `src/location.ts:9` builds that message from a template. Third, completion check 1 and Red/green evidence judge the focused run by its test results, and the full `bun run check` alone enforces exit status and coverage, as the task acceptance already does.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/862` answered `HTTP 404` again in this run, so there are no findings yet.

## Current behavior (evidence)

Probe clone `.repos/probe` at `9490141ef9e92044808c70bb8200db3d497d1060`:

- `src/location.ts:5-12`: `parseLocation` trims, returns `default` for an empty result, throws `PULSE_LOCATION is longer than 64 characters` when `location.length > 64` (UTF-16 code units), and otherwise returns the value with no check of its characters. `src/location.ts:14-16`: `userAgent(location)` returns `` `pulse-probe (${location})` ``.
- `src/settings.ts:68-96`: `loadSettings` calls `parseLocation(env.PULSE_LOCATION)` (line 72). It re-throws a `StartupError` as is. Any other `Error` becomes `new StartupError(<first line of message>, { cause })` (lines 91-94).
- `src/main.ts:241-256`: `start()` calls `loadSettings` (line 242) before `startHealth` (line 246) and before `runChecks` (line 256), which fetches the checks and starts the scheduler. `src/main.ts:273` runs `start` through kit's `runService`.
- Kit at probe's pin `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`, `src/run-service.ts:102-105` (read with `gh api`, identical to the kit clone): a `StartupError` from `start` writes `pulse-probe: <message>\n` to stderr and exits 2. So a parser error becomes exactly one stderr line and exit 2, with no further code change.
- `src/check.ts:500-503`: HTTP checks send `{ ...resolvedHeaders(check), "user-agent": userAgent(deps.location) }`. Results carry `deps.location` unchanged (lines 125, 154). No other module puts the location into a header. `check-scheduler.ts:41` and `main.ts:212,222` pass it through.
- Contract clone `src/schema.ts:120`: `HEADER_VALUE = /^[\x20-\x7e\x80-\xff]*$/` excludes the tab. Tabs inside a location are accepted and work today, so this validator would break valid names. It is not reused, and the contract does not change.
- Runtime check in this planning run (Bun 1.4.0, which is probe's `packageManager`/`engines` pin; a scratch script outside every repository; a real `fetch` to a `node:http` server on `127.0.0.1`; one character per value placed inside a short name). Results: the tab (U+0009) and U+0020–U+00FF reached the receiver byte-for-byte inside the generated `User-Agent`. Every other C0 control either made `fetch` throw or reached the receiver altered. Code points above U+00FF (BMP, supplementary, lone surrogate) made `fetch` throw. DEL (U+007F) passed through Bun, but RFC 9110 §5.5 does not allow it in a field value (`field-vchar = VCHAR / obs-text`), and the contract's header rule excludes it too. So it is refused as a header-grammar rule (issue review, assumption 3).
- Docs: `docs/configuration.md:10` (table row) and `:41-46` (Location section) document trimming, case, default, 64 characters and the user agent, but not the accepted characters. `docs/troubleshooting.md:34-37` documents the overlength error. `README.md` names `PULSE_LOCATION` only in the quick start (line 15).

## Decisions

1. **Accepted characters.** After trimming and the unchanged length check, every UTF-16 code unit of the location must be a horizontal tab (U+0009), a space or visible ASCII (U+0020–U+007E), or Latin-1 (U+0080–U+00FF). That is 1 + 95 + 128 = 224 accepted code units. The rule describes header compatibility. It is not a new identifier grammar.
2. **Order.** `trim` → blank means `default` → the existing length check (unchanged message, still checked first) → the new character check → return the trimmed value unchanged. No encoding, replacement, lowercasing or truncation.
3. **Error text (fixed, single line, no value):** `PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters`. On stderr: `pulse-probe: PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters`, exit 2. `parseLocation` throws it the same way as the existing overlength error (an `Error` with this message, which `loadSettings` wraps into `StartupError`). It may throw kit's `StartupError` directly instead. Either way the observable result is the same.
4. **Where.** Only `src/location.ts` changes in production code. `settings.ts`, `main.ts`, `check.ts` and the scheduler already give the required early failure and stay byte-identical.
5. **Not done:** no catch in `runCheck`, no dropped or sanitized user agent, no validation at check time, no startup check of the location against the API token.

## Scope

- probe: the character check in `src/location.ts`; regression tests in the location, settings, local HTTP check and child-process startup suites; the accepted values in `README.md`, `docs/configuration.md` (table row, Location section, migration note) and `docs/troubleshooting.md` (new entry).

## Non-goals

- No change to contract, api, kit, config, deploy or any other target. No new dependency, no pin update, no tooling or CI change.
- No change to check scheduling, retries, authentication, the token/location match, quorum, metrics, the result shape or the existing overlength message.
- No validation of other settings. No change to check-supplied headers (they already go through the contract validator).

## Required behavior

1. Unset, empty or blank `PULSE_LOCATION` still yields `default`.
2. Surrounding whitespace is trimmed before both checks. Internal tabs and spaces stay.
3. A trimmed value longer than 64 code units fails with `PULSE_LOCATION is longer than 64 characters`, also when it holds a refused character.
4. A trimmed value of 1–64 code units that holds any code unit outside decision 1 fails with the fixed text of decision 3.
5. Every other value is returned exactly as trimmed. The HTTP check sends `pulse-probe (<location>)` and the result carries `<location>`, unchanged.
6. The probe process with a refused location exits 2. Its stderr is one line, the stderr text of decision 3. Stdout is empty. Before the exit it binds no health listener, makes no API request, sends no check request and posts no result.
7. Rejected-location diagnostics carry no setting value: the startup error for a refused location (decision 3 and the overlength message), its stderr output, and the titles and assertion messages of the new tests contain neither the location value, the token nor another setting value. This rule covers only the rejection path. The existing info line at `src/main.ts:158` (`running <n> check(s) against <apiUrl> from location <location>`) logs an accepted location after validation. It is outside this rule and stays byte-identical, because `src/main.ts` is protected (decision 4). With this change, a refused value never reaches it.

## Risks

- **Breaking for refused values:** a probe whose location holds a refused character no longer starts. Today such a probe already reports every HTTP check as false `down`. The migration note tells operators to choose an accepted name and to keep it equal to the token's `location` on the API, which then needs a new token.
- **DEL:** refused although Bun 1.4.0 passes it through. Such a name is not a valid field value under RFC 9110, and a proxy or a later runtime may refuse it. The migration note covers it as part of "other control characters".
- **Trim hides cases:** `String.prototype.trim` removes some refused characters at the ends (for example line terminators and some Unicode spaces). Tests place refused characters inside the name, so the check is really exercised.
- **Child-process environments** cannot carry every JavaScript string (for example lone surrogates). Such classes are tested at the parser and settings level only.
- **Disclosure:** a failing assertion could print a refused value into public CI logs. Rejection checks use `assert.throws` with a fixed-message matcher and a class label. Value-equality asserts are used only for accepted values.
- **Test CPU:** two new child-process tests add probe startups to `bun run test` (see Performance impact).

## Performance impact

The api's `bench/budgets.json` lists these probe keys: `startup_cpu_ms` (377), `load_cpu_s` (0.5), `idle_rss_mib` (79), `peak_rss_mib` (83), `test_cpu_s` (2.3), and the reported `startup_wall_ms` and `image_mb`.

- `test_cpu_s` (probe): can rise. Two more child-process startups of `src/main.ts` plus a few local HTTP checks, roughly +0.1 to +0.4 s CPU. Keep it to exactly two new child processes (decision in the probe section) and close every server and child.
- `startup_cpu_ms`, `startup_wall_ms`: one regular-expression test over at most 64 code units, below measurement noise.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`: none expected. No change on the check path, no new module or dependency.
- p95 latency and requests per second are api metrics, which this change does not touch.
- Measure: run `bun run test` in probe at `BASE` and at the final `HEAD`, three times each, under `/usr/bin/time -f '%U %S'`, and report the median of user+system seconds for each side. Optionally, from an api checkout: `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref probe=<branch SHA>`. The result must stay under the budget of 2.3 s from `bench/budgets.json`.

## Security impact

Security impact: yes

The change adds input validation for an environment setting that reaches the probe HTTP client's headers, and adds a new error text about external data.

Checklist items that apply:

- **Input validation:** whitelist the accepted code units at the settings boundary, after trim, after the length check. Refuse every other class (C0 controls other than tab, DEL, code points above U+00FF including lone surrogates and supplementary characters).
- **Secrets in errors, logs and responses:** the new message is a fixed literal. Tests prove that neither the location nor the token sentinel appears in the error, on stderr or on stdout.
- **Probe HTTP client headers:** the generated `User-Agent` is built only from validated values. Check-supplied headers are unchanged.
- Not applicable: admin routes and auth order (unchanged), body and size limits, SSRF and redirects (unchanged), file writes, dependency pins (unchanged).

Hostile inputs for the security state, each built at runtime and described here by class only: a C0 control inside the name; DEL inside; a BMP code point above U+00FF; a supplementary code point; a lone high or low surrogate; a refused character next to the trim boundary (first or last after the surrounding whitespace); a refused character in a 65-unit value (the length message must win); an otherwise valid environment whose token sentinel must not leak.

## Rollout order

One repository: only probe changes. The contract, api and kit stay as they are, so no older consumer is affected. A probe on an old release keeps today's behavior until it is upgraded. An upgraded probe with an accepted location sends the same `User-Agent` and the same result `location` as before, so the api's token/location match is unchanged.

## Counterexamples

Each rule, with inputs that a correct implementation must handle and that a wrong one gets wrong. Refused inputs are named by class. The tests build them at runtime.

- **Accepted range, lower edges:** an internal tab must be accepted. An implementation that copies the contract's `HEADER_VALUE` refuses it, which is wrong. Every other C0 control character inside the name must be refused. An implementation that allows "all whitespace" accepts some of them, which is wrong.
- **Accepted range, gap:** U+007E must be accepted. DEL must be refused. U+0080 must be accepted. A naive single range from space to U+00FF accepts DEL, which is wrong.
- **Accepted range, upper edge:** U+00FF must be accepted. The class of code points just above the Latin-1 range must be refused. An implementation that tests UTF-8 bytes, or tests code points rather than UTF-16 code units, must still refuse the supplementary and lone-surrogate classes. Their code units are all far above the Latin-1 range.
- **Order:** a 65-code-unit value that also holds a refused character must give `PULSE_LOCATION is longer than 64 characters`, not the new message.
- **Length unit:** 64 Latin-1 characters (64 code units) are accepted. 65 are refused with the length message.
- **Trim:** a refused character at an end that `trim` removes does not cause a refusal (today's behavior is kept). A refused character that `trim` does not remove, or one inside the name, does. Blank (spaces and tabs only) means `default`.
- **Identity:** `  Eu-West  ` → `Eu-West`. A name with an internal tab, punctuation, internal spaces and Latin-1 letters comes back as the same string. The receiver sees `pulse-probe (<that string>)`, and the posted result has `location` equal to it. An implementation that encodes, replaces or lowercases fails this.
- **Message:** the stderr line equals the literal of decision 3 with the `pulse-probe: ` prefix. A message that interpolates the value, holds a newline or adds a stack fails.
- **Startup order:** with a refused location and an occupied `PULSE_HEALTH_PORT`, the location message wins over `cannot listen on ...`. An implementation that validates after `startHealth` prints the bind error, which is wrong. The fake API counts 0 requests.

No statistics are involved.

## Contract fields

No new names. No new or renamed field, key, setting, route or exported symbol. The new error text is a string literal inside probe. Searches in this run:

- `grep -rn 'PULSE_LOCATION' .repos/contract/src .repos/config` → no match.
- `grep -rn 'must hold only' .repos/contract/src .repos/config .repos/probe/src .repos/kit/src` → no match, so the new text does not collide with an existing message.

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

- Bun 1.4.0: `package.json` `"packageManager": "bun@1.4.0"` and `"engines": { "bun": "1.4.0" }` (lines 8-11). CI installs `bun-version: 1.4.0` in pulse-config `.github/workflows/check.yml:22-24` at the pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, which `ci.yml:19` uses. That file is identical to the config clone.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` scripts). `lint` = `biome check . && pulse-eslint . && pulse-workflows`. CI runs Lint, Typecheck and Test as separate steps (pinned `check.yml:27-30,37-38`).
- Biome 2.6.3 (`package.json` devDependencies). `biome.json` extends `@lorenzh/pulse-config/biome.json`. At the pin, that file includes `**` minus dist, node_modules, `bun.lock`, `*.html` and `test/fixtures` (lines 8-17), sets line width 100 (line 23), and turns `noNonNullAssertion` off only for `**/*.test.ts` (lines 53-63). Identical to the config clone. So test files and docs-adjacent sources are linted and formatted.
- `bunfig.toml` `[test]`: `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }` (lines 1-4).
- Kit pin `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`, `src/run-service.ts:102-105`: `StartupError` → `pulse-probe: <message>` on stderr, exit 2.

### Behavior

Implement decisions 1–3 in `parseLocation` only. Keep `DEFAULT_LOCATION`, `MAX_LOCATION_LENGTH`, `userAgent` and the overlength message unchanged. A suitable check is one anchored character class over the trimmed string covering U+0009, U+0020–U+007E and U+0080–U+00FF. Write it with escapes, so the source holds no raw non-ASCII or control character. Add a one-line comment that names the external rule (RFC 9110 field value, plus tab because tabs work today). Do not export a new function only for tests.

### Tests (regression first)

Record `BASE` (`git rev-parse HEAD`) before the first edit. Write the tests below first and run them at `BASE`. Every refused value is built at runtime from `String.fromCodePoint`/`String.fromCharCode` or escapes in the test code. The test source holds only printable ASCII. Titles and assertion messages name the class (for example "C0 control", "DEL", "above Latin-1", "supplementary", "lone surrogate"), never the value or code point. Rejection asserts use `assert.throws(fn, matcher)` or exit-code and stderr checks, never `assert.equal` on a refused value.

| # | File | Exact test title | Covers | Expected at `BASE` |
|---|------|------------------|--------|--------------------|
| T1 | `src/location.test.ts` | `location defaults, trimming and length stay compatible` | unset, empty and blank (spaces and tabs) → `default`; trim keeps case; 64 Latin-1 code units accepted; 65 refused with `/64 characters/`; a 65-unit value holding a refused C0 control gets the length message, not the new one | passes (compatibility control) |
| T2 | `src/location.test.ts` | `location rejects header-incompatible character classes` | inside a name: every C0 control other than tab (built in a loop over the C0 block, skipping only tab), DEL, the code points just above the Latin-1 range, a higher BMP code point, a supplementary code point, a lone high and a lone low surrogate. Each throws an error whose message equals the literal of decision 3 and does not include the input | fails: no throw |
| T3 | `src/location.test.ts` | `location accepts tab, space, visible ASCII and Latin-1 unchanged` | builds each of the accepted code units in a loop. Each one, inside a short name, comes back unchanged. The loop counts exactly 224 accepted code units (literal from decision 1) | passes |
| T4 | `src/settings.test.ts` | `settings reject an incompatible location with a redacted StartupError` | `loadSettings` with the token sentinel `tok-secret` and a refused location throws `StartupError`, whose `message` equals the literal of decision 3. It has no newline and contains neither the location nor `tok-secret` | fails: no throw |
| T5 | `src/check.test.ts` | `accepted locations complete a local HTTP check with unchanged identity` | for a plain ASCII control name, a name with an internal tab, punctuation and spaces, and a Latin-1 name: `parseLocation` → `runCheck` with the real `fetch` against a `node:http` server on `127.0.0.1` port 0. Asserts `status === "up"`, `statusCode === 200`, `reason === null`, `r.location` equal to the parsed name, and the received `user-agent` equal to `pulse-probe (<name>)`. Closes the server in `finally` | passes |
| T6 | `src/main.test.ts` | `incompatible locations exit before startup side effects` | child process via the existing `run` helper with `PULSE_PROBE_TOKEN: "tok-secret"`, a fake API that counts requests, `PULSE_HEALTH_HOST=127.0.0.1` and `PULSE_HEALTH_PORT` set to a port held by a blocker server, and a refused location that an environment can carry (a C0 control inside the name). Asserts exit code `2`, `stdout === ""`, exactly one stderr line equal to `pulse-probe: PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters`, no `cannot listen`, no `tok-secret`, no location value, 0 API requests. Waits on the exit for at most 10 s, then kills the child in `finally` | fails: settings accept the value, so the child reaches `startHealth` and exits 2 with the `cannot listen` line. The stderr assertion fails |
| T7 | `src/main.test.ts` | `an accepted location posts an up result through the real startup path` | child process with a Latin-1 location that holds an internal space, the token sentinel, a fake API that serves one HTTP check pointing at a local target server, and a target that records `user-agent`. Waits until one result is posted, then sends SIGTERM in `finally`. Asserts exit 0, posted `status === "up"`, posted `location` equal to the configured name, and target `user-agent` equal to `pulse-probe (<name>)` | passes |

T6 and T7 are the only new child processes (Performance impact). Close all servers in the file's existing `after` hook or in `finally`.

Red/green evidence: run `bun test src/location.test.ts src/settings.test.ts src/check.test.ts src/main.test.ts` at `BASE` with the new tests. T2, T4 and T6 must fail for the reasons in the table (no throw; no throw; wrong stderr line), and T1, T3, T5 and T7 must pass. Then implement, and all seven must pass. Report the pass/fail per title for both runs. Do not report failure output that holds a value.

The focused run is judged by its test results only: the per-title pass/fail and the summary's fail count. Its process exit status is not a criterion. `bunfig.toml:2-3` turns coverage on with a 0.8 line threshold for every `bun test` run, so a run over four files can exit non-zero on coverage of the modules those files load, even when every test passes. Coverage is enforced only by the full `bun run check` (completion check 2), which must exit 0.

### Documentation

- `README.md`: one short paragraph after the quick start. `PULSE_LOCATION` names the probe's location. It is trimmed, unset or blank means `default`, it is case-sensitive, at most 64 characters, and may hold only tab, space, visible ASCII and Latin-1 (U+0080 to U+00FF). Any other value stops the start with exit 2. Link to `docs/configuration.md#location`.
- `docs/configuration.md`: the table row adds "only tab, space, visible ASCII or Latin-1". The Location section adds the accepted range in words (tab U+0009, space and visible ASCII U+0020 to U+007E, Latin-1 U+0080 to U+00FF), says that control characters other than tab, DEL and characters above U+00FF stop the start with the exact message and exit 2, says the message never shows the value, and says why (the value goes into the `User-Agent` header). Add a migration paragraph under the last `## Migration`: a location that holds other characters used to start and then report every HTTP check `down`. It now stops the start with exit 2. Choose an accepted name and give the probe a token whose `location` matches it.
- `docs/troubleshooting.md`: a new entry `## \`PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters\`` after the overlength entry, with Cause (the trimmed name holds a character outside the accepted range, for example after a copy-paste) and Action (rewrite the name with accepted characters, keep it equal to the token's `location`, restart). Exit 2, value not printed.
- No rejected example, escaped value or reproduction command in any doc.

### Completion checks (expected values come from this spec)

Run with Bun 1.4.0 in the probe checkout.

1. `bun test src/location.test.ts src/settings.test.ts src/check.test.ts src/main.test.ts`: T1–T7 are listed as passed by their exact titles, and the summary reports `0 fail`. The exit status of this focused run is not a criterion, because the coverage threshold can fail it (see Red/green evidence). Check 2 enforces exit 0 and coverage.
2. `bun run check`: exit 0. This includes the full test suite with coverage at or above the 0.8 line threshold of `bunfig.toml`, which stays unchanged. This is the only coverage gate.
3. Messages in code and docs:
   - `grep -c 'PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters'` on `src/location.ts`, `docs/configuration.md` and `docs/troubleshooting.md` gives at least 1 for each file. The new message is a fixed literal (decision 3), so it appears verbatim in the source.
   - `grep -c 'Latin-1' README.md` gives at least 1.
   - The overlength message is checked at runtime, not with a source grep. The source builds it from a template with `MAX_LOCATION_LENGTH` (`src/location.ts:9` at `9490141`), so a grep for the full text finds no match on the base or after the change. In the probe checkout, run `bun -e 'import { parseLocation } from "./src/location.ts"; for (const n of [64, 65]) { try { console.log("accepted", parseLocation("a".repeat(n)).length); } catch (e) { console.log(e.message); } }'`. The expected output is exactly two lines, `accepted 64` and `PULSE_LOCATION is longer than 64 characters`, which are literals from this spec and decision 2. It was run against the base in this planning run with this result, and it must give the same output at `HEAD`. The input is plain ASCII only. The precedence of the length message over the new message, when a 65-unit value also holds a refused character, is proved by T1 (`location defaults, trimming and length stay compatible`), not by a command.
4. Disclosure: `git diff "$BASE" HEAD -- src README.md docs | grep '^+' | LC_ALL=C grep -n '[^ -~]'` prints nothing. Every added line is printable ASCII, so no raw refused or non-ASCII value is in code, tests or docs. `git diff "$BASE" HEAD -- README.md docs | grep '^+' | grep -nE '\\(u|x)[0-9A-Fa-f]'` prints nothing (no escaped values in docs).
5. Test CPU: the medians of Performance impact for `BASE` and `HEAD`, with `HEAD` below 2.3 s.
6. Exclusive scope, after the last commit, each as a separate result:
   - G1: `diff <(git diff --name-only "$BASE" HEAD | LC_ALL=C sort) <(printf '%s\n' README.md docs/configuration.md docs/troubleshooting.md src/check.test.ts src/location.test.ts src/location.ts src/main.test.ts src/settings.test.ts | LC_ALL=C sort)` exits 0 (exactly these eight paths).
   - G2: `git diff --name-only --cached` prints nothing.
   - G3: `git diff --name-only` prints nothing.
   - G4: `git status --porcelain` prints nothing (untracked files included).
   - G5: `git diff --exit-code "$BASE" HEAD -- src/settings.ts src/main.ts src/check.ts src/check-scheduler.ts src/scheduler.ts src/client.ts src/token.ts src/check-guard.ts src/header-hosts.ts package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github/workflows/ci.yml Dockerfile AGENTS.md CLAUDE.md docs/operation.md docs/index.md docs/install.md docs/development.md` exits 0.
7. Scope fixture proof. Run it in a disposable `mktemp -d` Git repository outside the probe checkout and delete it afterwards. Use harmless text edits that are unrelated to the finding. Allowed list = `allowed.txt`. Protected = `protected.txt`. The same G1–G5 run with those lists. Expected results (P = pass, F = fail), fixed by this spec:

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

   S5 and S6 show that a base-to-worktree diff alone misses the change. Report the fixture table separately from the real G1–G5 results. The fixture is acceptance evidence only and adds no file to probe.
8. Startup exercise: AGENTS.md asks for a `bun run start` run before handoff. For this security fix the manager decision replaces it with T6 and T7, which start the real `src/main.ts` that `bun run start` runs. Report them by title. There is no manual command with a refused value.

PR text: name issue #862 and the finding id, location, class, impact and fix direction as in Goal. List T1–T7 by title with their results at `BASE` and `HEAD`, the G1–G5 results, the fixture table, the test CPU medians, and the known limits (DEL refused by grammar, environment-inexpressible classes tested at the parser level only). No refused value, escape recipe or reproduction command.

## Acceptance evidence (feature)

Done when the probe child shows completion checks 1–8. T6 shows that a refused location stops startup with exit 2 before any listener or API request, and T5 and T7 show that an accepted location completes a local HTTP check as `up` with an unchanged location and `User-Agent`.
