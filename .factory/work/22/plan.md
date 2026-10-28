# Spec: CI workflow for every pulse repository (#22)

## Goal

Every pull request in contract, probe, api and status gets the same automated check, with separate lint, typecheck and test steps, so a reviewer sees which step broke.

## Current state (verified in the clones)

- Each repo already has `.github/workflows/ci.yml` (`name: CI`, triggers `push: main` and `pull_request`, `ubuntu-24.04`, `actions/checkout@v5`, `actions/setup-node@v6` with Node 24, `npm ci`, one step `npm run check`). No npm cache, `permissions`, `concurrency` or badge.
- #21 is done: each repo has `biome.json` (Biome 2.6.3), `lefthook.yml`, and scripts `lint` (`biome check .`), `format`, `typecheck` (`tsc --noEmit`), `test` (`node --test`), `check`.
- Contract commits `dist/` (`build` = `tsc -p tsconfig.build.json`); its `check` runs `build` and so hides a stale `dist`. Its `test/smoke.test.ts` already compares `dist` with a fresh build in a temp dir; `test` does not read `dist` directly otherwise.

## Scope

Edit `.github/workflows/ci.yml` and `README.md` in each of the four repos.

## Non-goals

- No change to Biome, `biome.json`, Lefthook, any `package.json` script or dependency, or the local `check` script.
- No secrets, no other package manager, no new workflow files, no change of runner or action versions.

## Required behavior (all four repos)

`ci.yml`, keeping `name: CI`, the triggers, `runs-on: ubuntu-24.04` and the action versions:

- top-level `permissions: contents: read`
- top-level `concurrency: group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`
- `actions/setup-node@v6` with `node-version: 24` and `cache: npm`
- steps in order, each with its own `name`: `npm ci`, then `npm run lint` (name "Lint"), `npm run typecheck` ("Typecheck"), `npm run test` ("Test"). No `npm run check` in CI.

README: directly under the H1 add
`[![CI](https://github.com/lorenzh/pulse-<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/lorenzh/pulse-<repo>/actions/workflows/ci.yml)`
with `<repo>` = contract, probe, api, status.

## Risks

- Repos must be public for the badge to render without auth (assumed). Nothing else depends on it.
- Concurrency also cancels older runs on `main` pushes; accepted (the issue says "same branch").
- Lint, typecheck and tests must pass on current code; run them locally before pushing. If one fails, fix only if trivial and in scope, otherwise report.

## Acceptance evidence

For each repo: the workflow file matches the behavior above (grep-able), `git diff` shows no change to `biome.json`, `package.json`, lockfile; the README has the badge; `npm ci && npm run lint && npm run typecheck && npm run test` pass locally. A PR shows a green CI run with separate Lint, Typecheck, Test steps.

## Repository: contract

Files: `.github/workflows/ci.yml`, `README.md`.

Everything under "Required behavior", plus after Test two more steps:

1. "Build" runs `npm run build`.
2. "Check dist is up to date" fails if `dist` differs from the fresh build, including modified, deleted and untracked files, e.g.:
   ```
   if [ -n "$(git status --porcelain -- dist)" ]; then
     echo "::error::dist is out of date. Run 'npm run build' and commit dist."
     git status --porcelain -- dist
     git diff -- dist
     exit 1
   fi
   ```

Checks: on current `main`, `npm run build` leaves `git status --porcelain -- dist` empty (otherwise CI would start red; report it). Simulate: change a type in `src` without rebuilding, run the dist step's script, expect exit 1; rebuild, expect exit 0. Revert the simulation.

Completion evidence: workflow content, local simulation output, badge in README. Done-when: a PR that changes `src` without rebuilding `dist` shows a red run at the dist step.

## Repository: probe

Files: `.github/workflows/ci.yml`, `README.md`. Required behavior only (no build or dist step). Evidence: local lint, typecheck, test pass.

## Repository: api

Files: `.github/workflows/ci.yml`, `README.md`. Required behavior only. Evidence: local lint, typecheck, test pass.

## Repository: status

Files: `.github/workflows/ci.yml`, `README.md`. Required behavior only. Evidence: local lint, typecheck, test pass.
