# Spec: #478 Small review leftovers (P3), round 7

## Goal
Close two should-fix review findings in pulse-status:

1. The identity-guard test in `src/answer-cache.test.ts` must fail when the guard
   `if (answers.get(key) === entry) entry.deps = built.deps;` (`src/answer-cache.ts` line 56) is
   replaced by an unconditional `entry.deps = built.deps;`. Today it stays green (lorenzh/pulse-status#55).
2. `bench/conditional.ts` must report `cpuMs`, `wallMs` and `rssMib` per route, as spec #480 asked,
   next to the existing totals (lorenzh/pulse-status#56).

## Scope
- `status` only: one test file and one bench script.

## Non-goals
- No change to `src/answer-cache.ts`, `src/server.ts` or any served code. The guard stays as it is;
  removing it as dead code is not asked for.
- No change to route order, `REQUESTS`, fixtures, the `--server` option or the warm-up request.
- No README or `docs/` change (`docs/development.md` names the bench only by purpose, no fields).
- No CI change: the bench is not run by CI or `bun test`.

## Decisions from the issue review (`.factory/work/478/issue-review.md`)
- Removing the guard can never overwrite a *newer* entry's deps: `settle` only ever writes its own
  closure's `entry`. The only observable effect of the guard is that an entry that was replaced in
  the map (orphaned) keeps `deps === null`. The test therefore checks the orphaned original entry
  (A1). The issue review verified in a scratch copy that such a test passes on `main` and fails with
  the guard removed while the other tests stay green. (The review counted an added test; this spec
  strengthens the existing one in place, so the file keeps 7 tests.)
- Per-route `rssMib` is a snapshot of process RSS right after that route's loop, not a delta (A3).
- The top-level fields keep their names and meaning, measured over the whole measured loop, so
  earlier outputs (pulse-status#56) stay comparable (A4).

## Required behavior

### Item 1: identity-guard test
In the test now named "identity guard: a finished build does not overwrite a newer entry"
(`src/answer-cache.test.ts` 114-136):
- Right after the `cachedAnswerFor(...)` call that starts the held build, and before
  `answers.set("k", newer)`, keep a reference `original = answers.get("k")` and assert it is
  defined and `original.deps === null`.
- After `held.resolve(...)` and `await pending`, assert:
  - `original.deps === null` (the replaced entry did not store the build's inputs; this is the
    assertion that fails without the guard),
  - `answers.get("k") === newer` (kept),
  - `newer.deps` is still the same array object it was created with (identity, `assert.equal`),
  - the existing assertions stay: `await pending` is `"older"`, the next lookup returns `"newer"`.
- Rename the test and/or add a comment so it says what the guard protects: a build whose entry was
  replaced in the map does not store its inputs on that entry, and the newer entry stays untouched.
- Use `assert` from `node:assert/strict` as the file does already; no new helpers or dependencies.

### Item 2: per-route measurements in `bench/conditional.ts`
- For each route in `ROUTES`, measure its own loop of `REQUESTS` conditional requests:
  - `cpuMs`: `process.cpuUsage(start)` user + system in microseconds over that route's loop,
    divided by 1000, `Math.round`.
  - `wallMs`: `performance.now()` difference over that route's loop, `Math.round`.
  - `rssMib`: `process.memoryUsage().rss / (1024 * 1024)` read right after that route's loop,
    `Math.round`. A snapshot, never a difference.
- `routes[path]` becomes `{ requests, cpuMs, wallMs, rssMib, share304 }`; `requests` and `share304`
  unchanged.
- Top level unchanged in names and meaning: `requests` (sum), `wallMs` and `cpuMs` measured over
  the whole measured loop (one window around all three route loops, as today, not the sum of the
  rounded per-route values), `rssMib` read after the last route's loop, `share304` from the summed
  counts.
- The per-route windows contain only that route's measured loop; the first plain request per route
  stays before every window, as today.
- Update the header comment (lines 1-6): the fields are reported per route and in total, per-route
  `rssMib` is a snapshot after that route's loop, and the first route (`/api/checks`) also carries
  JIT warm-up because the route order is fixed.
- Keep the output one JSON line on stdout.

## Performance impact
None expected for the metrics of `api/bench/budgets.json` (startup CPU, load CPU, idle/peak RSS,
test CPU, build CPU, wall-clock startup, p95 latency, requests per second, image size): the change
is in pulse-status only, in a test file and a hand-run bench script outside the served code and
outside the image (the Dockerfile/CI already reject test files in the image). Status test CPU may
grow by a few microseconds (three extra assertions). No A/B run is needed; the implementer pastes
one `bun bench/conditional.ts` output in the PR.

## Security impact
Security impact: no
Only a unit test and a local bench script change; no route, parser, auth, file write, log text,
dependency, Dockerfile or CI is touched.

## Rollout order
One repository: only pulse-status changes, and no other repository consumes its tests or bench.

## Counterexamples
- Guard mutation: replacing line 56 of `src/answer-cache.ts` with `entry.deps = built.deps;` must
  make the identity-guard test fail (`original.deps` becomes `[{ until: 10 }]` instead of `null`).
  A test that only checks `answers.get("k") === newer` or `newer.deps` would stay green: that is the
  current bug and is wrong.
- A test that takes `original` *after* `answers.set("k", newer)` gets `newer` and checks the wrong
  object: wrong.
- Per-route `rssMib` as `rssAfter - rssBefore` can be `0` or negative after GC: wrong; it must be the
  snapshot after the loop (always > 0).
- Per-route windows that include the warm-up plain request: wrong (the request is not counted in
  `requests` and would skew `cpuMs`/`wallMs`).
- Top-level `cpuMs` computed as the sum of the three rounded per-route `cpuMs`: wrong (rounding
  error up to 1.5 ms and a changed meaning); it stays one window over all route loops.
- Statistic definitions: window = the `REQUESTS` (300) measured requests of one route (per route) or
  of all routes (total); sample set = those requests only; no percentiles; rounding `Math.round`
  for `cpuMs`, `wallMs`, `rssMib`; `share304` = `notModified / requests` in percent with one
  decimal, rounded half up (existing `share`).

## Contract fields
No new names in the contract or config: the new keys `cpuMs`, `wallMs`, `rssMib` inside
`routes[path]` are bench output only and already exist at the top level of the same output.
`grep -rn 'rssMib\|cpuMs\|wallMs' .repos/contract/src .repos/config` returns no match.

## Repository: status
Files:
- `src/answer-cache.test.ts`
- `bench/conditional.ts`

Behavior change: no
Test and bench-script (dev tooling, not CI and not served) changes only; `src/` code is unchanged.

Tool facts (pulse-status `main` `b01a1ab`):
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` `scripts.check`);
  `lint` = `biome check . && pulse-eslint .`; `typecheck` runs `tsc` from `typescript7` (7.0.2)
  with `--noEmit` (`package.json` `scripts`). Bun 1.4.0 (`package.json` `packageManager`, `engines`).
- `tsconfig.json` line 3 `include: ["src", "test", "bench"]`, so `bench/conditional.ts` is
  typechecked.
- `biome.json` extends `@lorenzh/pulse-config/biome.json`; pinned config
  `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json` devDependency) has `files.includes`
  `"**"` minus dist, node_modules, bun.lock, html and test fixtures (lines 8-16), so `bench/` and
  `src/` are linted. The pinned file is identical to the config clone.
- CI `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…` (`.github/workflows/ci.yml`);
  that pinned workflow runs `bun run lint` (line 28), `bun run typecheck` (line 30) and
  `bun run test` (line 38), identical to the config clone. CI never runs the bench.
- `bunfig.toml` `[test]` has `coverage = true`, `coverageThreshold = { lines = 0.8 }`.

Checks and completion evidence (paste both in the PR):
1. `bun run check` is green.
2. Mutation: with line 56 of `src/answer-cache.ts` replaced by `entry.deps = built.deps;`,
   `bun test src/answer-cache.test.ts` reports exactly 1 failing test, the identity-guard test, and
   6 passing (counts written here: 7 `test(` calls in the file on `main` `b01a1ab`; the existing
   identity-guard test is strengthened in place, none added or removed). Then the mutation is
   reverted (`git diff --exit-code -- src/answer-cache.ts` empty) and the file passes with 7 of 7.
3. `bun bench/conditional.ts` prints one JSON line where `routes` has exactly the keys
   `/api/checks`, `/feed.atom`, `/badge/check-0.svg`; each has numeric `requests` equal to `300`,
   numeric `cpuMs`, `wallMs`, `share304` ≥ 0 and `rssMib` > 0; the top level has `requests` equal to
   `900` and numeric `wallMs`, `cpuMs`, `rssMib`, `share304`. (300 and 900 are literals from spec
   #480's fixed 300 requests per route over 3 routes.)
