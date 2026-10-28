# Issue review: CI workflow for every pulse repository (#22)

## Current state (inspected in the clones)

- All four repos (contract, probe, api, status) already have `.github/workflows/ci.yml`: triggers `push: main` + `pull_request`, `ubuntu-24.04`, `actions/checkout@v5`, `actions/setup-node@v6` with Node 24, `npm ci`, then one step `npm run check`. No npm cache, no `permissions`, no `concurrency`, no badge in any README.
- #21 is done: every repo has `biome.json` (Biome 2.6.3), `lefthook.yml`, and scripts `lint` (`biome check .`) and `format`. Every repo has `typecheck` (`tsc --noEmit`) and `test` (`node --test`).
- `check` = lint, typecheck, test (contract: lint, **build**, typecheck, test).
- Contract: `dist/index.js` and `dist/index.d.ts` are committed; `build` is `tsc -p tsconfig.build.json`. Contract's `check` rebuilds `dist`, so it would hide a stale `dist` and must not be the only step.
- Earlier pipeline comments claimed no lint tool existed. That is outdated: Biome now exists. The spec must NOT add or change Biome, and must call `npm run lint`.

## Assumptions

- Workflow file stays `.github/workflows/ci.yml`, workflow `name: CI`, so the badge URL is `https://github.com/lorenzh/pulse-<repo>/actions/workflows/ci.yml/badge.svg`, linking to the workflow page.
- Repos are public (badge renders without auth). Otherwise the badge is broken but nothing else is affected.
- Existing runner (`ubuntu-24.04`) and action versions are kept.
- `npm run check` is replaced in CI by separate steps `npm run lint`, `npm run typecheck`, `npm run test` (named steps). Local `check` script stays unchanged.
- "Green run" for the done-when needs the code to already pass these steps; the implementer should run them locally.

## Open points (non-blocking)

- Caching: `actions/setup-node` with `cache: npm` (lockfile `package-lock.json` exists in all four repos).
- Concurrency: group `${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`. Caveat: this also cancels older runs on `main` pushes; acceptable, or limit cancellation to pull requests (`github.event_name == 'pull_request'`). Spec should pick one; the issue says "same branch", so the plain form is fine.
- Contract order: contract needs `build` before the dist check. Steps: lint, typecheck, test, build, dist check. Test must not depend on `dist` (verify).
- Dist check should catch modified, deleted and untracked files: `npm run build` then `git diff --exit-code -- dist` plus `test -z "$(git status --porcelain -- dist)"` (the second covers untracked, and subsumes the first). Failure message should say to run `npm run build` and commit.
- Line endings/determinism: build output must be reproducible on the runner (same TypeScript version via lockfile); verify that a fresh build on the current `main` produces no diff, otherwise the contract's CI would be red from the start.
- probe/api/status pin a contract commit via dependency; no cross-repo ordering is needed, so the four targets are independent.
- Badge placement: directly under the H1 title in each README.

## Derived acceptance check

For each of contract, probe, api, status:
1. `.github/workflows/ci.yml` triggers on `pull_request` and `push` to `main`.
2. Top-level `permissions: contents: read`; no secrets used.
3. `concurrency` with a per-ref group and `cancel-in-progress: true`.
4. Node 24 via `actions/setup-node` with `cache: npm`; `npm ci`.
5. Separate named steps running exactly `npm run lint`, `npm run typecheck`, `npm run test`; no `npm run check` in CI.
6. `biome.json`, Biome version, `package.json` lint/format scripts unchanged; no package manager other than npm.
7. README contains the CI status badge for that repo's workflow.

Contract only:
8. After the steps, a build step plus dist check fails when `dist` differs from a fresh build (modified, missing or untracked files); passes on current `main`.
9. Verification: change `src` without rebuilding `dist` gives a red run; rebuild gives green.

No blocking questions.
