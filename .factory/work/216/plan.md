# Spec: pulse-config pre-commit hook must not lint test fixtures (#216)

## Goal
A commit that touches `test/fixtures/**` in `lorenzh/pulse-config` passes the pre-commit hook, and a real lint error in `src/` still fails it. The fixture exclusion is defined once and used by `npm run lint` and the hook.

## Scope
Only the `config` repository: its own local hook (`lefthook-local.yml`), its own lint script, one new repo-local ESLint config, one test, and docs.

## Non-goals
- No change to shipped files: `eslint.config.js`, `lefthook.yml`, `biome.json`, `bin/pulse-eslint.js` behavior. Consumers keep their pins.
- No change to Biome: `biome.json` already excludes `!**/test/fixtures`.
- No change to other repositories.

## Required behavior
- The local hook and `npm run lint` read the ESLint ignore patterns (`test/fixtures/**`, `.repos/**`) from one repo-local file, so they cannot drift.
- The hook runs on fixture-only changes without error (Biome and ESLint both pass).
- The hook still fails with an ESLint error on a staged `src/*.ts` file with a floating promise.

## Risks
- Adding the ignore to the shipped `eslint.config.js` would change every consumer. Avoid it.
- A root `eslint.config.*` would make `pulse-eslint` treat it as local config. The new file must have another name and be passed with `--config`.
- `projectService` uses `process.cwd()`; both callers run from the repo root, so it still works.
- The test must not touch the real git index (use `--file`) and must delete any temp file it creates.

## Acceptance evidence
1. `npx lefthook run pre-commit --file test/fixtures/floating-promise/src/index.ts --no-tty` exits 0.
2. `npx lefthook run pre-commit --file src/<temp file with an un-awaited promise> --no-tty` exits non-zero with `no-floating-promises`.
3. `npm run check` passes.
4. `git diff` shows no change to `eslint.config.js`, `lefthook.yml`, `biome.json`, `bin/pulse-eslint.js`; `npm pack --dry-run` lists no new file.

## Repository: config

Files:
- `eslint.local.config.js` (new, not in `package.json` `files`/`exports`): `import shared from "./eslint.config.js"; export default [...shared, { ignores: ["test/fixtures/**", ".repos/**"] }];` with a one-line comment that it is for this repository's own checks and never published.
- `package.json` `lint` script: `biome check . && node bin/pulse-eslint.js --config eslint.local.config.js .` (drop the two `--ignore-pattern` flags). Do not touch `files`/`exports`.
- `lefthook-local.yml`: eslint command becomes `node bin/pulse-eslint.js --config eslint.local.config.js --no-warn-ignored --no-error-on-unmatched-pattern {staged_files}`; add `glob: "*.{js,ts}"` to match the shipped hook. Do not override the `biome` command (it already skips fixtures through `biome.json`); verify that with the fixture test below.
- `src/hook.test.ts` (new, or a block in `src/index.test.ts`): run `node_modules/.bin/lefthook run pre-commit --file <path> --no-tty` from the repo root with `execFile`.
  - Fixture case: `test/fixtures/floating-promise/src/index.ts` exits 0.
  - Real error case: write a temp `src/hook-probe-<random>.ts` containing an un-awaited promise, run the hook on it, expect non-zero and `no-floating-promises` in the output, remove the file in `after`/`finally`. Check that `tsconfig.json` and `npm run check` are unaffected by the temp file when it is absent.
  - If lefthook cannot run in the test environment (no git repo), fall back to calling `bin/pulse-eslint.js --config eslint.local.config.js --no-warn-ignored` on the same files and document the lefthook command in `AGENTS.md`.
- `AGENTS.md` and `README.md`: state that `eslint.local.config.js` holds the repository's own ESLint ignores, used by `npm run lint` and the pre-commit hook, and is not shipped; document the proof commands above.

Checks: `npm run check` passes (coverage ≥ 80 %, `eslint.local.config.js` passes Biome and ESLint); acceptance items 1–4 above.

Completion evidence: PR `Closes lorenzh/pulse-meta#<child>` with the output of the two lefthook commands and `npm pack --dry-run`.
