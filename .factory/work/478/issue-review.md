# Issue review: #478 Small review leftovers (P3), round 7

Target: `status` only (both items). No contract, kit or config change. No product behavior change:
one test and one bench script, both outside the served code.

## Verified current state (`main` of pulse-status, `b01a1ab`)

### Item 1: identity guard in `src/answer-cache.ts`

- `cachedAnswerFor` (`src/answer-cache.ts` 45-66) creates `entry = { answer: settle(), deps: null }`,
  puts it in the map, and after the build resolves runs
  `if (answers.get(key) === entry) entry.deps = built.deps;` (line 56).
- `entry` is the closure's own entry. Without the guard the assignment still writes only that
  entry, never a newer entry that replaced it in the map. So the newer entry's deps can never be
  overwritten, with or without the guard. The issue's wording ("a concurrent rebuild that replaces
  the entry must not get its deps overwritten") does not describe an observable difference.
- The only observable effect of the guard: an entry that is no longer in the map (orphaned) keeps
  `deps === null` with the guard, and gets the build's deps without it.
- In production the guard cannot be false: `src/server.ts` only passes `ctx.answers` to
  `cachedAnswerFor` (line 474). Nothing else writes or deletes the map, and an in-flight entry
  (`deps === null`) is always joined (`isReusable`), never replaced. Only a caller that replaces the
  entry from outside (as the test does with `answers.set("k", newer)`) reaches it.
- The current test "identity guard: a finished build does not overwrite a newer entry"
  (`src/answer-cache.test.ts` 114-136) asserts only that `newer` stays in the map and is reused.
  Both hold without the guard. That is why the mutation stayed green.
- Checked in a scratch copy (Bun, outside the clone): adding a test that keeps a reference to the
  original entry (`answers.get("k")` right after the call, before `answers.set("k", newer)`),
  resolves the build, awaits it and asserts `original.deps === null` (and `newer.deps` unchanged by
  identity) passes on `main`. With line 56 replaced by `entry.deps = built.deps;` that test fails and
  the other 7 tests stay green.

### Item 2: per-route CPU, wall time and RSS in `bench/conditional.ts`

- `bench/conditional.ts` 115-127 measures `process.cpuUsage`, `performance.now()` and
  `process.memoryUsage().rss` once around the loop over all three routes. The output has `requests`,
  `wallMs`, `cpuMs`, `rssMib`, `share304` in total and `routes[path] = { requests, share304 }`.
- Spec #480 (`.factory/work/480/plan.md`, Performance impact) asked for "`requests`, `cpuMs`,
  `wallMs`, `rssMib` and `share304` per route and in total". The per-route `cpuMs`, `wallMs` and
  `rssMib` are missing.
- `bench/` is in `tsconfig.json` `include` and covered by `biome check .` and `pulse-eslint .`, so
  `bun run check` lints and typechecks it. It is not run by `bun test` or CI.
- `docs/development.md` mentions the bench only by purpose ("the cost and `304` share of conditional
  requests"), with no field list. No doc change is needed.

## Open points (none blocks the spec)

1. Item 1 cannot be tested through "a newer entry's deps get overwritten": that cannot happen. The
   spec must test the orphaned original entry instead (see A1).
2. Item 2 does not define per-route RSS. RSS is a process-wide value, and a delta per route can be
   negative and is noisy (see A3).
3. Whether the total `cpuMs`/`wallMs` stay measured over the whole loop or become the sum of the
   per-route values (see A4).
4. Route order is fixed (`/api/checks` first), so the first route carries JIT warm-up. Not in scope
   to change. The spec may say so in the header comment.

## Assumptions

- A1. The strengthened identity-guard test keeps a reference to the original entry before it is
  replaced, and after the build settles asserts that `original.deps` is still `null` and that the
  newer entry is still in the map with its own `deps` (same array). The existing assertions (the
  pending caller gets `"older"`, the next lookup reuses `"newer"`) stay. The test name and comment
  say what the guard protects: a build whose entry was replaced does not store its inputs. The
  guard in `src/answer-cache.ts` stays unchanged. Removing it as dead code is not asked for.
- A2. Test-only change for item 1: no change to `src/answer-cache.ts` or `src/server.ts`.
- A3. Per route: `cpuMs` = `process.cpuUsage` user+system over that route's measured loop, rounded
  to ms. `wallMs` = `performance.now()` difference over that loop, rounded. `rssMib` = process RSS
  read right after that route's loop, in MiB, rounded (a snapshot, not a delta). The first plain
  request per route stays outside every window, as today.
- A4. The top-level fields keep their names and meaning (`requests`, `wallMs`, `cpuMs`, `rssMib`,
  `share304` measured over the whole measured loop), so earlier outputs such as the ones in
  pulse-status#56 stay comparable. `routes[path]` gains `cpuMs`, `wallMs`, `rssMib` next to
  `requests` and `share304`. `share304` is unchanged (total from summed counts).
- A5. The header comment of `bench/conditional.ts` is updated to say that the fields are reported
  per route and in total. No README or `docs/` change.

## Derived acceptance check

In pulse-status on the PR branch, `bun run check` is green, and:

1. Replacing `if (answers.get(key) === entry) entry.deps = built.deps;` in `src/answer-cache.ts`
   with `entry.deps = built.deps;` makes `bun test src/answer-cache.test.ts` fail in the identity
   guard test, and the unmodified file passes (both runs pasted in the PR).
2. `bun bench/conditional.ts` prints one JSON line whose `routes` has, for each of `/api/checks`,
   `/feed.atom` and `/badge/check-0.svg`, the numeric fields `requests`, `cpuMs`, `wallMs`, `rssMib`
   and `share304`, and whose top level still has `requests`, `wallMs`, `cpuMs`, `rssMib` and
   `share304` (output pasted in the PR).
