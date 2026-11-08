# Spec #865: contract rejects an own `__proto__` header in the public check validators

## Goal

Audit finding `security-contract-2026-11-03-2` (P3) still reproduces on contract `main`:

- **Location:** pulse-contract `src/validate.ts`, `checkBase` (line 106). The HTTP branch (lines 111-113) goes straight to the schema. `validateCheck`, `validateCheckWithState` and `validateChecksResponse` all use this path, and so does `validateAdminConfigExport` through `exportCheckProblem` (`src/validate-admin.ts:182-200`).
- **Class:** a validator at a trust boundary leaves part of its input unchecked. The headers record parse (`src/schema.ts:140`) skips an own `__proto__` key, but the validator returns the original object, and that object still holds the key with any value.
- **Impact:** a consumer that trusts the validated type reads a header value that was never checked. The probe resolves headers right after validation (`src/client.ts:271-295`, `resolveHeaders` at 134-172). Some value classes make it throw inside `loadChecks`, so the whole load fails and the valid sibling checks never load. Other classes pass through silently.
- **Fix direction:** reuse the existing admin rule (`src/validate-admin.ts:40-45`) in the shared public HTTP path. Any own header named `__proto__` is rejected by its name, whatever its value, and the value is never read. Then pin the probe to the fixed contract, so its existing skip path drops the record and loads the siblings.

Disclosure rule (issue's added requirements): this spec, the task acceptance and the PR texts name only the location, class, impact and fix direction. They hold no copy-paste payload, no JSON literal of a malformed record and no reproduction command. Tests build their fixtures at runtime inside the test code. This spec names the value classes only.

## Sources and decisions this spec applies

- Issue #865, including its "Added requirements" block:
  - scope checks of commits, index and working tree, with fixture proof;
  - `README.md` and the named docs in scope;
  - every baseline control runs and passes on the recorded base;
  - no payloads in public text.
- `.factory/work/865/issue-review.md`. This spec adopts its open points 1-10:
  - the surface, including `validateAdminConfigExport`;
  - the exact-name and ownness policy;
  - the value-class table;
  - the helper in `validate-core.ts`;
  - the narrow differential-test exception;
  - probe scope and ordering;
  - no API task;
  - exact file lists;
  - baseline evidence.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/865` answered `HTTP 404` in this run. There are none yet.
- Issue comments: only Factory's issue-review note. It asks this plan to handle the historical compatibility test and the nested response/export validators. Both are covered below.

## Current behavior (evidence from this run)

Clones: contract `1b5e7d3e268372a6241db05ae30272eab7299b10`, probe `9490141ef9e92044808c70bb8200db3d497d1060`, api `515031bd3fd2aa6b8993e325b24ab08f4a3510d6`, config `bc870498cc8e2539a132ce2aac35a09db1deabd8`. The runtime checks ran in scratch copies outside every repository: `bun install --frozen-lockfile`, Bun 1.4.0. Scratch scripts lived in a separate directory and were deleted afterwards.

### Contract at `1b5e7d3`

- Every check was built with an own `headers.__proto__` entry. The `src` and `dist` entries gave the same results.
  - **Accepted (`ok: true`):** `validateCheck` with implicit type and with explicit `type: "http"`, `validateCheckWithState` and `validateChecksResponse` (both with valid state fields), and `validateAdminConfigExport`. This held for every value class tested:
    - null, number, boolean, array;
    - empty object, object with an invalid env name, object with a non-string env;
    - literal string, valid env reference.
  - `validateAdminConfigExport` rejected only the keep-like object, through its existing marker rule.
  - `validateAdminCheckInput` rejected every class.
  - A non-enumerable own entry, an own accessor entry and an entry on a null-prototype record were accepted too. The accessor was never read (0 reads).
- `bun run check` exited 0: 345 pass, 0 fail, line coverage 99.64 %. `git status --porcelain` stayed empty after the build, so the committed `dist/` matches a fresh build.
- Control messages on the base: a forbidden name gives `check.headers.Host: is a header the probe controls`. An invalid env name gives `check.headers.X-A.env: must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`. A `tcp` check with any `headers` gives `check.headers: Invalid input: expected never, received object`. A `__proto__` entry that is only inherited by the headers record is accepted, and so is a check-level own `__proto__` key.
- `test/validate-diff.test.ts:660` (test `15b: an own __proto__ key`) expects the candidate and the frozen reference (`test/reference/`, copied at `7ce23aa`) to accept an HTTP check with a literal value under that header name. This is the only existing assertion that conflicts with the fix.
- Local CPU, user+system, median of 2: `bun run test` 4.8 s, `bun run build` 1.9 s.

### Prototype fix (scratch only, not a deliverable)

The prototype did three things:
- moved the admin helper body into `src/validate-core.ts` as a non-index export;
- called it first in the HTTP branch of `checkBase`;
- imported it in `validate-admin.ts` and deleted the local copy.

Results:
- Every case above was rejected with `<path>.headers.__proto__: is not an allowed header name` and 0 accessor reads. Example paths: `checks[3]` for a custom path, `checks[1]` from `validateChecksResponse`, `config.checks[1]` from the export. The valid sibling in a response kept its identity, and all control messages above stayed byte-identical.
- `bun run build` changed exactly `dist/validate-core.js`, `dist/validate-core.d.ts`, `dist/validate.js` and `dist/validate-admin.js`.
- The full suite gave 344 pass and 1 fail, `15b: an own __proto__ key`, as predicted. `bun run lint` and `bun run typecheck` stayed as on the base (Biome reports the same 1 info on the base).

### Probe at `9490141` (contract pin `7ce23aa`)

- `loadChecks`, with a feed of one record that has the reserved header and one valid sibling, in both orders:
  - null, number, empty object, array: `loadChecks` rejects with a `TypeError` and loads nothing, in both orders, and logs no skip line.
  - literal string: both records load, and the literal header disappears silently.
  - valid env reference: both records load, and the malformed one is reported down for a host-binding denial.
- Real process: `bun run start` against a local fake API serving that feed, with a local test token and `PULSE_HEALTH_PORT` set. It logged `fetching checks failed: <TypeError text>; retrying in 10000ms` and never logged `running ... check(s)`.
- `bun run check` exited 0: 423 pass, 0 fail. `bun run test` took 1.7 s CPU (median of 2).
- **Pin bump preview:** probe's pin set to contract `1b5e7d3` (`bun install`):
  - The diff was exactly two lines, one in `package.json` and one entry in `bun.lock`.
  - `bun run check` exited 0 with 423 pass.
  - `bun run test` took 1.8 s CPU.
  - The installed package grew from 708 KiB to 1236 KiB.
  - The 30 contract commits between `7ce23aa` and `1b5e7d3` (one breaking, for admin shapes) did not break probe.
- **With the prototype dist installed:** both orders and every class above load exactly `ok`. The only log line is `skipping invalid check bad: checks[<i>].headers.__proto__: is not an allowed header name`. `bun run start` logged that skip line, then `running 1 check(s) against http://127.0.0.1:<port> from location default`.

### Other services (no change, evidence for rollout)

- api `src/config.ts:227-231` already refuses the name in the checks file, before its `validateCheck` call at line 256. The test `src/check-write.security.test.ts:75` covers it. api pins contract `1b5e7d3`.
- status (`src/poller.ts:106`, `validateChecksResponse` on the public `GET /checks`, which never serves `headers`), notify (`src/api.ts:236-242`), console (`src/check-export.ts:72`) and api (`src/check-store.ts:73`) all pin `1b5e7d3`. None of them changes in this feature.

## Decisions

1. **Rule.** An HTTP check (`type` absent or `"http"`) whose `headers` is an object with an own property named exactly `__proto__` fails. This holds for every validator that uses `checkBase`: `validateCheck`, `validateCheckWithState`, `validateChecksResponse`, and `validateAdminConfigExport` through `exportCheckProblem`. The property can be enumerable or not, a data property or an accessor, and the record can have any prototype. The check uses `Object.hasOwn` and never reads the value.
2. **Error text.** The existing text, unchanged: `<path>.headers.__proto__: is not an allowed header name`. No value, no sentinel.
3. **Order.** In the HTTP branch, the reserved-name check runs before the schema, as in admin (`validate-admin.ts:49,75`). An HTTP check that has the reserved header and also another schema problem reports the reserved-header text.
4. **Placement.** Move the body of `protoHeaderProblem` from `src/validate-admin.ts:40-45` into `src/validate-core.ts` as one exported helper (suggested name `reservedHeaderProblem`), with the existing comment. `validate.ts` and `validate-admin.ts` import it, and the local copy in `validate-admin.ts` is deleted. The helper is not re-exported from `src/index.ts`. `validate-admin.ts` already imports `validate.ts`, so a public-to-admin import would create a cycle, and this placement avoids it. Admin call sites and their messages stay the same.
5. **Inside `verdict`.** The new call runs inside the existing `verdict` callback, so a throwing inspection still becomes `<path>: is not a valid value`. Validators never throw, and success still returns the same object.
6. **Unchanged:**
   - inherited `__proto__` entries (still accepted);
   - a check-level own `__proto__` key;
   - case variants of the name;
   - other prototype-related names;
   - the non-HTTP types (their `headers: never` rule already rejects any headers);
   - schemas, exported names and types;
   - `WIRE_VERSION` (1) and the package `version` (`2.5.1`). The earlier admin fix `865dc26` did not bump the version either.
7. **Probe.** Only the contract pin moves, in `package.json` and `bun.lock`, to the full SHA of the contract merge commit on `main` that holds this fix. No production source changes. `validateCheck` already runs before `resolveHeaders`, and its skip path (`logInvalid`, `src/client.ts:257-265,350-351`) is then enough.
8. **Differential suite.** In test `15b`, only the final `validateCheck` line changes:
   - the candidate must now return the rejection of decision 2 at path `check`;
   - the reference must still return `ok: true`, with the same object.

   A one-line comment names the intentional difference (#865). `test/reference/**` and every other assertion stay byte-identical.

## Scope

- contract:
  - the shared helper and its call in the public HTTP path;
  - the rebuilt `dist` files;
  - a new regression and control suite through the source, built and package entries;
  - the `15b` exception;
  - `README.md` and `docs/index.md`.
- probe:
  - the contract pin (`package.json`, `bun.lock`);
  - one new loader regression suite;
  - `README.md`, `docs/configuration.md` and `docs/troubleshooting.md`.

## Non-goals

- No change to api, status, notify, console, kit, config or any other target. Their contract pins stay where they are.
- No new rule for other header names, case variants, inherited properties, check-level unknown keys or Proxy inputs (Proxy stays out of scope, `docs/index.md:648-649`).
- No sanitizing or copying of inputs. A response validator still fails the whole response on its first bad element. The probe still skips per record.
- No new export, type, route, setting, dependency, wire or package version.
- No catch-and-continue in the probe loader, and no change to `resolveHeaders`.

## Required behavior

1. For each validator in decision 1, with implicit or explicit HTTP type, a plain or null-prototype headers record, and each value class (Counterexamples), the result is exactly `{ ok: false, error: "<path>.headers.__proto__: is not an allowed header name" }`:
   - `validateCheck(c, "checks[3]")` gives path `checks[3]`;
   - `validateCheckWithState(c)` gives path `check`;
   - `validateChecksResponse([valid, c])` gives path `checks[1]`;
   - `validateAdminConfigExport({ checks: [valid, c], components: [], maintenance: [] })` gives path `config.checks[1]`.
2. An own accessor under the name is rejected with 0 getter calls. A non-enumerable own data property under the name is rejected. No validator throws.
3. Valid HTTP checks are accepted, with the same object returned and no mutation. That covers literal headers, an empty-string literal and env references, as a single check, inside a response (the element keeps its identity) and inside an export. Every existing message stays byte-identical, both for the other header rules and for the other check types.
4. The admin validators keep their behavior and texts: input, view, both config lists and the export marker rule.
5. The probe's `loadChecks` resolves on a feed with a malformed record and a valid sibling. It loads exactly the sibling and logs the existing skip line `skipping invalid check <id>: checks[<i>].headers.__proto__: is not an allowed header name` once per logger. That holds for both orders and for the `/probe/checks` and public `/checks` fallback paths. No log line holds a header value.

## Risks

- **Stricter acceptance for consumers on a later pin bump:** a feed or export that holds such a header now fails as a whole (`validateChecksResponse`, `validateAdminConfigExport`) or per record (probe, notify, api `validateCheck`). The api already refuses these at write and file intake, so no supported producer emits one.
- **Pin jump in probe:** the bump pulls the 30 contract commits since `7ce23aa`, not just this fix. A preview with `1b5e7d3` passed probe's full check. The probe child must repeat it on the real merged SHA.
- **Mistaken scope:** a fix only in `validateCheck` (and not in `checkBase`) would miss the response and export paths. Required behavior 1 tests all four.
- **Disclosure:** a failing assertion could print a header value. Assertions compare the whole result object, and fixtures use a fixed sentinel that is asserted absent from every error text and log line.

## Performance impact

The api's `bench/budgets.json` has these keys for the two targets:
- contract (lines 233-244): `test_cpu_s` 9.0 with floor 2, and `build_cpu_s` 6.4;
- probe (lines 121-157): `startup_cpu_ms` 377, `load_cpu_s` 0.5, `idle_rss_mib` 79, `peak_rss_mib` 83 and `test_cpu_s` 2.3, plus the reported `startup_wall_ms` 1027 and `image_mb` 124.

Expected effect per metric:

- contract `test_cpu_s`: rises by less than 0.2 s. The new suite makes a few hundred validator calls over three entries. Base measured locally: 4.8 s.
- contract `build_cpu_s`: none expected. One helper moves and no module is added. Base: 1.9 s.
- probe `test_cpu_s`: rises by about 0.1 s for the pin bump (1.7 s to 1.8 s measured) and by less than 0.1 s for one loopback suite. It stays below 2.3 s.
- probe `image_mb`: rises by about 0.5 MB, because the contract package grows from 708 KiB to 1236 KiB.
- probe `startup_cpu_ms`, `load_cpu_s`, RSS and `startup_wall_ms`: none expected beyond noise. The fix adds one own-property lookup per HTTP check. The bump also brings the contract's plain-JSON fast path (`f3d0e10`), which can only lower validation CPU.
- p95 latency and requests per second: none. The api does not change.
- **How to measure:** run `bun run test` and `bun run build` (contract) or `bun run test` (probe) three times each at `BASE` and `HEAD` under `/usr/bin/time -f '%U %S'`, and report the median of user+system. Optionally, from an api checkout, run `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref probe=<branch SHA>` (api `bench/README.md:76-88`).

## Security impact

Security impact: yes

The change tightens validators at a trust boundary (contract) and changes which records reach the probe HTTP client's headers. It also moves a dependency pin.

Checklist items that apply:

- **Input validation:** the reserved own header name is rejected on every public check path and in the export, and admin is unchanged.
- **Accessor execution:** the rule uses `Object.hasOwn` and never reads the value. An accessor's getter count stays 0.
- **Secrets in errors and logs:** the error text is the fixed literal of decision 2. The tests assert that a sentinel value appears in no error and no probe log line.
- **Probe HTTP client headers:** after the fix, a record with an unchecked header never reaches `resolveHeaders`.
- **Dependency pins:** only probe's contract pin moves, to a full SHA on contract `main`, and `bun.lock` changes only that entry.
- Not applicable: admin routes and auth order (unchanged), body and size limits, SSRF and redirects, file writes, Dockerfile, CI.

Hostile inputs for the security state, built at runtime and named by class only:

- every value class of Counterexamples under the reserved name;
- the name as an own accessor (with a counter), as a non-enumerable own property, and on a null-prototype record;
- explicit and implicit HTTP type;
- the record at index 0 and at a later index of a response and an export;
- a feed served over loopback to the real `loadChecks`, on both feed paths;
- a Proxy whose traps throw, wrapped as the headers record. Expected: `ok: false` with no escaping exception. The exact text is not specified (Proxy is out of scope).

## Rollout order

1. **contract**: merge the fix to `main`. No release tag is needed, because consumers pin a commit SHA. Every consumer keeps its old pin and its old behavior:
   - api, status, notify and console stay on `1b5e7d3`;
   - probe stays on `7ce23aa`.
   
   The wire version stays 1, so all of them still talk to each other.
2. **probe**: after the contract merge, pin the merged SHA and merge. A probe that is not yet upgraded still has today's failure mode, but only if the api serves such a check. The api's write and file guards prevent that today. An upgraded probe talks to any api at wire version 1.

Later pin bumps of api, status, notify and console are not part of this feature. Each of them is safe:
- api's checks-file guard runs before its `validateCheck` call (`src/config.ts:227-256`), so its message `checks[0].headers: must not contain the name __proto__` stays the same;
- status reads the public `GET /checks`, which has no `headers`;
- console and notify only see what the api serves.

## Counterexamples

- **Value classes** that the rule must reject under the reserved name. A wrong implementation that validates the value instead of the name gets some of these wrong:
  - null, a number, a boolean, an array;
  - an empty object, an object with an invalid env name, an object with a non-string env;
  - a keep-like object, a keep-like object with an extra key;
  - a literal string holding a sentinel, a valid env reference.

  The last two are valid header values. They must still be rejected, because the rule is about the name. An implementation that only rejects values that crash the probe accepts them, which is wrong.
- **Wrong place:** a guard added only to `validateCheck` lets `validateChecksResponse` and `validateCheckWithState` pass. A guard only in the probe leaves the contract accepting. Both are wrong.
- **Ownness:** a non-enumerable own property must be rejected. `Object.keys` misses it, so an implementation built on it is wrong. An own accessor must be rejected with 0 reads, so an implementation that reads the value (`headers["__proto__"]`, or `in` plus a read) is wrong. A record that only inherits the name must still be accepted (base behavior). An implementation that uses `in` gets this wrong.
- **Prototype:** a null-prototype record must be rejected. `headers.hasOwnProperty(...)` throws on it, so an implementation built on it is wrong.
- **Type:** explicit `type: "http"` and an absent type must both be rejected. A `tcp` check with any `headers` keeps its base message `check.headers: Invalid input: expected never, received object`.
- **Identity:** a valid response `[v]` must return `value === input` and `value[0] === v`. An implementation that copies or strips keys gets this wrong.
- **Messages:** `check.headers.Host: is a header the probe controls` and `check.headers.X-A.env: must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$` stay byte-identical (base literals from this run).
- **Probe order:** with the malformed record first and with it last, the result is exactly `["ok"]`. A partial fix that only stops after the throw would load the first record and lose the rest.
- **Probe dedup:** two loads with the same logger give exactly one skip line for the malformed ID.

No statistics are involved.

## Contract fields

No new names. No field, key, route, setting, type or index export is added or renamed. The error text already exists. The only new identifier is an internal helper of `src/validate-core.ts`. It is not exported from `src/index.ts`, and the smoke test's export list (`test/smoke.test.ts:57+`) must stay byte-identical. Searches in this run:

- `grep -rn 'reservedHeader' .repos/contract/src .repos/config`: no match (0 lines). The same search in `.repos/probe/src .repos/api/src` also gives 0.
- `grep -rn 'is not an allowed header name' .repos/contract/src .repos/config .repos/probe/src .repos/api/src`: one match, `contract/src/validate-admin.ts:43`. That is the text being reused, not a collision.

## Repository: contract

Files:
- `src/validate-core.ts`
- `src/validate.ts`
- `src/validate-admin.ts`
- `dist/validate-core.js`
- `dist/validate-core.d.ts`
- `dist/validate.js`
- `dist/validate-admin.js`
- `test/reserved-header.test.ts` (new)
- `test/validate-diff.test.ts`
- `README.md`
- `docs/index.md`

Behavior change: yes

The public check validators and the config-export validator now reject an own `__proto__` header that they used to accept.

If the recorded base already rejects such a header in `validateCheck` (Required behavior 1), request a hold instead of a review.

### Tool facts (verified)

- **Bun 1.4.0:** `package.json:7` (`packageManager`) and `:9` (`engines`). CI calls `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true` (`.github/workflows/ci.yml:17-19`). That file at the pin sets `bun-version: 1.4.0` (lines 22-24). It runs Install `bun install --frozen-lockfile` (25-26), Lint (27-28), Typecheck (29-30), Build (31-33), `git diff --exit-code -- dist` (34-36) and Test (37-38). The pinned file is identical to the config clone.
- **Scripts:**
  - `check` = `bun run lint && bun run build && bun run typecheck && bun run test` (`package.json:28`);
  - `lint` = `biome check . && pulse-eslint .` (`:25`);
  - `build` = TypeScript 7 (`typescript7`, `npm:typescript@7.0.2`, `:22,36`) with `tsconfig.build.json`.
- **Biome 2.6.3** (`package.json:31`). `biome.json` extends `@lorenzh/pulse-config/biome.json`. At pin `51e95b0`, that file excludes `**/dist` (lines 10-17) and sets line width 100 (line 23). It is identical to the clone.
- **Coverage:** `bunfig.toml:1-4` sets `coverage = true` and a line threshold of 0.8, and ignores `test/**` and `dist/**`.
- **Dist test:** `test/smoke.test.ts:15-54` rebuilds into a temp directory and compares the 20 named modules with `dist/`. `:56+` checks the export names of the `@lorenzh/pulse-contract` package entry.

### Behavior

Implement decisions 1-6: the helper in `validate-core.ts`, the call first in the `case undefined: case "http":` branch of `checkBase`, and the admin import. Then run `bun run build` and commit exactly the four dist files listed. Do not touch `src/index.ts`, `src/schema.ts`, `src/admin.ts`, `src/version.ts` or `package.json`.

### Tests (regression first)

Record `BASE=$(git rev-parse HEAD)` before the first edit. Write `test/reserved-header.test.ts` and the `15b` change first, and run them at `BASE`.

The new suite loops over three entries, like `test/security-review.test.ts:20`:
- `source` (`../src/index.ts`);
- `built` (`../dist/index.js`);
- `package` (`await import("@lorenzh/pulse-contract")`, as in `smoke.test.ts:57`).

Fixture rules:
- Fixtures are built in the test code with `Object.defineProperty` or by parsing test-built text.
- Each fixture is a valid HTTP check plus one own reserved header, and valid state fields where needed.
- Titles name classes only.
- The literal value uses the sentinel `RESERVED-HEADER-SENTINEL-865`.

| # | Exact test title (prefix `<entry>: `) | Covers | Expected at `BASE` |
|---|---|---|---|
| C1 | `public check validators reject a reserved header name for every value class` | Required behavior 1. Each value class of Counterexamples, implicit and explicit HTTP type, plain and null-prototype record. `assert.deepEqual` against the exact result objects with the literal paths `checks[3]`, `check`, `checks[1]`, `config.checks[1]`. `JSON.stringify(result)` never contains the sentinel. | fails: `validateCheck` returns `ok: true` (verified in this run) |
| C2 | `a reserved header name is rejected by descriptor without reading it` | Required behavior 2. An own accessor with a read counter (expects 0 reads), a non-enumerable own data property, each through `validateCheck` and `validateChecksResponse`. Also a Proxy headers record whose traps throw: `ok: false`, no exception (this run gave `check: is not a valid value` on the base and with the prototype; it is a control inside C2). | fails: accessor and non-enumerable cases return `ok: true` (verified) |
| C3 | `valid headers keep identity through the public check validators` | Required behavior 3. Literal, empty-string and env-reference headers, as a single check, in a response and in an export. Each returns `ok: true`, `value === input`, `value[0] === item` for the response and `value.checks[0] === item` for the export, and `deepEqual` to a `structuredClone` taken before the call. | passes (control) |
| C4 | `other header rules and an inherited name are unchanged` | The literal messages from Counterexamples for a forbidden name, an invalid env name and a `tcp` check with headers. A record that only inherits the reserved name returns `ok: true`. | passes (control; literals verified on base in this run) |
| D1 | `15b: an own __proto__ key` (existing title in `test/validate-diff.test.ts`) | Decision 8: only the last line changes. The candidate gives `fail("check.headers.__proto__: is not an allowed header name")` and the reference gives `OK`. The other four `same(...)` calls are unchanged. | fails: the candidate returns `ok: true` |

Existing controls, which must stay byte-identical and pass at `BASE` and `HEAD`:
- `test/admin.test.ts:1191` (all admin paths);
- `test/security-review.test.ts:216,230`;
- `test/security-adversarial.test.ts`;
- `test/http-options.test.ts`, `test/validate.test.ts`, `test/runtime-getters.test.ts`;
- `test/version.test.ts` (`WIRE_VERSION === 1`);
- `test/smoke.test.ts`.

**Red/green evidence:**
1. At `BASE` plus the new tests, run `bun test test/reserved-header.test.ts test/validate-diff.test.ts`:
   - C1, C2 and D1 fail for the stated reason, for all three entries;
   - C3, C4 and the rest of the differential suite pass.
   
   A control that fails at `BASE` is redesigned, never reclassified as a regression. An import or setup error is not red evidence.
2. Implement and rebuild, then run the same command. Everything passes.
3. Report pass or fail per title and entry for both runs. Judge the focused run by its results only: `bunfig.toml` enforces coverage on every `bun test`, so its exit status is not a criterion.

### Documentation

- `README.md`: in Usage, after "Validators never throw", add one sentence. It says that every check validator rejects a header named `__proto__` (an own property, whatever its value) with `<path>.headers.__proto__: is not an allowed header name`, without reading its value.
- `docs/index.md`:
  - In the `headers` row (line 200), add that the name `__proto__` is not allowed.
  - Next to the error-format paragraph (lines 640-649), list the validators that apply the rule: `validateCheck`, `validateCheckWithState`, `validateChecksResponse`, `validateAdminConfigExport`, and the admin input, view and config validators.
  - State that the value is never read and that success still returns the same object.
- No payload, JSON fixture or command in either file.

### Completion checks (expected values are literals of this spec)

1. Focused run as in Red/green. C1-C4 for `source`, `built` and `package`, and D1, are listed as passed, with `0 fail` in the summary.
2. `bun run check` exits 0, with line coverage at or above the 0.8 in `bunfig.toml`, which stays unchanged.
3. **Dist freshness against the committed tree:** after the last commit, `bun run build && git diff --exit-code -- dist` exits 0, and `git status --porcelain -- dist` prints nothing. `git diff --name-only "$BASE" HEAD -- dist | LC_ALL=C sort` prints exactly `dist/validate-admin.js`, `dist/validate-core.d.ts`, `dist/validate-core.js`, `dist/validate.js`. That list is literal from the prototype run.
4. `grep -c 'is not an allowed header name' src/validate-core.ts` gives 1, and the same grep gives 0 in `src/validate-admin.ts` and `src/validate.ts`. `grep -n '__proto__' README.md docs/index.md` shows the new sentences.
5. Disclosure: `git diff "$BASE" HEAD -- README.md docs | grep '^+' | grep -c '{"'` gives 0, so the docs hold no JSON fixtures.
6. CPU: the `test_cpu_s` and `build_cpu_s` medians at `BASE` and `HEAD` as in Performance impact. `HEAD` stays below 9.0 s and 6.4 s.
7. **Exclusive scope**, after the last commit, each step reported separately:
   - G1: `diff <(git diff --name-only "$BASE" HEAD | LC_ALL=C sort) <(printf '%s\n' README.md dist/validate-admin.js dist/validate-core.d.ts dist/validate-core.js dist/validate.js docs/index.md src/validate-admin.ts src/validate-core.ts src/validate.ts test/reserved-header.test.ts test/validate-diff.test.ts | LC_ALL=C sort)` exits 0.
   - G2: `git diff --name-only --cached` prints nothing.
   - G3: `git diff --name-only` prints nothing.
   - G4: `git status --porcelain` prints nothing, untracked files included.
   - G5: `git diff --exit-code "$BASE" HEAD -- src/index.ts src/schema.ts src/admin.ts src/version.ts dist/index.js dist/index.d.ts dist/schema.js dist/schema.d.ts dist/validate.d.ts dist/validate-admin.d.ts dist/version.js test/reference test/admin.test.ts test/security-review.test.ts test/security-adversarial.test.ts test/smoke.test.ts test/version.test.ts test/types.fixture.ts package.json bun.lock bunfig.toml biome.json tsconfig.json tsconfig.build.json eslint.config.js lefthook.yml .github/workflows/ci.yml AGENTS.md CLAUDE.md` exits 0. All these paths exist at `1b5e7d3`.
8. **Scope fixture proof** in a disposable `mktemp -d` Git repository outside the checkout, deleted afterwards. Use `allowed.txt` and `protected.txt`, harmless edits, and the same G1-G5 with those lists. Expected results (P pass, F fail) are fixed by this spec. They were reproduced in this planning run:

   | State | How | G1 | G2 | G3 | G4 | G5 |
   |---|---|---|---|---|---|---|
   | S1 clean allowed-only | commit a change to `allowed.txt` | P | P | P | P | P |
   | S2 committed protected | from S1, commit a change to `protected.txt` | F | P | P | P | F |
   | S3 unstaged protected | from S1, edit `protected.txt` | P | P | F | F | P |
   | S4 staged protected | from S1, edit and `git add protected.txt` | P | F | P | F | P |
   | S5 restored worktree, staged | S4, then `git restore --worktree --source="$BASE" -- protected.txt`; `git diff "$BASE" -- protected.txt` is empty | P | F | F | F | P |
   | S6 restored worktree, committed | S2, then the same restore; `git diff "$BASE" -- protected.txt` is empty | F | P | F | F | F |
   | S7 untracked | from S1, create `extra.txt` | P | P | P | F | P |
   | S8 clean again | reset the fixture to S1 | P | P | P | P | P |

**PR text:** name issue #865 and the finding id with location, class, impact and fix direction only. List C1-C4 and D1 with their results at `BASE` and `HEAD`. Include G1-G5, the fixture table, the dist check and the CPU medians. Known limits: Proxy inputs (unspecified text), inherited names and case variants stay accepted. No payload.

## Repository: probe

Files:
- `package.json`
- `bun.lock`
- `src/client.reserved-header.test.ts` (new)
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Behavior change: yes

With the new contract pin, a check that holds an own `__proto__` header is skipped and its siblings load. Today the whole load fails, or the header is silently dropped.

If the recorded base already shows that (R1 passes at `BASE`), request a hold instead of a review.

This task waits for the contract child to merge. Take `C=$(gh api repos/lorenzh/pulse-contract/commits/main --jq .sha)` after that merge. Confirm that `C` contains the fix: at `C`, `src/validate.ts` imports the helper of decision 4, which shows as a match for `is not an allowed header name` in `src/validate-core.ts`. Never pin a branch, an unmerged commit or a local link.

### Tool facts (verified)

- **Bun 1.4.0:** `package.json:8` (`packageManager`) and `:10` (`engines`). CI calls `check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` without `build` (`.github/workflows/ci.yml:18`). At that pin, the file sets `bun-version: 1.4.0` and runs Install (`--frozen-lockfile`), Lint, Typecheck and Test (lines 22-30, 37-38; the Build steps 31-36 are skipped without `build`). It is identical to the config clone.
- **Scripts:**
  - `check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`);
  - `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`:16`);
  - `start` = `bun src/main.ts` (`:13`).
- **Biome 2.6.3** (`package.json:22`). `biome.json` extends the config at `04108fa`. That file excludes `**/dist` and `**/bun.lock` (lines 10-17) and sets line width 100 (23). It is identical to the clone.
- **Coverage:** `bunfig.toml:1-4` sets `coverage = true` with `{ lines = 0.8, functions = 0 }`.
- **Contract pin:** `package.json:30` is `github:lorenzh/pulse-contract#7ce23aaf3fa3e038f65ecfed755188b83bde143f`. The matching `bun.lock` lines are 8 and 78.

### Behavior

- Replace the SHA on `package.json:30` with the full `C`, then run `bun install` once to update `bun.lock`.
- Nothing else changes: kit, config and tool pins, scripts, settings and every file under `src/` except the new test.
- `src/client.ts` stays byte-identical.

### Tests (regression first)

Record `BASE=$(git rev-parse HEAD)` before the first edit. Write the suite first, run it at `BASE` with the old pin, then bump.

Fixture rules:
- A `node:http` server on `127.0.0.1` port 0, closed in `after`.
- The server sends raw JSON text built in the test, with `x-pulse-contract: 1` so that no version warning appears. The own key survives the client's `JSON.parse`.
- The malformed record has ID `bad`, the sibling has ID `ok`, and both have a loopback URL.
- The suite calls the real exported `loadChecks` with `token` set, and collects `log` lines.

| # | Exact test title | Covers | Expected at `BASE` |
|---|---|---|---|
| R1 | `loadChecks skips a check with a reserved header name and loads its valid sibling` | Malformed record first, value class null. Resolves to exactly the IDs `["ok"]`. Exactly one log line, equal to `skipping invalid check bad: checks[0].headers.__proto__: is not an allowed header name`. | fails: rejects with `TypeError` (verified) |
| R2 | `loadChecks skips the reserved header name for every value class and either order` | Classes null, number, boolean, array, empty object, invalid env, literal sentinel `RESERVED-HEADER-SENTINEL-865`, valid env reference, with the malformed record first and last. Each gives `["ok"]` and one skip line with the matching index, and no log line contains the sentinel. | fails: throws for 4 classes, loads `bad` for literal and env (verified) |
| R3 | `loadChecks skips the reserved header name on the public checks fallback` | `/probe/checks` answers 404 and `/checks` serves the feed. Gives `["ok"]` and the skip line. | fails: rejects |
| R4 | `loadChecks logs the reserved header skip once per logger` | Two loads with the same `log`. Both give `["ok"]`, with exactly one skip line in total. | fails: rejects |

Controls, which must stay byte-identical and pass at `BASE` and `HEAD`:
- `src/client.test.ts` (heartbeat drop, invalid-check skips, version-header warnings);
- `src/client.http-options.test.ts` (literal and env headers);
- `src/client.probed-types.test.ts`;
- `src/main.test.ts`.

**Red/green evidence:**
1. At `BASE`, with the old pin and the new file, run `bun test src/client.reserved-header.test.ts`. R1-R4 fail for the stated reasons. A missing install or a type error is not red evidence.
2. Bump the pin and run the same command. R1-R4 pass.
3. Run the four control files at `BASE` and at `HEAD`. They pass both times.
4. Report pass or fail per title. The focused run is judged by its results only (coverage note as in contract).

### Documentation

- `README.md`: one sentence near the header-secret paragraph. A check that fails the contract validator is skipped with a `skipping invalid check` line while the other checks keep running, and that includes a check with a header named `__proto__`. Link to `docs/troubleshooting.md`.
- `docs/configuration.md`: in the `headers` bullet (line 100), say that the header name `__proto__` is not allowed. Such a check is skipped with `skipping invalid check <id>: checks[<i>].headers.__proto__: is not an allowed header name`, and the other checks load.
- `docs/troubleshooting.md`: under `## skipping invalid check: ...` (lines 60-63), add this message as a second example. Older probes could fail the whole load on it and retry, and upgrading the probe fixes that. Keep the existing dedup and recovery text unchanged.
- No payload, JSON fixture or command.

### Completion checks (expected values are literals of this spec)

1. **Pin content:**
   - `git diff "$BASE" HEAD -- package.json` changes exactly one line, from `#7ce23aaf3fa3e038f65ecfed755188b83bde143f` to `#<C>`.
   - `git diff "$BASE" HEAD -- bun.lock` changes exactly the two contract lines: the dependency line and the package entry. That gives `git diff --numstat "$BASE" HEAD -- bun.lock` = `2 2 bun.lock`, as in the preview of this run.
   - `bun install --frozen-lockfile` succeeds.
   - `node_modules/@lorenzh/pulse-contract/dist/validate-core.js` contains `is not an allowed header name`.
   - `C` equals the contract `main` SHA that GitHub reports. That is an independent source, not this file.
2. Focused run: R1-R4 are listed as passed with `0 fail`.
3. `bun run check` exits 0, with coverage at or above 0.8 (`bunfig.toml` unchanged).
4. **Startup exercise** (AGENTS.md): start a throwaway local fake API on `127.0.0.1` that serves the R1 feed on `/probe/checks` with `x-pulse-contract: 1`. Run `PULSE_API_URL=<it> PULSE_PROBE_TOKEN=<local test token> PULSE_HEALTH_PORT=<free port> bun run start` and let it run for about 5 s. The log must contain the R1 skip line and `running 1 check(s) against <url> from location default`. Stop it with SIGTERM and remove the fake API. Report the two lines and the exit, and keep the fixture out of the PR text. On `BASE`, this run logged `fetching checks failed: ...` instead and no `running` line.
5. Test CPU: medians at `BASE` and `HEAD` (Performance impact). `HEAD` stays below 2.3 s.
6. **Exclusive scope**, after the last commit, each step reported separately:
   - G1: `diff <(git diff --name-only "$BASE" HEAD | LC_ALL=C sort) <(printf '%s\n' README.md bun.lock docs/configuration.md docs/troubleshooting.md package.json src/client.reserved-header.test.ts | LC_ALL=C sort)` exits 0.
   - G2: `git diff --name-only --cached` prints nothing.
   - G3: `git diff --name-only` prints nothing.
   - G4: `git status --porcelain` prints nothing.
   - G5: `git diff --exit-code "$BASE" HEAD -- src/client.ts src/check.ts src/main.ts src/settings.ts src/header-hosts.ts src/reloader.ts src/client.test.ts src/client.http-options.test.ts src/client.probed-types.test.ts src/main.test.ts bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml .github/workflows/ci.yml Dockerfile AGENTS.md CLAUDE.md docs/operation.md docs/index.md docs/install.md docs/development.md` exits 0. All these paths exist at `9490141`.
7. **Scope fixture proof:** the same eight-state table and procedure as in the contract section, with the same expected P/F results.

**PR text:** name issue #865 and the contract merge SHA. List R1-R4 at `BASE` and `HEAD`, the control results, G1-G5, the fixture table, the two startup log lines and the CPU medians. Known limit: an un-upgraded probe keeps the old failure mode. No payload.

## Acceptance evidence (feature)

The issue's "Done when" is met by probe completion check 4: a real `bun run start` against a local feed with the malformed check and one valid sibling logs the skip line and `running 1 check(s) ...`. R1-R4 back it up, and so do contract C1-C4 and D1, together with the scope evidence of both children.
