# Spec #81: Shared tooling configuration in pulse-config

## Goal
The tooling configuration (Biome, TypeScript base, SonarJS ESLint, Lefthook, CI) lives once in `pulse-config`. The five targets (contract, probe, api, status, notify) consume it through a Git dependency pinned to a commit of its `main`, and keep only what is specific to them.

## Scope
- `pulse-config` becomes the single source (the scaffold in `.repos/config` already has `biome.json`, `tsconfig.json`, `lefthook.yml`, `ci.yml`, `tools/sonarjs`; its content must be finished, see below).
- All five targets replace their copies with `extends` / `uses:` / a one-line ESLint entry.
- pulse-status adopts the four-repo Biome rules and removes non-null assertions (`!`) from `src/`.
- READMEs and the shared `AGENTS.md` text explain where the shared config lives and how a change reaches targets.

## Non-goals
- No npm publishing, no external service, no secrets; no Dependabot or pin automation.
- No change of Biome (2.6.3), lefthook (2.2.2), Node 24, or of any rule, limit or script name.
- Root TypeScript stays 7 in every target; no product code change except status's `!` removal.

## Step 0: TypeScript 6 isolation check (done during planning, result: works)
npm does not install devDependencies/workspaces of a Git dependency, so the ESLint toolchain must be `dependencies` of the pulse-config root package. Experiment (a throwaway consumer with `typescript ^7.0.2` in devDependencies, `.npmrc` `install-strategy=nested`, and a Git dependency on a package whose `dependencies` are `eslint 10.13.0`, `@typescript-eslint/parser 8.72.1`, `eslint-plugin-sonarjs 4.2.2`, `typescript 6.0.3`):
- Root `npx tsc -v` = 7.0.2; TS 6.0.3 is installed only under `node_modules/@lorenzh/pulse-config/node_modules/typescript`.
- `npm ci` from the lockfile works.
- A consumer `eslint.config.js` of `export { default } from "@lorenzh/pulse-config/eslint.config.js";` ran ESLint (invoked as `node node_modules/@lorenzh/pulse-config/node_modules/eslint/bin/eslint.js .`) with the shared rules; a cognitive complexity of 29 failed the 15 limit.
- (Tested with a local `git+file` URL; the config child repeats it against the real `github:` URL after the first push, see below.)
Stop condition: if the real GitHub URL install breaks root TS 7 or the linter, the config child holds with `needs-input` and describes the failure; the other children must not start.

## Required behavior (design)
**pulse-config package** (`@lorenzh/pulse-config`, no `private` blocking Git install; `exports`/`files` expose the files below):
- `biome.json` (base, four-repo version), `tsconfig.base.json` (compilerOptions only, **no `include`**), `eslint.config.js`, `lefthook.yml`, `.github/workflows/check.yml` (reusable).
- Root `dependencies` hold the lint toolchain: eslint, parser, eslint-plugin-sonarjs, typescript 6.0.3 (exact versions as today). The workspace `tools/sonarjs` goes away; the file `eslint.config.js` moves to the package root. pulse-config's own `devDependencies` keep Biome, lefthook, `@types/node` and typescript ^7. Because root dependency `typescript` 6 and devDependency TS 7 conflict inside pulse-config itself, the config child must resolve this (for example pulse-config's own typecheck uses `typescript@7` via an npm alias `typescript7`, or the toolchain stays in a nested `tools/sonarjs` package that a thin `postinstall` is not needed for). The chosen layout must keep: consumers get root TS 7 and nested TS 6, pulse-config's own `npm run check` passes, and `npx tsc -v` in pulse-config's own root is 7.x. This is the one design point the config child must verify and document.
- The shared ESLint config must not mention `.repos/`. It ignores `**/dist/**`, `**/node_modules/**`, `**/public/**`, `**/coverage/**`. Because `.repos/` is only in the Factory runner clone (inside `.target`), each target's lint must not scan it: ESLint flat config ignores are relative to cwd, and targets keep `.repos` out via a local entry in the target's own `eslint.config.js` only if the check shows ESLint reaches `.repos/`. A target's `eslint.config.js` is therefore: `import base from "@lorenzh/pulse-config/eslint.config.js"; export default [...base];` (extra ignores are added here if needed, never in the shared file). Check it in the runner layout (a `.repos/` directory with `.ts` files in the target root) and document the result.
- Biome base uses `noNonNullAssertion: error` with the `**/*.test.ts`, `**/test/**` override off (verbatim the current four-repo version).
- Lefthook base: `pre-commit` with `biome` and `eslint` commands. One shared ESLint command form for all: `node node_modules/@lorenzh/pulse-config/node_modules/eslint/bin/eslint.js --no-warn-ignored --no-error-on-unmatched-pattern {staged_files}` (targets pick up their root `eslint.config.js` automatically). It must check the same files as before.
- Reusable workflow `check.yml` (`on: workflow_call`) with the current steps (checkout, setup-node 24 with npm cache, `npm ci`, Lint, Typecheck, Test) plus a boolean input `build` (default false) that adds `Build` and `Check dist is up to date` (contract uses it). pulse-config's own `ci.yml` stays and either calls `./.github/workflows/check.yml` or keeps its local steps.
- `README.md` and `AGENTS.md` of pulse-config describe the files, the extends/uses entries per target, and the **pin update procedure**: merge the config change to `main`, then in each target bump the SHA in `package.json` (`github:lorenzh/pulse-config#<sha>`), refresh `package-lock.json`, and set the same SHA in the `uses:` ref of `.github/workflows/ci.yml` (two places that change together). The config child verifies (and documents) whether `job.workflow_sha` or similar can assert that both pins match; if not possible it is a documented manual rule.

**Targets** (each):
- `devDependencies`: `"@lorenzh/pulse-config": "github:lorenzh/pulse-config#<sha of merged main>"`; `.npmrc` with `install-strategy=nested` (notify and config already have it; add where missing). Remove the `tools/sonarjs` workspace, its `workspaces` entry, the `ts-api-utils` override (drop only if `npm ci` and `npm run check` still pass and `npx tsc -v` stays 7; otherwise keep and say why) and the local ESLint dependencies.
- `biome.json`: only `"extends": ["@lorenzh/pulse-config/biome.json"]` and nothing else unless target-specific. If Biome does not resolve a package path (or `files.includes`/`vcs.useIgnoreFile` do not behave relative to the target), use `"extends": ["./node_modules/@lorenzh/pulse-config/biome.json"]`. Verify `biome check` on a file with `any`, a `!` in `src/` (fails) and in `*.test.ts` (passes).
- `tsconfig.json`: `extends` the base, own `include` (`["src","test"]` for contract, probe, api, notify; status as today). contract's `tsconfig.build.json` stays local.
- `lefthook.yml`: `extends` the shared file; nothing else.
- `eslint.config.js` as above; `lint` script runs the nested ESLint binary against it.
- `.github/workflows/ci.yml`: `jobs.check.uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>` with the same triggers, permissions and concurrency.
- `package.json` script names unchanged (`check`, `lint`, ...). Coverage gate unchanged (80 lines and the same exclusions per target; contract keeps its extra `test/**` exclusion in its own script).
- README and `AGENTS.md`: a short shared paragraph (identical text in all five and in pulse-config): the shared config lives in `lorenzh/pulse-config`, targets use it through `extends`/`uses:`, a rule change is made there and reaches a target by updating the pin; the "never weaken biome.json, tsconfig.json or CI" rule now refers to the shared config.

## Risks
- Real GitHub Git dependency behaves differently from the local experiment (nested install, lockfile `resolved` SHA). Mitigation: config child tests it with the real URL; stop condition above.
- Biome/Lefthook `extends` path resolution into `node_modules`: verified per target, with the relative-path fallback.
- Two pins (package.json and `uses:`) drifting: documented, check if possible.
- A target PR cannot pass CI until the config PR is merged and its SHA exists on `main`: hence the dependency order; target children use the merged `main` SHA of pulse-config.
- Status `!` removal may change behavior; use narrowing or explicit errors, keep tests green.

## Acceptance evidence
1. In every target, `biome.json`, `tsconfig.json`, `lefthook.yml`, ESLint config and CI contain only extends/uses plus target-specific parts; the full files exist only in pulse-config.
2. Each target pins `github:lorenzh/pulse-config#<full sha on main>`; `npx tsc -v` is 7.x at each root; the linter resolves TS 6 only.
3. `npm ci && npm run check` passes in all six repositories; CI passes via the reusable workflow.
4. Equivalence checks: cognitive complexity 16 fails and 15 passes, `any` fails, `!` in `src/` fails, `!` in `*.test.ts` passes (including status with no `!` left in `src/`).
5. The shared ESLint config does not contain `.repos/`.
6. Mutation check: change the complexity limit in pulse-config, merge, update the pin in one target, and its `npm run lint` result changes; without the pin update it does not.
7. READMEs and `AGENTS.md` state where the config lives and how a change reaches targets.

## Repository: config
- Finish the content as in "Required behavior": move/restructure `tools/sonarjs` into root `dependencies` (or a layout verified to keep consumers on TS 7 and the linter on TS 6), add `tsconfig.base.json`, `eslint.config.js` without `.repos/**`, shared `lefthook.yml`, reusable `.github/workflows/check.yml` with the `build` input, `exports`/`files` in `package.json`, drop `private` if it blocks install.
- Self check: pulse-config runs its own `npm run check` (Biome, ESLint, typecheck with TS 7, tests at 80% lines) with its own files; its `tsconfig.json` extends the base.
- Repeat the isolation experiment against the real `github:lorenzh/pulse-config#<sha>` URL (push a branch commit) and note the result in the PR; hold with `needs-input` if it fails.
- README/AGENTS.md: shared text and pin update procedure.
- Done when: `npm ci && npm run check` passes, CI green, the PR is merged to `main`; the merged SHA is what the targets pin.

## Repository: contract
- Apply the target changes. `check` keeps `npm run build`; `tsconfig.build.json` stays; CI uses the reusable workflow with `build: true`; test script keeps its extra `test/**` exclusion; `include` `["src","test"]`. `dist` is unchanged and the dist check still passes.
- Done when: `npm ci && npm run check` passes, CI green, dist up to date.

## Repository: probe
- Apply the target changes; `include` `["src","test"]` as today; keep its `@lorenzh/pulse-contract` pin untouched. Done when `npm ci && npm run check` and CI pass.

## Repository: api
- Apply the target changes; keep `@lorenzh/pulse-contract` pin; lint script changes to the nested ESLint binary (was `eslint ...`). Done when `npm ci && npm run check` and CI pass.

## Repository: status
- Apply the target changes; `include` stays as today. Biome now takes the shared rules: remove local `noNonNullAssertion: "off"` and remove every non-null assertion in `src/` that Biome reports (not in tests). Keep `public/` and the HTML ignore behavior (the shared base ignores `**/*.html`, ESLint ignores `**/public/**`). Done when `npm ci && npm run check` and CI pass and `src/` has no `!` assertions.

## Repository: notify
- Apply the target changes; its lefthook and `.npmrc` are already close to the shared form. Done when `npm ci && npm run check` and CI pass.
