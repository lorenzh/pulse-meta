# Spec #352: Move every pulse project to Bun, tests on bun:test

## Goal
Bun 1.4.0 is runtime, package manager and test runner of config, contract, kit, probe, status, notify and api. Service behavior stays the same.

## Scope
The seven repositories below. **Non-goals:** pulse-website (follow-up after its first PR), `Bun.serve` rewrites, new features, the Factory CLI in pulse-meta (stays on Node). Meta changes (README, `docs/approved-packages.md` with `@types/bun` and `oven-sh/setup-bun`, root `package.json`) are done by a person after the merge and are not in `targets.json`. Please approve `@types/bun` and `oven-sh/setup-bun` in `docs/approved-packages.md` early, because target reviews check the list.

## Decisions (apply in every repository)
1. **Version pin.** Bun `1.4.0` exactly. `package.json`: `"packageManager": "bun@1.4.0"` and `"engines": {"bun": "1.4.0"}`; `engines.node` is removed. Before using it, verify the release and the Docker tag exist; if `1.4.0` does not exist, request `needs-input` and change nothing.
2. **Images.** `oven/bun:1.4.0-alpine`, pinned as `oven/bun:1.4.0-alpine@sha256:<digest>`. Look the digest up (`docker buildx imagetools inspect`); never invent it. Alpine matches today's `node:24-alpine`. Runtime stage runs as the image's `bun` user (replacing `node`), and the `/data` chown follows.
3. **Lockfile.** `bun.lock` committed, `package-lock.json` deleted. Scripts: `npm run` becomes `bun run`, `npm ci` becomes `bun install --frozen-lockfile`. `@paragondata`/GitHub-packages and git dependencies must resolve with `GITHUB_PACKAGES_TOKEN`; keep `.npmrc` or move the scope to `bunfig.toml [install.scopes]` as needed, and prove it with a frozen install.
4. **Test mapping.** Imports `describe`, `test`/`it`, hooks and `mock`/`spyOn`/`setSystemTime` come from `bun:test`. `node:assert/strict` **stays** where semantics are identical (no mass rewrite, so no weakened assertions); `assert.rejects` etc. keep working. Use `expect` only where a test needs a Bun feature. `t.mock` becomes `mock()`/`spyOn`/`mock.module`; `mock.timers` becomes `jest.useFakeTimers()` or `setSystemTime` (Bun 1.4 behavior must be checked per test). Test options such as `{ timeout }` move to the third argument. Test names and counts do not shrink. The PR description lists every test whose assertions changed, with the reason.
5. **Coverage.** `bunfig.toml`: `[test] coverage = true`, `coverageThreshold = { lines = 0.8 }` (no functions/statements gate), `coveragePathIgnorePatterns = ["**/*.test.ts", "test/**", "**/test/**", "dist/**"]` (the same four excludes; config's test only runs `src/**/*.test.ts`, keep via `bun test src`). Bun reports only files loaded by tests; if a repo falls below 80 %, add tests, never excludes or a lower threshold.
6. **Types.** `@types/bun` added (pinned to match 1.4.0) beside `@types/node` (kept, since Node-compatible APIs stay). Check that no type conflict arises.
7. **Scripts.** `start` is `bun src/main.ts` (notify `bun src/index.ts`), `typecheck` runs `tsc --noEmit` under Bun (`bun run`/`bunx`), `test` is `bun test`, `check` chains `bun run`. `rg "node:test|node:sqlite|setup-node|npm ci|npm run|node:24|npx"` finds nothing afterwards, docs included. Every README and AGENTS.md command table uses Bun.
8. **CI.** Each repo's workflows call config's `check.yml`; any workflow of its own that uses `actions/setup-node` or `npm` is converted to `oven-sh/setup-bun` (pinned by SHA, looked up, with a version comment) and `bun-version: 1.4.0`.

## Risks
- Digest/SHA lookups cannot be done offline: the implementer fetches them and records them in the PR.
- Bun coverage differs from Node's; fake timers differ; nodemailer TLS stubs under Bun; `bun:sqlite` API differences. Fix the code or test setup; never skip or drop a test.
- Downstream repos pin config/contract/kit by git SHA; each target bumps those pins to the merged commit of its dependencies (and rebuilds `bun.lock`).

## Acceptance evidence
On a fresh clone with only Bun 1.4.0 (no Node on PATH), in every repo: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run build` (where present) and `bun test` pass with the 80 % line gate enforced by `bunfig.toml`; no `node:test` import remains; dist is unchanged after rebuild (contract, kit); Docker images build from the digest-pinned Bun image, start and pass their healthchecks; api's `compose-e2e` is green; PRs list changed-assertion tests and removed tests.

## Repository: config
- `.github/workflows/check.yml`: replace `actions/setup-node` with `oven-sh/setup-bun` (SHA pinned, `bun-version: 1.4.0`), `bun install --frozen-lockfile`, then `bun run lint`, `bun run typecheck`, `bun run build` plus dist check when `inputs.build`, `bun run test`. `ci.yml` likewise.
- `bin/pulse-eslint.js`: shebang `#!/usr/bin/env bun`; spawn ESLint with `process.execPath` (Bun) and verify `import.meta.resolve("eslint/package.json")` works and consumers' `bunx pulse-eslint`/`bun run` find the bin. `src/**/*.test.ts` and `test/` move to `bun:test` (per decision 4); the `typecheck` script no longer calls `node …/tsc`.
- `tsconfig.base.json`: `"types": ["node", "bun"]`; `@types/bun` becomes a dependency consumers get (document in README how downstream repos satisfy it).
- `lefthook.yml`, `lefthook-local.yml`: `bun run`/`bunx` instead of `npm`/`npx`. `bunfig.toml`, `package.json` (pin, scripts, engines), `bun.lock`, README, AGENTS.md.
- Evidence: all checks above; lefthook hooks run under Bun; `pulse-eslint` lints a downstream-like layout.

## Repository: contract
- Config bump to the merged config commit; Bun pin, `bunfig.toml`, `bun.lock`, scripts, tests on `bun:test` (`test/client.test.ts` uses mocks: map per decision 4), workflows, README, AGENTS.md, docs.
- `dist/`: keep `tsc -p tsconfig.build.json` (declarations needed; consumers on Bun import `exports` unchanged). Rebuild under Bun and commit any diff once; the dist-matches-build test stays and uses the same build command.
- Evidence: `bun run build` leaves `git diff -- dist` empty; `bun test` passes at ≥ 80 % lines.

## Repository: kit
- Same as contract: config bump, Bun pin and files, tests on `bun:test` (`test/run-service.test.ts` uses mocks/timers), `dist/` built with `tsc` and committed, dist test stays, all `exports` subpaths unchanged, docs updated.
- Evidence: as contract.

## Repository: probe
- Bump config, contract and kit pins; Bun pin and files; `start` is `bun src/main.ts`; tests on `bun:test` (`scheduler.test.ts` mocks/timers; verify timer-driven tests stay exact); Dockerfile on `oven/bun:1.4.0-alpine@sha256:…` with `bun install --frozen-lockfile --production --ignore-scripts`, CMD `["bun","src/main.ts"]`; healthcheck unchanged in behavior (`bun -e` allowed); `compose.yaml` if present; docs.
- Evidence: checks plus image build and start.

## Repository: status
- Same as probe. Browser modules in `public/` are served as today through `node:fs`, no bundling; add or keep a test that the served bytes equal the `public/` files. `api-poll.test.ts` timers mapped. Dockerfile and healthcheck on Bun.
- Evidence: checks, image start, served bytes identical.

## Repository: notify
- Same as probe (entry `bun src/index.ts`). nodemailer stays; the SMTP stub tests (plain and TLS, `test/email-smtp.test.ts`) must pass under Bun without skips; if one fails fix the setup. `test/ledger.v2.test.ts` mocks mapped. Dockerfile on Bun.
- Evidence: checks including SMTP plain and TLS stubs green.

## Repository: api
- Everything from probe plus: `node:sqlite` `DatabaseSync` becomes `bun:sqlite` `Database` in `src/db.ts`, `service.ts`, `start.ts` and tests (`openDb` returns `Database`). Mapping: `exec`, `prepare().run/get/all`, explicit `PRAGMA foreign_keys = ON`, transactions keep their current semantics (explicit `BEGIN`/`COMMIT`/`ROLLBACK` or `db.transaction()` with identical rollback behavior; test it), check `lastInsertRowid`/bigint and named-parameter prefixes.
- Remove the migration code (`addCheckColumn`, `ALTER TABLE` columns such as `late`, `active`, backfills) in `src/db.ts` and its tests (including the migration parts of `service.inactive.test.ts`); create the current schema with all indexes in one step. A test covers a fresh database file getting the full schema. README/docs state: no upgrade path from older database files. The PR lists the tests removed on purpose; tests that only used migration setup are kept with direct schema setup. `start.test.ts` and `retention.test.ts` mocks mapped.
- Dockerfile on Bun image (data dir owned by the `bun` user); `compose.yaml`, `compose.e2e.yaml` (`e2e-target` uses the Bun image with `bun /e2e/target.mjs`) and `scripts/compose-e2e.sh` on Bun; build of the other services from `main` after their merge.
- Evidence: checks, image start with healthcheck, `compose-e2e` green.
