# Issue review: #352 Move every pulse project to Bun

Verdict: specifiable. No blocking question. Open points below go to the plan.

## Current state (inspected in `.repos/`)
- All seven repos: `engines.node >=24`, `package-lock.json`, `@types/node`, `node --test --experimental-test-coverage --test-coverage-lines=80` with three or four `--test-coverage-exclude` globs (`**/*.test.ts`, `test/**`, `**/test/**`, `dist/**`). Config's test script also restricts to `src/**/*.test.ts`.
- Start: `node src/main.ts` (probe, status, api), `node src/index.ts` (notify). Dockerfiles exist in api, status, probe, notify; api and status healthchecks use `node -e fetch(...)`.
- config: `bin/pulse-eslint.js` has a `#!/usr/bin/env node` shebang, uses `spawnSync` and `import.meta.resolve("eslint/package.json")`. Typecheck runs `node node_modules/typescript7/bin/tsc`. It has `tsconfig.base.json`, `lefthook.yml` and `lefthook-local.yml`.
- contract and kit commit `dist/`, built with `tsconfig.build.json` (tsc).
- api: `node:sqlite` `DatabaseSync` in `db.ts`, `service.ts`, `start.ts` and several tests. Migration code and its tests exist (`ALTER TABLE`, in `db.ts` and the `late`/`inactive` tests).
- Test mocking: `node:test` `mock` is used in probe `scheduler.test.ts`, api `service.inactive.test.ts` and `start.test.ts`. Few places, so the mapping is small.
- Meta: root `package.json` and `package-lock.json` exist (Factory CLI deps). `.factory/config.yaml` has no per-target test or install commands.

## Open points (decisions for the plan)
1. **Bun 1.4.0 and image tag.** The issue pins 1.4.0 and `oven/bun:1.4.0-alpine` "or the plan's choice". The plan must verify that the tag exists and record the digest. If 1.4.0 does not exist, stop and ask. Nothing contradicts it today. Alpine vs. debian-slim is the plan's choice. Alpine is the default (smaller, matches the current `node:24-alpine`).
2. **Pinning field.** Use `packageManager: "bun@1.4.0"` plus `engines.bun`. Replace `engines.node`. State one rule for all repos.
3. **Test mapping.** Plan a fixed mapping: `node:test` `describe/it/test` and hooks go to `bun:test`. `node:assert` can stay or become `expect`. Replacing it is a large mechanical change and risks weakened assertions, so prefer keeping `node:assert/strict` where semantics are identical, unless the plan has a reason. The issue says "the plan's mapping". Decide it explicitly. Differences to check: `assert.rejects`, `deepStrictEqual` vs `toEqual`/`toStrictEqual`, `t.mock`, `mock.timers` (Bun has `setSystemTime` and `jest.useFakeTimers`, which are limited), `t.after`, test options (`{ timeout }`, `concurrency`), and the test-runner file-name pattern.
4. **Coverage.** `bunfig.toml` `[test] coverageThreshold` is a single number or a per-metric object. Bun's `coverageThreshold` covers lines, functions and statements. Specify lines 0.8 only, and check that functions is not defaulted. `coveragePathIgnorePatterns` replaces the excludes. Verify that Bun counts only files loaded by tests, which differs from Node (Node reports all loaded files). It may change the percentage, so each repo needs a check that it still passes at 80 % with no excludes added beyond the current four. Coverage must be on by default (`coverage = true`) so `bun test` enforces the gate.
5. **Browser modules in status.** "Served exactly as today": a test or check should compare served bytes with `public/` files. Status serves them with `node:fs`. This must not go through bundling.
6. **contract/kit dist.** Choose `tsc` (keeps `.d.ts` and today's output) or `bun build` (no declarations). Default: keep `tsc` (declarations are needed). If config moves to `typescript7`, check that the dist output stays byte-identical or regenerate it once. The dist-matches-build test must build with the same tool and Bun version. Consumers on Bun must resolve the package `exports` unchanged.
7. **Git dependencies across repos.** Find how contract, kit and config are consumed (git dependency or GitHub Packages, tags). A lockfile switch to `bun.lock` changes how git and private-registry deps resolve (`.npmrc` is not fully honored by Bun; Bun reads `bunfig.toml` `[install.scopes]` or `.npmrc` for `@paragondata`). The plan must check that `bun install --frozen-lockfile` works with `GITHUB_PACKAGES_TOKEN` in `check.yml` and the Dockerfiles.
8. **Lefthook and `pulse-eslint`.** Change the shebang to `#!/usr/bin/env bun` (or leave `node`, which does not work in a Bun-only container). The bin spawns the ESLint bin, so the spawn must use `process.execPath`/`bun`. `typecheck` with `node …/tsc` becomes `bun …`. Lefthook hooks call `npm`/`npx` and must become `bun`/`bunx`.
9. **Shared tsconfig.** `@types/node` stays (Node-compatible APIs are kept) and `@types/bun` is added. Beware of conflicts between the `@types/bun` and `@types/node` versions. The `types` array in `tsconfig.base.json` must be updated and propagated to the downstream repos.
10. **Cross-repo ordering of config.** Targets consume config's `check.yml` and tsconfig from `main` or a ref. Until config merges, the downstream builds run against the old config. A `dependsOn` order is already given (config → contract, kit → probe, status, notify → api). `targets.json` must encode it. Plan: the actual `dependsOn` edges in `targets.json` (does kit depend on contract?).
11. **api migration removal.** List exactly which code and tests are removed (`late`, `active`/`inactive` columns, backfills, `addCheckColumn`) and which tests then become simpler rather than dropped. The "no test dropped" rule conflicts with deleting migration tests: the PR must list them as removed on purpose. Document in README/docs "no upgrade path for older database files". `bun:sqlite` differences: `db.exec`, `prepare().run/get/all` (named parameter prefixes, `lastInsertRowid`), the transaction API (`db.transaction()` vs manual `BEGIN`), and returned `Uint8Array`/`bigint` handling. "Transactions behave the same" needs an explicit mapping. `PRAGMA foreign_keys` (the plan keeps it explicit). Return type for `openDb` changes to `Database`.
12. **notify.** nodemailer under Bun with `node:tls` and `node:net` stub servers is the main risk (TLS stubs, self-signed certs, `STARTTLS`). If a stub test fails under Bun, the plan must decide: fix the test setup, never skip.
13. **compose-e2e.** api's `compose.e2e.yaml` builds the others from `main`; it can only pass once the other four merged (hence the order). The `compose.yaml` and images must be updated in every repo. Healthchecks may use `bun -e`. Check that the alpine image has `wget` or `curl` if compose uses them.
14. **CI.** `oven-sh/setup-bun` pinned by SHA (plan looks up the SHA), `bun-version: 1.4.0`, plus cache settings. Any workflow in each target that calls `actions/setup-node` or `npm` (not visible in the clones, which have no `.github`) is updated. The plan must check this in the target.
15. **Meta follow-ups.** The issue assigns the meta changes (README, `docs/approved-packages.md`: `@types/bun`, `oven-sh/setup-bun`; root `package.json`) to "a person after the merge". The spec should not include meta tasks in `targets.json`. The Factory CLI in meta runs on Node and is out of scope, so say so. Because `docs/approved-packages.md` gates runtime dependencies, `@types/bun` and `oven-sh/setup-bun` must be approved before the target PRs can pass review, so flag this to the person early.
16. **website.** Non-goal; no `targets.json` entry. It is cloned without a `package.json` today.
17. **Docs/AGENTS.md.** Every target's AGENTS.md and README command table uses `npm`; update them to `bun` (the issue requires this).

## Assumptions
- Bun 1.4.0 exists and supports everything listed (checked in plan).
- Services keep Node-compatible APIs; no `Bun.serve`.
- `@types/node` may stay as a dev dependency.
- Behavior of the HTTP APIs, healthchecks and the SQLite schema (current shape) stays the same.
- Coverage gate stays at 80 % lines, the same four excludes.

## Derived acceptance check
In each of config, contract, kit, probe, status, notify and api, on a fresh clone with Bun 1.4.0 only (no Node on PATH):
1. `bun install --frozen-lockfile` works; no `package-lock.json`, `bun.lock` is committed.
2. `bun run lint`, `bun run typecheck`, `bun run build` (where it exists) and `bun test` pass. Tests import from `bun:test`, no `node:test` import remains, and coverage ≥ 80 % lines is enforced by `bunfig.toml`.
3. `rg "node:test|node:sqlite|setup-node|npm ci|node:24"` finds nothing in the repo (docs included).
4. contract and kit: rebuilding gives no diff in `dist/`.
5. api: a new DB file gets the full schema with indexes; no migration code remains.
6. Docker images build from the pinned `oven/bun:1.4.0-<variant>@sha256:…`, containers start and the healthchecks pass.
7. api's `compose-e2e` is green against the Bun images of the other services.
8. The PRs list every test whose assertions changed and every removed migration test.
