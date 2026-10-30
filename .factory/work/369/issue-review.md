# Issue review: #369 Small review leftovers (P3), round 4

Verdict: specifiable. No blocking question. Open points and assumptions below.

## Scope notes
- 14 items over meta, contract, probe, api, status, notify, config. website is touched only by the design gating (#366 owns the implementation).
- Items that are not code in a target (cannot be built by Factory in a target PR):
  - api PR description inventory (api#47 is already merged/closed): spec should say "document the five removed tests in the api child PR body or as a comment on the original PR"; not an observable code check. Assumption: if the five tests/reasons cannot be recovered from api#47's history, the plan lists them from git history; otherwise skip and note it.
  - probe release note (breaking change, rename `{"env"}` variables to `PULSE_HEADER_*`): goes to the next probe release notes; plan puts it in the probe `docs/` changelog or PR body, whichever exists. Assumption: no release is cut by this feature.
- Process item: implement as a prompt rule in `.factory/prompts/*.md` (implement/review states): the PR body must carry the spec's acceptance evidence (checklists, mutation output, removed-test inventory), not only `Closes …`. Keep the outcome contracts (transitions, `needs-input`) intact; validate with `npx factory validate`.

## Open points and assumptions
1. Dev dependencies in `docs/approved-packages.md`: decision needed. Assumption: yes, list them in a new "Dev dependencies" table (the file already lists several dev-only entries such as playwright, axe-core, @types/bun, esbuild). Add `@biomejs/biome` 2.6.3, `lefthook` 2.2.2, `@types/node`, `typescript7` alias, `typescript` 7.0.2 (6.0.3 is already listed for config's ESLint), `@types/nodemailer` 8.0.2, `@types/react`/`@types/react-dom` 19.3.0. Exact `@types/node` version must be read from the targets (issue says `^26.6.5`, so pin the resolved version); `typescript7` becomes `npm:typescript@7.0.2`. The existing page states "runtime dependency"; the intro must say that dev dependencies are also listed and pinned.
2. Pinning: "pin exact versions" in seven (`@types/node`) and six (`typescript7`) repos means changes in `package.json` and lockfile in those targets (contract, probe, api, status, notify, kit, config, website – plan must check which). Needs the same version everywhere; the plan must check `.repos/*/package.json` for the real set. Risk: bump/pin of `typescript7` may change typecheck results; keep to the currently resolved version.
3. contract: two sub-fixes in `src/validate.ts`. (a) nested header references (records, unions) must reject inherited required fields (own-property check, e.g. `Object.create({env:"TOKEN"})`). (b) traversal must not read the input array's `map` property (use `Array.prototype.map.call` or an index loop) so a throwing enumerable `map` getter on `days` does not make `validateCheckUptime` throw. Constructed objects only. Needs regression tests. Also add an explicit ~30 s timeout to the "dist matches a fresh build of src" test. If `dist` is committed, it must be rebuilt.
4. notify: `docs/install.md` ~30 describe the `HEALTHCHECK` (read the Dockerfile for command/interval, verify the wording); `docs/configuration.md` ~28 document the three retry variables with the runtime wording `must be an integer >= 0` (verify against the source before writing).
5. status: add integration tests for hidden and shown responses of tcp/dns/domain via the real poller and server (poller.ts ~111-116); the tests must fail when the branches are removed (mutation check). `docs/operation.md` ~68: document that a shown domain check includes `warnDays`.
6. probe: (a) buffer eviction of the in-flight head (`src/buffer.ts`): track in-flight result separately and count its outcome once (delivered vs `buffer_full` drop), so a successful in-flight POST is not counted as a drop; tests for success and failure of the evicted in-flight item. (b) five tests that pass on old code: mark as compatibility tests or strengthen; assumption: strengthen where cheap, otherwise label with a `compat:` name prefix and a comment. Which of the two is a plan decision per test.
7. config: explicit per-test timeout (30 s) for the two type-aware ESLint tests in `src/`.
8. api: (a) `bench/load.ts` ~159 `rps` counts all three streams (POST /results, GET /checks, GET /uptime). (b) bench exercises `/latency` routes and SLO targets (`availabilityTarget`) in the fixed load and budgets; budget values are unspecified. Assumption: derive budgets from a measured run with margin, keep existing budgets unchanged. (c) `docs/rest-api.md`: `/probe/checks` omits `availabilityTarget` on purpose; document it. (d) operation docs: first SLO `/checks` read ~0.4 s, initial closed-day backfill ~1.7 s on 1 M results.
9. meta design: gate the three hover rules (`.pl a:hover` line 20, `.pl .nav a:hover` line 23, `.pl .toc a:hover` line 28) with `@media (hover:hover)` in `Docs.dc.html` and `DocsApi.dc.html` (check both files, line numbers differ). The website implementation belongs to #366; this feature fixes only the design copy and may add a note to #366. Assumption: no website code change here.
10. Dependencies: the api bench item (a/b) and status/probe items all build on current `main`; no feature in flight is required. Child targets run in parallel unless the spec adds `dependsOn` (pinning of `@types/node`/`typescript7` in many targets touches lockfiles; no cross-target dependency, but `contract` is consumed by others via Git SHA, so the contract fix is not needed by them).
11. Process/hygiene: each child PR body should carry the evidence (this is the very item #8 of the list): spec acceptance evidence, mutation output, inventory.

## Derived acceptance check
Done when, in each target, `bun test` and the repo checks pass and:
- meta: `docs/approved-packages.md` lists the dev dependencies with exact pins; the three hover rules in both design files sit inside `@media (hover:hover)`; `.factory` prompt rule exists and `npx factory validate` passes.
- All targets that pinned `@types/node`/`typescript7` have no `^`/`~` ranges for them.
- contract: `validate` rejects `headers: { Authorization: Object.create({env:"TOKEN"}) }`; a throwing `map` getter on `days` does not throw; timeout set.
- notify, status, api docs say what the code does (healthcheck, `>= 0`, `warnDays`, `availabilityTarget`, SLO timings).
- status: removing the tcp/dns/domain poller branches turns a new test red.
- probe: an evicted in-flight head whose POST succeeds is counted as delivered once, not as `buffer_full`.
- api: bench `rps` counts all three streams and the bench covers `/latency` and SLO targets.
- config: the two ESLint tests have a 30 s timeout.
