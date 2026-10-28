# Spec: CI workflow for every pulse repository

## Goal
Every pull request in contract, probe, api and status gets the same CI run, with separate Lint, Typecheck and Test steps, so a reviewer sees which step broke. Contract also fails on a stale `dist`.

## Scope
The four repositories each already have `.github/workflows/ci.yml` (only `npm run check`). Edit it in place (file name and workflow name `CI` stay), add a `lint` script with a linter, and add a README badge.

## Non-goals
- No secrets, no other package manager, no workflow in the meta repo.
- No change to the contract pin in probe/api/status, no mass rewrite of source code.
- No release, deploy or required-status-check configuration.

## Decisions (from issue review)
- Linter: **Biome** (`@biomejs/biome`, exact-compatible latest, devDependency, `biome.json`) in all four repos. Reason: no dependency on a TypeScript peer range, and the repos use TypeScript 7. Run as `biome lint .` via `"lint": "biome lint ."`. Lint only (no formatter enforcement); configure or disable rules so the current code passes, ignoring `dist`, `node_modules`, `public` build output if needed. Use the same Biome version and rule approach in all four repos. If Biome cannot be installed or run, stop and report rather than switching tool silently.
- Repositories are assumed public, so `npm ci` of the git dependency needs no token.
- Keep the job name `check`, runner `ubuntu-24.04`, `actions/checkout@v5`, `actions/setup-node@v6`.
- CI does not call `npm run check`. Keep the `check` script; add `lint` to it in probe/api/status (`npm run lint && npm run typecheck && npm run test`); in contract `npm run build && npm run lint && ...` is unchanged apart from lint.

## Required workflow shape (all four)
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - name: Install
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Typecheck
        run: npm run typecheck
      - name: Test
        run: npm test
```
Contract adds, after Install and before Lint, a step:
```yaml
      - name: Check dist is up to date
        run: |
          npm run build
          git diff --exit-code -- dist
          test -z "$(git status --porcelain -- dist)"
```
(Typecheck and Test then run on the committed or rebuilt tree; a stale dist already failed by name.) Each README gets, directly under the title:
`[![CI](https://github.com/lorenzh/pulse-<name>/actions/workflows/ci.yml/badge.svg)](https://github.com/lorenzh/pulse-<name>/actions/workflows/ci.yml)`

## Risks
- Biome rules flag existing code: tune `biome.json`, do not rewrite code.
- Lockfile must stay consistent: run `npm install --save-dev` with npm and commit `package-lock.json`; verify with `npm ci`.
- Private contract repo would break `npm ci` in the other three (assumed public).
- Cancel-in-progress also cancels older runs on `main`; accepted.
- Green/red runs on GitHub cannot be verified locally.

## Acceptance evidence
Locally per repo: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` exit 0; ci.yml parses and matches the shape; badge present. Contract: edit `src` without building, then the dist step exits non-zero; restore afterward. On GitHub: PR shows green CI with Lint/Typecheck/Test steps; contract PR with stale dist is red.

## Repository: contract
Files: `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `biome.json`, `README.md`.
Behavior: workflow as above plus the dist-freshness step; `lint` script; Biome ignores `dist`. `dist` stays committed and must match a fresh build after dependency changes (rebuild and commit if output differs).
Checks: all local commands above; simulate stale src and confirm the dist step fails.
Completion: PR with green CI; stale-dist demonstration noted in PR description.

## Repository: probe
Files: `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `biome.json`, `README.md`.
Behavior: workflow as above; `lint` script; `check` includes lint.
Checks: local commands above. Completion: PR with green CI and separate steps.

## Repository: api
Files: `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `biome.json`, `README.md`.
Behavior: as probe. Checks and completion as probe.

## Repository: status
Files: `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `biome.json`, `README.md`.
Behavior: as probe; Biome should cover `src` and `public` JS if present, without failing on existing code. Checks and completion as probe.
