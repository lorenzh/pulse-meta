# Spec #208: Stricter shared TypeScript and ESLint config

## Goal
The shared tooling enforces what AGENTS.md claims: stricter compiler flags, type-aware ESLint rules, a stable ESLint entry that survives hoisting/pnpm/yarn, and a hardened shared workflow. Every consumer then adopts it with real fixes.

## Scope
`config` (pulse-config) changes first; `contract`, `api`, `probe`, `status`, `notify` pin the merged config commit and fix what the new rules show.

## Non-goals
- No behavior changes in services beyond real bugs a new rule reveals; each such bug gets a test and is named under "Bugs found" in the PR.
- No blanket disables. A targeted disable carries a one-line reason (`reportUnusedDisableDirectives` stays `error`).
- No Docker-job timeouts in consumers (not requested).

## Required behavior (decisions)
- `tsconfig.base.json`: add `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes` (all true).
  - `exactOptionalPropertyTypes` decision: on by default. A consumer whose fixes exceed about 20 errors or would need a public contract type change may set `"exactOptionalPropertyTypes": false` in its own `tsconfig.json` with a comment and a PR note giving the error count; config's AGENTS.md says so. Fixes must not change contract's public types; use `T | undefined` locally.
- ESLint: add `typescript-eslint` plugin (same 8.72.x as the parser, compatible with ESLint 10.13; verify). Type-aware rules at `error` for `**/*.ts` only: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`. Use `parserOptions.projectService` with `tsconfigRootDir` of the cwd. Type information needs a TypeScript JS API: typescript-eslint keeps using the bundled TS 6 (`typescript` 6.0.3) while `tsc` is TS 7. Verify TS 6 accepts every option of the base (`erasableSyntaxOnly`, `NodeNext`, new flags); if not, pick a compatible approach and document it. JS files (`eslint.config.js`, `status/public`, scripts) stay on the non-type-aware set. TS files outside a tsconfig `include` (for example status `test/`) must be added to the consumer's tsconfig include rather than ignored.
- Stable entry: pulse-config ships a bin `pulse-eslint` (listed in `files`) that resolves its own `eslint` via `import.meta.resolve`/`createRequire` and runs it with the passed arguments, defaulting to the shared config. Consumers' `lint` scripts call `pulse-eslint ...`; `lefthook.yml` uses `npx --no-install pulse-eslint`. No file may reference `node_modules/@lorenzh/pulse-config/node_modules`.
- `.github/workflows/check.yml`: `timeout-minutes: 15` on the job; checkout with `persist-credentials: false`; pin `actions/checkout` to the SHA `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) with a version comment.
- Real test replaces the placeholder.

## Risks
- TS 6/7 split can make type-aware linting disagree with `tsc`; verified in config's test.
- Consumer fixes to floating promises may touch startup/shutdown ordering; `compose-e2e` must stay green.
- Consumers cannot pin before config merges; hence the dependency.

## Acceptance evidence
- config: `npm run check` passes; the test shows each of the three rules and each of the three flags failing on its fixture.
- Each consumer: `npm run check` and CI pass; no reference to the nested ESLint path; `grep -rn "actions/checkout" .github` shows one SHA; AGENTS.md says the pre-commit hook runs Biome and ESLint; `compose-e2e` green (api, probe, status, notify).

## Repository: config
Files: `tsconfig.base.json`, `eslint.config.js`, new `bin/pulse-eslint.js`, `package.json` (deps, `bin`, `files`, `lint` script uses the bin), `lefthook.yml`, `.github/workflows/check.yml`, `src/index.test.ts` (replace) plus `test/fixtures/**`, `AGENTS.md`/`README.md`.
- Implement the decisions above. The test lints fixtures (via the bin or ESLint API) and expects a failure for floating promise, misused promise and non-exhaustive switch; it runs `tsc` on tiny fixtures and expects failure for each of the three flags and success on a clean fixture; it checks the bin runs from a consumer-like layout. Fixtures are excluded from the repo's own Biome, ESLint, `tsc` and coverage.
- Check the repo's own AGENTS.md for the pre-commit statement and for the rules list matching what is enforced.
- Own sources pass the new rules; 80% coverage gate still passes.
- Done: `npm run check` passes; PR notes the `exactOptionalPropertyTypes` measurement and the TS 6 findings.

## Repository: contract
Files: `package.json` and lockfile (pin merged config commit), `.github/workflows/*.yml` (`uses:` SHA of the reusable `check.yml`), `lint` script and any `lefthook.yml` use, `tsconfig.json` if needed, AGENTS.md line 22, source and tests.
- Pin the merged config HEAD in all places; fix every new type and lint error with real fixes; contract has no Docker job (pin checkout SHA wherever it is used directly).
- Done: `npm run check` and CI pass.

## Repository: api
Same as contract, plus pin `actions/checkout` to the shared SHA in every Docker job. Floating promises must keep startup/shutdown ordering. Done: `npm run check`, CI and `compose-e2e` pass.

## Repository: probe
Same as api (its Docker job currently uses `@v4`). Done: `npm run check`, CI and `compose-e2e` pass.

## Repository: status
Same as api (its Docker job currently uses `@v5`). Ensure `test/` TS files are type-checked and linted (add to tsconfig include); `public/` plain JS stays ignored. Done: `npm run check`, CI and `compose-e2e` pass.

## Repository: notify
Same as api (AGENTS.md wording differs slightly; correct it to Biome and ESLint). Done: `npm run check`, CI and `compose-e2e` pass.
