# Issue review: #208 Stricter shared TypeScript and ESLint config

Verdict: specifiable. No blocking question.

## Findings verified against the clones

- `config/tsconfig.base.json`: has `strict` but none of `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. Confirmed.
- `config/eslint.config.js`: parser plus sonarjs only, no `parserOptions.projectService`, no `@typescript-eslint/eslint-plugin`. Confirmed. Only `@typescript-eslint/parser` is a dependency.
- All five consumers' `lint` scripts call `node node_modules/@lorenzh/pulse-config/node_modules/eslint/bin/eslint.js`; `config/lefthook.yml` does too. Confirmed. (config's own lint uses `node_modules/eslint/...`, which is fine locally but should use the same stable entry.)
- `config/.github/workflows/check.yml`: no `timeout-minutes`, checkout `@v5` without `persist-credentials: false`. Confirmed.
- Docker-job checkout: api uses SHA `3d3c42e…` (v7.0.1) twice, notify uses the SHA, probe uses `@v4`, status uses `@v5`, contract has no Docker job. Confirmed.
- `config/src/index.test.ts` asserts only `name === "pulse-config"`. Confirmed.
- AGENTS.md "the pre-commit hook runs only Biome" appears at line 22 in all five code repos (notify words it slightly differently). Confirmed. The same text may exist in config's AGENTS.md (to check).
- Consumers' `tsconfig.json` extend the base and include `src` (+ `test`); status includes only `src` while it has `public/` plain JS. All five typecheck with `tsc` 7 (`typescript` ^7.0.2). Config's ESLint runs on `typescript` 6.0.3 nested, which is the cause of the nested path.

## Open points (for the plan)

1. **Order and pins.** Config must merge first; the five consumers then pin its merge commit SHA in `package.json`, the lockfile and the `uses:` line. The plan's `targets.json` needs config as the dependency of the other five. The SHA is not known when the spec is written, so the consumer tasks say "pin the merged config HEAD". Note a plan sees only config `main`.
2. **Stable ESLint entry.** Options: (a) a `bin` in pulse-config (e.g. `pulse-eslint`) that resolves and spawns its own ESLint, so `npm run lint` calls `pulse-eslint .`; (b) make `eslint` a peer or dev dependency of each consumer. The issue allows (a) or a hoisting-safe path. Recommended: (a), which also fixes lefthook (`npx --no-install pulse-eslint`). The bin must work when the consumer's `node_modules/.bin` links it, and under hoisting, pnpm and yarn.
3. **Type-aware linting needs a TypeScript.** `typescript-eslint` with `projectService` needs a `typescript` that the parser can load; config bundles TS 6.0.3 while consumers type check with TS 7 (`typescript` ^7.0.2, native `tsc`). TS 7 has no JS API, so typescript-eslint must keep using a TS 6 package. The plan must decide whether the type-aware rules read the consumer's `tsconfig.json` (`projectService` with `tsconfigRootDir`) and confirm TS 6 accepts the options in the shared base (`erasableSyntaxOnly`, `NodeNext`, new flags). It must also confirm that `@typescript-eslint/eslint-plugin` / `typescript-eslint` 8.72.1 supports ESLint 10.13.
4. **Files not in a tsconfig.** Type-aware rules fail on files outside the `include` (for example `eslint.config.js`, `status/public/*.js`, scripts, test fixtures). The plan must scope type-aware rules to `**/*.ts` covered by the project and leave the rest (JS) on the non-type-aware set. `test/` directories not in `include` (status) need handling.
5. **`exactOptionalPropertyTypes`.** Decision belongs to the plan: try it in all five consumers and report the error count. Issue allows enabling only if the cost is reasonable; if not, the spec says why. Assumption: it is enabled when the fixes are real type fixes and small, otherwise left off and documented in the config README/AGENTS. Contract types are shared via `contract`, so a change in contract optional properties could ripple to api, probe, status and notify; that reach must be estimated.
6. **Dependency across consumers.** Contract is a dependency of the others. If a contract type change is needed (e.g. `foo?: T | undefined`), downstream repos build on contract `main` only after its PR merges, which conflicts with each repo pinning the same config commit independently. Assumption: consumers bump their contract pin when needed, or fixes avoid changing contract's public types.
7. **Real-bug fixes.** New rules may show real bugs (floating promises, unchecked indexes). Each needs a test and a PR note. The spec must say how the child reports it ("Bugs found" section).
8. **Test in config.** The fixture-based test lints one failing fixture per new rule (floating promise, misused promise, non-exhaustive switch) and one for each tsconfig flag (tsc fails). It needs the ESLint API or the new bin and a fixture tsconfig; fixtures must be excluded from the repo's own lint and Biome (`.repos/**` style ignore) and from `tsc` of the package. The 80% coverage gate and `--test-coverage-exclude` must still pass.
9. **check.yml.** `timeout-minutes` value is not given. Assumption: 15. The Docker jobs in consumers also lack a timeout, outside scope unless the plan adds it. Pin `actions/checkout` to the v7.0.1 SHA `3d3c42e5aac5ba805825da76410c181273ba90b1` (the one api and notify use) in every consumer Docker job, and in `check.yml` (also set `persist-credentials: false` in the consumer Docker jobs only if they do not push; the issue requires it only for `check.yml`).
10. **compose-e2e** has to stay green; it lives in the service repos' CI. A new floating-promise fix must not change startup or shutdown ordering.
11. **AGENTS.md wording.** New text: "the pre-commit hook runs Biome and ESLint" in all five consumers; also check config's own AGENTS.md. Since the config contains a rule list statement ("never-switch and no-floating-promise" in AGENTS.md), the plan should check that the rules listed there match what ESLint enforces.
12. **Self-hosting config.** config's own `lint`/typecheck run with the new rules; `src/index.ts` and tests must pass them.
13. The issue refers to the pre-existing tracking issue #166; nothing is needed from it.

## Assumptions

- Meta repo only gets spec files; no target edits here.
- The `check.yml` timeout is 15 minutes.
- `noUncheckedIndexedAccess` and `noImplicitReturns` are enabled unconditionally; `exactOptionalPropertyTypes` per point 5.
- Stable entry is a pulse-config bin (point 2).
- Rule set: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, all `error`; further type-aware rules only if they find real defects at low cost.
- No blanket disables; a targeted disable has a one-line reason (the `reportUnusedDisableDirectives` setting stays).

## Derived acceptance check

In config, `npm run check` passes and the new test proves that each of the three rules and the two (or three) compiler flags fails on its fixture. After pins in contract, api, probe, status and notify, `npm run check` and CI pass in each; no consumer references `node_modules/@lorenzh/pulse-config/node_modules`; `grep -rn "actions/checkout" .github` shows the same SHA everywhere; `check.yml` has `timeout-minutes` and `persist-credentials: false`; AGENTS.md says the hook runs Biome and ESLint; `compose-e2e` is green.
