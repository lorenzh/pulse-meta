# Plan: Small review leftovers (P3), round 4 (#369)

## Goal
Close 14 review leftovers across meta and seven targets. Each is small and independent. No cross-target dependency: every child builds on `main`.

## Scope and non-goals
- In scope: the items in the issue. Meta itself changes in the spec PR's sibling work below (see "Meta changes"); those are done by hand-written files in this repo, not by a child.
- Non-goals: website implementation (#366 gates the hover rules there); cutting a release; changing any product behavior not named here.
- The api PR-description inventory (api#47) is text, not code: the api child recovers the five removed tests and reasons from git history of api#47 and posts them as a comment on api#47 (or in its own PR body). If they cannot be recovered, say so in the PR body.
- Every child PR body must carry the evidence this spec asks for (checklist of items, mutation output, inventory), not only `Closes …`.

## Decisions
- Dev dependencies ARE listed in `docs/approved-packages.md`, in a new "Dev dependencies" table, exact pins.
- Pin `@types/node` to `26.6.6` (website already uses it; implementer verifies it resolves and the typecheck passes, otherwise uses the version the lockfile resolves, the same in every repo). Pin `typescript7` to `npm:typescript@7.0.2`. Update `bun.lock` with `bun install`. Do not change any other version.

## Performance impact
Only the api child can move a metric. `bench/budgets.json` is unchanged for existing keys. Adding `/latency` and SLO routes to the fixed load may change load CPU, peak RSS, p95 latency and requests per second as reported numbers (rps now counts three streams, so it rises by definition). Startup CPU, idle RSS, image size, build CPU: none expected. Other repos: none expected (docs, tests, pins; probe buffer change is a counter fix). The implementer measures with `bun bench/run.ts --a main --b <branch>` and derives new budgets (for the new routes only) from a measured run with margin.

## Meta changes (already applied in this spec PR; no child)
- `docs/approved-packages.md`: intro says dev dependencies are listed and pinned. Add the table: `@biomejs/biome` 2.6.3, `lefthook` 2.2.2, `@types/node` 26.6.6, `typescript7` (`npm:typescript@7.0.2`), `typescript` 7.0.2 via the alias (6.0.3 stays in config as dependency), `@types/nodemailer` 8.0.2 (notify), `@types/react`/`@types/react-dom` 19.3.0 (website). Existing dev entries (playwright, axe-core, @types/bun, esbuild) stay. Each with licence, use, exact pin.
- `design/website/Docs.dc.html` and `DocsApi.dc.html`: wrap `.pl a:hover` (line 20), `.pl .nav a:hover` (23), `.pl .toc a:hover` (28) in `@media (hover:hover){…}`. Comment on #366 that its implementation must gate the same rules.
- `.factory/prompts/implement.md` (and `review.md`: reviewer checks it): rule that the PR body carries the spec's acceptance evidence (leftover checklist, mutation output, removed-test inventory). Keep transitions and `needs-input` contracts. Run `npx factory validate`.

## Repository: contract
- `src/validate.ts` ~119: nested header references (records, unions) check own properties only; `headers: { Authorization: Object.create({ env: "TOKEN" }) }` is rejected.
- `src/validate.ts` ~126: traversal must not read the input array's `map` property (use an index loop or `Array.prototype.map.call`); a throwing enumerable `map` getter on `days` must not make `validateCheckUptime` throw and gives the same result as on main.
- Test "dist matches a fresh build of src": explicit 30 s timeout.
- Pin `@types/node` exactly to 26.6.6 (`package.json`, lockfile). Rebuild committed `dist` if any.
- Evidence: regression tests for both cases (fail on old code); `bun test` and repo checks green.

## Repository: probe
- `src/buffer.ts` ~60-62, ~80-84: when full, eviction of the in-flight head: track the in-flight result separately from queued eviction and count its outcome once (delivered if the POST succeeds, drop only if it fails). Tests: evicted in-flight head succeeds -> delivered, no `buffer_full` drop, no false loss alert; fails -> counted once.
- The five tests that pass on old code (same-origin headers, 307 method/body, headers-free redirects, sentinel, `PULSE_HEADER_X` resolution): strengthen where cheap so they fail on old code, otherwise rename with a `compat:` prefix and a comment.
- Put the breaking-change note (rename `{"env"}` variables to `PULSE_HEADER_*`) in the docs changelog if one exists, else the PR body.
- Pin `@types/node` 26.6.6 and `typescript7` `npm:typescript@7.0.2`.
- Evidence: tests for the buffer; list of the five tests with their decision in the PR body.

## Repository: api
- `bench/load.ts` ~159: `rps` counts POST /results, GET /checks and GET /uptime.
- Bench exercises `/latency` routes and SLO targets (`availabilityTarget`) in the fixed load; add budgets for the new routes derived from a measured run; existing budgets unchanged.
- `docs/rest-api.md`: `/probe/checks` returns checks as written, except `availabilityTarget`, which is omitted on purpose.
- Operation docs: first SLO `/checks` read after start ~0.4 s, initial closed-day backfill ~1.7 s on 1 M results.
- Post the inventory of the five removed tests with reasons (from api#47 history) in the PR body.
- Pin `@types/node` and `typescript7` exactly.
- Evidence: bench A/B output and bench selftest in the PR body.

## Repository: status
- Integration tests for hidden and shown responses of tcp/dns/domain checks through the real poller and server (`src/poller.ts` ~111-116). Mutation check: removing those branches turns a test red; paste output in the PR body.
- `docs/operation.md` ~68: `warnDays` is never served, except for a shown domain check, which includes it.
- Pin `@types/node` and `typescript7` exactly.

## Repository: notify
- `docs/install.md` ~30: replace "no healthcheck" with a description of the Dockerfile `HEALTHCHECK` (read the command and interval from the Dockerfile).
- `docs/configuration.md` ~28: document `PULSE_NOTIFY_RETRY_ATTEMPTS`, `PULSE_NOTIFY_RETRY_DELAY_MS`, `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` together with the runtime wording `must be an integer >= 0` (verify against source).
- Pin `@types/node` and `typescript7` exactly.

## Repository: config
- The two type-aware ESLint tests in `src/`: explicit 30 s per-test timeout.
- Pin `@types/node` and `typescript7` exactly.

## Repository: kit
- Pin `@types/node` and `typescript7` exactly (`package.json`, lockfile). Nothing else.

## Acceptance evidence
- No `^`/`~` for `@types/node` and `typescript7` in contract (node only), probe, api, status, notify, config, kit.
- Each item above has a test or doc diff; PR bodies list them.
- `bun test` and repo checks pass in every target; `npx factory validate` passes in meta.
