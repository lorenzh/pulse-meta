# Spec #619: contract: restore a fast path for plain JSON in validate-core

## Goal

Make the shared validator core fast again for plain JSON input. Plain JSON here means plain objects and dense arrays that hold only own data properties, as `JSON.parse` returns them. Such input must validate as fast as it did before PR #44 (lorenzh/pulse-contract#44, merge `41dfbc8`) without giving up any own-data protection: inherited elements and fields, holes and accessors stay rejected or count as absent, as they do today. A plain-JSON input skips the own-data copy and is parsed directly. Every other input still takes the copy path. This fixes the CPU regression in api result ingest, status history polling and notify polling (issue comment on #605). Those services get the fix when they update their contract pin.

## Verified state

- **Baseline ("main" in the issue).** PR #44 merged as `41dfbc8348c8c39b397f406368c813bb4edf5546`, with first parent `ebcbbb613328494185833f7133f1242910986948` (merge of PR #42, 2026-10-30). That first parent is the `main` the reviewer of #44 measured. At `ebcbbb6`, `src/validate.ts` `problem` reads `schema.safeParse(isOwnData(schema, value) ? value : ownView(schema, value))`, and `isOwnData` is a per-schema compiled walk cached in a `WeakMap`. At `41dfbc8`, `src/validate-core.ts:154` reads `schema.safeParse(ownView(schema, value))`. That is the line the issue names. The walk was removed in commit `a2a5dd3` ("parse only the own-data copy so a proxy cannot swap values"). Its parent `9dcd308` had already tightened the array walk (`Object.getPrototypeOf(value) !== Array.prototype` and `Object.hasOwn(value, i)`).
- **Current main.** Contract `main` = `7ce23aaf3fa3e038f65ecfed755188b83bde143f` still copies on every call: `src/validate-core.ts:293-296` (`problem` → `ownView`). Its comment at lines 288-292 gives the Proxy reason for always copying.
- **Same dependencies.** `ebcbbb6` and `7ce23aa` both pin `zod` 4.6.7 and `bun@1.4.0` (`package.json` lines 7-9 and 39). `uptimeDaySchema`, `checkUptimeSchema`, `latencyDaySchema` and `checkLatencySchema` did not change between them (`git diff ebcbbb6 7ce23aa -- src/schema.ts` touches only `warnDays` and the result `latencyMs`). The history workloads are therefore comparable across the two revisions.
- **Reproduced locally** (planning run, Bun 1.4.0, AMD EPYC 7763, 4 vCPU, `process.cpuUsage` user+system, JSON-parsed fixtures of 1,000 checks x 90 days, 2 warmups, median of 7). These numbers are evidence of the regression, not a budget:

  | Workload | `ebcbbb6` | `7ce23aa` |
  |---|---:|---:|
  | Uptime | 39.25 / 41.46 ms | 78.20 / 83.35 ms |
  | Latency | 54.36 / 54.12 ms | 119.48 / 119.04 ms |

- **Gaps found with exported validators on `7ce23aa`** (same planning run):
  - `validateUptimeResponse(a)` returns `ok: true` when `a = [item]`, `a.length = 2`, and `Object.setPrototypeOf(a, [item, item])`. The top-level `arrayProblem` (`src/validate.ts:63-81`) reads `value[i]` (line 75) and only rejects accessors (line 72), so an inherited top-level element passes. This is wrong today and must be fixed here.
  - A 90-day `days` array whose last day is inherited through a custom array prototype is rejected on `7ce23aa` (`uptime[0].days[89]: is required`) but accepted on `ebcbbb6`. Restoring the `ebcbbb6` walk as it was would therefore bring back an accepted inherited element.
  - With an enumerable `Object.prototype.extra`, `validateComponent({ id: "web", name: "Web", checkIds: ["c"] })` returns `ok: true` on `7ce23aa` but `ok: false` (`component: has an unknown field: extra`) on `ebcbbb6`. The reason: Zod's strict-object key check is a `for … in` loop (zod `v4/core/schemas.js`, `handleCatchall`), and that loop also sees inherited enumerable keys.
  - A top-level hole is rejected on both revisions as `uptime[1]: must be an object`.

## Scope

- One repository: `contract`. The change goes in `src/validate-core.ts` (fast path), `src/validate.ts` (`arrayProblem` own-data element read), the tests, a CPU A/B script, docs, the patch version and the regenerated `dist/`.

## Non-goals

- Proxy inputs. A fast path cannot portably tell a Proxy whose traps disagree from a plain object. `node:util` `types.isProxy` is not an option: the contract must stay importable in a browser (`docs/index.md`, "API client": "uses web APIs only"). A Proxy never comes from `JSON.parse` or an HTTP body, so it cannot cross a service's trust boundary. Validators must still never throw on a Proxy, including one with throwing traps.
- No consumer pin updates (api, status, notify, probe). Each consumer gets the gain with its next contract pin bump, which is not part of this spec.
- No new public API, no caller trust flag, no schema, type, wire or `WIRE_VERSION` change, and no change to `bench/budgets.json` in the api.
- Do not redo #561/#616 (tokens, audit) or #596 (header secrets). Their own-data tests stay as they are.

## Required behavior

1. **Fast path.** `problem(schema, value, path)` parses `value` directly when a schema-driven walk of `value` certifies that parsing the original gives the same result as parsing `ownView(schema, value)`: same `ok`, and on failure the same error text. Otherwise it parses the copy, as today. The walk builds no copy of the input: it creates no object or array that holds input values, and no per-object view. At object and array schemas it allocates nothing per value: it reads precompiled key lists and uses indexed loops. The only allocation allowed is the two key arrays that `Object.keys` and `Reflect.ownKeys` return at a record schema (item 2). No record schema is on the history workloads (`uptimeDaySchema`, `checkUptimeSchema`, `latencyDaySchema`, `checkLatencySchema`, `src/schema.ts:638-712` on `7ce23aa`, hold only objects, arrays and scalars), so this allocation does not affect the CPU A/B. The walk runs no getter and is compiled once per schema. It may be cached by schema, for example in a `WeakMap<z.ZodType, Walk>` like `ebcbbb6`. Nothing is ever cached by input value: no `WeakSet` or `WeakMap` of inputs that already passed, so every call re-checks the input.
2. **What the walk certifies**, level by level along the schema (wrappers `optional`, `nullable`, `default` and `readonly` unwrap as in `ownView`):
   - **object schema, value an object (not an array):** the prototype is `Object.prototype` or `null`. Each declared key is either an own data property, read with no getter and no setter (an own accessor of either kind fails the walk), or absent with no inherited property of that name (`key in value` is false). Each declared own value passes its field's walk.
   - **array schema, value an array:** the prototype is `Array.prototype`. Every index `0..length-1` is an own data property: no hole, no inherited element, no accessor. Each element passes the element walk.
   - **record schema, value an object:** the prototype is `Object.prototype` or `null`. `Reflect.ownKeys(value).length === Object.keys(value).length`, so there are no symbol and no non-enumerable keys. Each key is an own data property, and each value passes the value walk. These two key arrays are the only allocation the walk may make (item 1), as in the `ebcbbb6` `compileRecordWalk` (`src/validate.ts:233-252` at `ebcbbb6`).
   - **union schema:** with exactly one object option (`onlyObjectOption`), an object value passes when it passes that option's walk, and a non-object value passes. With zero or several object options, an object value fails the walk, so the copy path (`dataView`) still decides. A non-object value passes.
   - **lazy schema** (recursive JSON value): an object or function value fails the walk (copy path). A primitive passes.
   - **any value that the schema branch does not copy** (a primitive, a function where an object is expected, an array where an object is expected): passes, because `ownView` passes it through unchanged too.
   - **inherited enumerable keys:** when `Object.prototype` has any enumerable string key, every object at an object schema fails the walk. This keeps item 1 true for Zod's `for … in` strict-key check. The check is cheap enough to run once per `problem` call.
3. **Top-level array elements are own data.** `arrayProblem` (`src/validate.ts:63-81`) passes `ownValue(value, i)` to the item check instead of `value[i]`. A hole or an inherited element at index `i` reaches the item check as `undefined` and fails with the item check's usual text. For an object item that text is `<path>[<i>]: must be an object`, the same as a top-level hole today. An accessor element still fails first with `<path>[<i>]: is required` (line 72-74). This covers every array validator built on `arrayProblem`: checks, results, incidents, maintenance, latency, uptime, locations, components, components uptime, manual incidents.
4. **Unchanged:** on success, validators return the same object (`verdict`). They never throw: a throwing trap or getter is caught by `verdict` and gives `<path>: is not a valid value`. Error formats, paths and texts of every non-Proxy case stay the same, as do the schemas, the exported names and types, `WIRE_VERSION`, and `zod` 4.6.7 as the only runtime dependency.
5. **Proxy test and comment.** Rewrite the comment on `problem` (`src/validate-core.ts:288-292`): plain own-data input is parsed directly once the walk certifies it, and Proxy inputs are out of scope because a Proxy whose traps disagree can pass the walk. Replace the test `a Proxy whose get differs from its own data descriptor is judged by the descriptor` (`test/tokens.test.ts:313-338`). The new test asserts only that each of those validator calls returns a `Validation` (`typeof result.ok === "boolean"`) and does not throw. Change no other Proxy test. The hostile-trap tests (`test/validate.test.ts` "hostile proxies … never throw", `test/admin.test.ts` cyclic prototype) must pass unchanged.

## Risks

- **A walk that is too permissive brings back an own-data hole.** The `ebcbbb6` walk accepted inherited array elements (see Verified state) and treated all multi-option unions as `alwaysOwn`. Mitigation: required behavior 2, plus counterexamples 1-4 and 9 as red tests (each fails on current `main` or against the historical walk), and counterexamples 5-8 and 10-12 as guards, all through exported validators.
- **The walk diverges from the copy in its verdict or error text.** Mitigation: item 1 states the invariant. Counterexamples 9 and 10 cover the two known divergences: Zod's `for … in` key check, and a setter-only accessor.
- **CPU above the threshold.** The added per-element `Object.hasOwn` and prototype checks cost more than `ebcbbb6`'s walk. If B exceeds 1.10 x A, keep the checks and make the walk cheaper. Cheaper means indexed loops, precompiled key lists, `lookupGetter`/`__lookupSetter__` instead of `getOwnPropertyDescriptor`, and one `Object.prototype` check per call. The 10% bound is not relaxed.
- **Cognitive complexity.** The walk compilers must stay under SonarJS cognitive complexity 15 per function. Split them per schema kind, as `ebcbbb6` did (`compileObjectWalk`, `compileRecordWalk`, `compileWalk`).

## Performance impact

Metrics in `bench/budgets.json` of the api (`main` `3fdfbe5`):

- `contract.test_cpu_s` (budget 9.0 s, gating): goes **down** by roughly 0.8-1.0 s. `test/validate.bench.test.ts` validates both history fixtures 9 times (2 warmups + 7 runs), at about 200 ms per round on `7ce23aa` and about 95 ms on `ebcbbb6` in the planning run. The new tests add only small inputs. `test/validate-cpu.ts` does not run under `bun test` (below), so it adds nothing.
- `contract.build_cpu_s` (6.4 s): none expected. A few more lines of source change nothing measurable.
- api, status, notify, probe (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, and the reported `startup_wall_ms`, `p95_*`, `rps`, `image_mb`, `cold_*`, `eod_*`): none expected from this spec. Each service builds with its own pinned contract (`7ce23aa` in api, status, notify and probe `package.json`), and this spec bumps no pin. After a later pin bump: status and notify `load_cpu_s` and api `load_cpu_s` / `p95_post_results_ms` go down, by the share of validation copies in their CPU, which is less than the 2x seen on the 1,000-check workload. Peak RSS may drop slightly (no per-call copies). Image size: none.
- **How the implementer measures it.** The acceptance A/B is the contract-level script below, not `bun bench/run.ts`, because the api bench uses each service's pinned contract. Optionally, `bun bench/run.ts --a <ref> --b <ref>` in the api repository shows the contract `test_cpu_s` change.

## Security impact

Security impact: yes. The change edits the own-data validators at the contract trust boundary, which parse every JSON body and API response.

Checklist items that apply:
- **Input validation:** inherited elements and fields, holes, symbol or non-enumerable record keys, multi-option unions and recursive JSON values must still be rejected, or count as absent, exactly as on the copy path. Top-level inherited elements are newly rejected (required behavior 3).
- **Accessor execution:** neither the walk nor the parse may run a getter on the fast path. Every getter counter in the existing tests stays 0.
- **Secrets in errors, logs and responses:** error texts must not change. No input value is added to any error.
- Not applicable: auth, body or size limits (unchanged, enforced by services), SSRF, file writes, dependencies (none added), Dockerfiles, CI.

Hostile inputs for the security state: the counterexamples below, plus polluted `Object.prototype` and `Array.prototype` getters and data values, a frozen array, an array subclass instance (`class A extends Array`), a null-prototype object, and the hostile-trap Proxies of the existing tests (they must never throw).

## Rollout order

One repository: only `contract` changes. Every consumer (api, status, notify, probe) pins contract by SHA (`7ce23aa`). They keep working unchanged on the old pin. On a new pin they get the same validator API and types, the same results for plain JSON, and less CPU. The only new rejection is a top-level array element that is not own data. `JSON.parse` never produces one, so no service response or request that works today starts failing. The package version goes from `1.7.0` to `1.7.1` (semver patch, `docs/index.md` "The package version … follows semver").

## Counterexamples

Every case runs through an exported validator. `item` is a valid `CheckUptime` with 90 own days. `litem` is a valid `CheckLatency`.

Each case has one of three labels. The label says where the case is red, so the test can be shown to fail:

- **R-main**: fails on current `main` `7ce23aa` as it is. These are cases 1 and 2. Both exercise the top-level `arrayProblem` read at `src/validate.ts:75`.
- **R-walk**: passes on `7ce23aa` but fails against the **historical walk**. These are cases 3, 4 and 9. On `7ce23aa`, nested elements are already read with `ownValue` (`src/validate-core.ts:88-95`, `arrayView`), so 3 and 4 are rejected there. The historical walk is a throwaway local change of `7ce23aa`: copy the `ebcbbb6` functions `Walk` through `isOwnData` (`src/validate.ts:189-312` at `ebcbbb6`, fetched with `gh api "repos/lorenzh/pulse-contract/contents/src/validate.ts?ref=ebcbbb613328494185833f7133f1242910986948" --jq .content | base64 -d`) into `src/validate-core.ts` unchanged, and make `problem` call `schema.safeParse(isOwnData(schema, value) ? value : ownView(schema, value))` (line 316 there). Leave `arrayProblem` as it is. Cases 1 and 2 also fail there. Never commit that change.
- **Guard**: passes on `7ce23aa` and against the historical walk today. Guards are cases 5, 6, 7, 8, 10, 11 and 12. They are mutation guards: they fail only for a wrong fast path, for example one that caches trust per input (8), skips the prototype or `key in value` check (7), or treats a setter-only accessor as data (10). The implementer does not have to show a guard red.

1. **Top-level mixed own and inherited (R-main).** `a = [item]; a.length = 2; Object.setPrototypeOf(a, [item, item])`. `validateUptimeResponse(a)` → `{ ok: false, error: "uptime[1]: must be an object" }`. The same goes for `validateLatencyResponse` with `litem` (`latency[1]: must be an object`).
2. **Top-level all inherited (R-main).** `a = new Array(2); Object.setPrototypeOf(a, [item, item])` → `uptime[0]: must be an object`.
3. **Nested inherited day (R-walk: rejected on `7ce23aa`, accepted by the historical walk).** `days = item.days.slice(0, 89); days.length = 90; Object.setPrototypeOf(days, item.days)`. `validateUptimeResponse([{ ...item, days }])` → `uptime[0].days[89]: is required`. The same holds for latency, and for `validateCheckUptime` (`uptime.days[89]: is required`).
4. **Nested mixed after a valid own element (R-walk: rejected on `7ce23aa`, accepted by the historical walk).** Days 0-88 own and day 89 inherited, inside the second item of a 2-item response: `[item, { ...item, days }]` → `uptime[1].days[89]: is required`. A walk that only inspects the first element or the first item gets this wrong.
5. **Holes (Guard).** Top level: `[item, , item]` → `uptime[1]: must be an object` (text unchanged from today). Nested: a 90-day array with a hole at 45 → `uptime[0].days[45]: is required`.
6. **Accessor elements and fields (Guard).** An accessor at top-level index 0 → `uptime[0]: is required`. An accessor at `days[0]` → `uptime.days[0]: is required` (existing test `test/validate.test.ts:570`). An accessor on a declared field such as `checkId` → `is required`. Every getter counter stays 0.
7. **Polluted `Object.prototype` declared key (Guard).** `Object.defineProperty(Object.prototype, "checkId", { value: "c", configurable: true })` with an item that has no own `checkId` → `uptime[0].checkId: is required`. A walk that uses `Object.hasOwn` alone and then lets Zod read `value.checkId` would accept it.
8. **Re-validation after mutation (Guard).** `validateUptimeResponse(fixture)` → ok. Then make `fixture[3].days[10]` an accessor (`Object.defineProperty` with a counting getter) and call again → `{ ok: false, error: "uptime[3].days[10]: is required" }`, getter count 0. Separately, on a fresh fixture that passed once, `delete fixture[3].days[10]` (a hole) and call again → `uptime[3].days[10]: is required`. The second call must not reuse the first verdict. A fast path that caches trust per input (a `WeakSet` of inputs that passed) gets this wrong.
9. **Inherited enumerable key and strict objects (R-walk: copy-path parity).** With `Object.defineProperty(Object.prototype, "extra", { value: 1, enumerable: true, configurable: true })`, `validateComponent({ id: "web", name: "Web", checkIds: ["c"] })` → `ok: true`, as on `7ce23aa`. The `ebcbbb6` walk gives `ok: false`.
10. **Setter-only accessor (Guard).** An own `checkId` with only a setter → `uptime.checkId: is required` (both revisions agree today). The walk must not certify it as an own data property.
11. **Copy-path cases stay as they are (Guard):** multi-option unions (`adminCheckInputSchema`, `adminCheckViewSchema`), recursive JSON (`jsonAssert[].equals`), records with symbol or non-enumerable keys, and non-plain prototypes (a `Date`, a class instance, an array subclass). All existing tests in `test/validate.test.ts`, `test/tokens.test.ts`, `test/audit.test.ts` and `test/admin.test.ts` pass unchanged, except the one Proxy test replaced under required behavior 5.
12. **Dense own-data controls (Guard).** `JSON.parse(JSON.stringify(fixture))`, a null-prototype item, and a non-enumerable own declared field (existing test "a non-enumerable own id is accepted") → `ok: true`, with `result.value === input`.

### CPU statistic (acceptance A/B)

- **Sides.** A = a worktree of `ebcbbb613328494185833f7133f1242910986948`. B = a worktree of the candidate PR head. Both run `bun install --frozen-lockfile`, on the same machine and the same Bun 1.4.0.
- **Workloads.** The two shapes of `test/validate.bench.test.ts`: 1,000 checks x 90 days, dates from 2026-01-01. Uptime has `uptime: 99.5, results: 288` per day and `uptime: 99.5` per check. Latency has `p50Ms: 120, p95Ms: 340, count: 288` per day. Each fixture is passed through `JSON.parse(JSON.stringify(...))` once, before any timing. Uptime is validated with `validateUptimeResponse` and latency with `validateLatencyResponse`, both imported from `<root>/src/index.ts`.
- **One invocation per side.** Before timing, assert `ok === true` and `value === input` for each workload. Then run 2 warmup calls and 7 measured calls per workload. Each sample is the `process.cpuUsage()` delta (user + system) around one call, in ms. The invocation median is the 4th smallest of the 7 samples.
- **Rounds.** Run 3 rounds in the order A, B, A, B, A, B, each as a fresh process. The side value for each workload is the median of its 3 invocation medians (the 2nd smallest). Do not average medians.
- **Pass.** For each workload separately, `B ≤ 1.10 × A`, compared unrounded. The PR reports values rounded to 0.01 ms and the change as `(B/A − 1) × 100` rounded to 0.1 %. The 1.10 factor comes from the issue ("within 10% of main"). A faster B passes.

## Contract fields

No new names. The change adds no exported symbol, field, key, route or type. The walk helpers stay module-private in `src/validate-core.ts`. The CPU script `test/validate-cpu.ts` is a test-side file name and not part of the package (`package.json` `files: ["dist"]`, line 18-20). To check the internal names for collisions before adding them: `grep -rn 'isOwnData\|walkOf\|compileWalk' .repos/contract/src .repos/config` returns nothing on the `7ce23aa` clone and the config clone.

## Repository: contract

Files:
- `src/validate-core.ts`: compiled own-data walk and fast path in the problem function, new comment on that function.
- `src/validate.ts`: the arrayProblem function reads each element with ownValue(value, i).
- `test/validate.test.ts`: counterexamples 1-10 and 12 for the uptime and latency history validators, and the item 7 polluted-prototype case.
- `test/tokens.test.ts`: replace the descriptor/get Proxy test (lines 313-338) as required behavior 5 says.
- `test/validate-cpu.ts` (new): the A/B script.
- `test/validate.bench.test.ts`: only if the shared fixture shapes are moved into `test/validate-cpu.ts` and imported from there. Otherwise leave it alone.
- `docs/index.md`: in "Validators" (around lines 357-360) and "Error format" (around lines 400-404), say that array elements at every level count only as own data, and that Proxy inputs are out of scope.
- `README.md`: only if it repeats the own-data or Proxy rule (it does not on commit 7ce23aa; check again).
- `package.json`: the version field goes from 1.7.0 to 1.7.1.
- `dist/validate-core.js`, `dist/validate-core.d.ts`, `dist/validate.js`, plus any other file under dist that the build script regenerates.

Behavior change: yes. The validator core gets a fast path, and top-level arrays now reject inherited elements.

### Behavior

Implement required behavior 1-5. Work test first, per `AGENTS.md` "Tests (TDD)". First write the red tests and watch them fail, each where its label in Counterexamples says:

1. Counterexamples 1 and 2 (R-main) fail on the branch before any source change, that is on `7ce23aa`.
2. Counterexamples 3, 4 and 9 (R-walk) pass on `7ce23aa`, because nested elements are already read with `ownValue` (`src/validate-core.ts:88-95`). Show them red once against the historical walk defined in Counterexamples: apply that throwaway change, run the tests, record which fail, and revert. Expected red there: 1, 2, 3, 4 and 9. Note the result in the PR. Never commit the historical walk.
3. The guards (5-8, 10-12) are written in the same step and pass on `7ce23aa`. They need no red run; they protect against a wrong fast path.

Then add the `arrayProblem` fix and the walk. If the code on the branch already rejects counterexamples 1-2 and parses certified plain JSON without the copy, request a hold instead of a review.

`test/validate-cpu.ts` is run as `bun test/validate-cpu.ts <contract root>`. It dynamically imports `<contract root>/src/index.ts` and narrows the two validators from `unknown` (no `any`, `AGENTS.md` "TypeScript"). It builds the two fixtures and runs one invocation as the CPU statistic section defines. It prints one JSON line: `{ root, bun: Bun.version, uptime: { samples, median }, latency: { samples, median } }`. It must work unchanged against the `ebcbbb6` worktree, which exports both validators from `src/index.ts` (checked in the planning run). It is not a `*.test.ts` file, so `bun test` does not pick it up: Bun's default test file pattern, and `bunfig.toml:1-4` sets no other pattern or root.

### Tool facts (cited)

- Bun 1.4.0: `package.json:7` (`packageManager`) and `:9` (`engines.bun`). CI pins Bun 1.4.0 at `lorenzh/pulse-config/.github/workflows/check.yml:24`, at the pinned ref `51e95b0eb463b27a196a33b428607bd92443e4f0`. Contract `ci.yml:17` uses that ref, with `build: true` (`ci.yml:19`).
- CI steps (pinned `check.yml`, same as the config clone `main` `bc87049`): `bun install --frozen-lockfile` (:26), `bun run lint` (:28), `bun run typecheck` (:30), `bun run build` (:33), `git diff --exit-code -- dist` (:36), `bun run test` (:38).
- `bun run check` = lint, build, typecheck, test (`package.json:28`). Lint is `biome check . && pulse-eslint .` (`package.json:25`).
- Biome 2.6.3 (`package.json:31`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. In that file at pin `51e95b0` (same as the clone), `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 10-17), so `test/validate-cpu.ts` is linted and formatted.
- ESLint: `eslint.config.js` extends `@lorenzh/pulse-config/eslint.config.js`. At pin `51e95b0` (same as the clone), line 16 sets `sonarjs/cognitive-complexity` to 15.
- Typecheck covers `src` and `test` (`tsconfig.json:3`), with TypeScript 7 (`package.json:23`, `typescript7` `npm:typescript@7.0.2` at `:36`). So `test/validate-cpu.ts` is type-checked.
- Coverage: `bunfig.toml:2-4` sets `coverage = true`, line threshold 0.8, and ignores `test/**` and `dist/**`. Do not lower the threshold.
- `dist/` freshness: `test/smoke.test.ts:15` ("dist matches a fresh build of src") plus the CI `git diff --exit-code -- dist` step.

### Checks

- `bun run check` passes on the PR head.
- Counterexamples 1-12 pass as tests on the PR head. The expected texts are the literals in the counterexamples.
- The PR states that 1 and 2 fail on `7ce23aa` (R-main), and that 3, 4 and 9 pass on `7ce23aa` but fail against the historical walk (R-walk), with the failing test names of that throwaway run. The guards are listed as passing on `7ce23aa`.
- The existing own-data tests pass unchanged, except the one replaced Proxy test, and the PR names it. `git diff 7ce23aa -- test/` shows no other removed assertion.
- `git diff --exit-code -- dist` is clean after `bun run build`. That compares an independent build with the committed files.

### Completion evidence (in the PR)

- The CPU A/B per the CPU statistic section: the resolved SHAs of A (`ebcbbb613328494185833f7133f1242910986948`) and B, the exact commands, `bun --version`, OS, CPU model, all 3 x 7 raw samples per side and workload, the invocation medians, the side values, and `(B/A − 1) × 100` for uptime and latency. Each must be ≤ 10.0 % (literal from the issue).
- Also one A/B of the current `main` `7ce23aa` against B with the same script, to show the gain from today's main (reported, not gating).
- The output of `bun run check`, and the list of tests added or changed.
