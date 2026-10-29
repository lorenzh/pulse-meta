# Issue review: #216 pulse-config pre-commit hook lints the invalid test fixtures

Single-target fix in `config` (lorenzh/pulse-config). No dependency on other targets; `targets.json` = one target `config`, `dependsOn: []`.

## Current state (inspected in `.repos/config`, main)
- `lefthook-local.yml`: only an `eslint` command, `node bin/pulse-eslint.js --no-warn-ignored --no-error-on-unmatched-pattern {staged_files}`. No glob, no fixture exclusion. It overrides the `eslint` command of the shipped `lefthook.yml` (which has `glob: "*.{js,ts}"` and `npx --no-install pulse-eslint ...`).
- `package.json` `lint`: `biome check . && node bin/pulse-eslint.js --ignore-pattern ".repos/**" --ignore-pattern "test/fixtures/**" .`. The exclusion is on the CLI only.
- `eslint.config.js` ignores only `dist`, `node_modules`, `public`, `coverage`. It is shipped to consumers, so adding `test/fixtures/**` there changes consumers.
- `biome.json` (shipped) already excludes `!**/test/fixtures` in `files.includes`. The biome hook comes from `lefthook.yml` and is not overridden locally.
- Fixtures: `test/fixtures/{clean,exact-optional,floating-promise,implicit-return,misused-promise,non-exhaustive-switch,unchecked-index}`. `src/index.test.ts` lints them (they are meant to fail ESLint).
- `AGENTS.md` / `README.md` say fixtures are excluded from Biome, ESLint, tsc and coverage.

## Open points (not blocking)
1. "One shared place": `package.json` scripts cannot be imported by lefthook. Options: (a) a repo-local ESLint config file (e.g. `eslint.local.config.js` or similar) that spreads the shared config and adds `ignores: ["test/fixtures/**", ".repos/**"]`, used by both `npm run lint` and the hook via `--config`; (b) a small script in `bin/` or `scripts/` holding the ignore patterns. It must NOT go into the shipped `eslint.config.js` or `bin/pulse-eslint.js` default (that would affect consumers). Plan chooses; (a) is preferred. Note `pulse-eslint` uses the shared config when there is no `eslint.config.*` and no `--config`, so a root `eslint.config.js` in this repo would be the shipped file itself; check how `pulse-eslint` resolves `--config` and that `projectService`/`tsconfigRootDir: process.cwd()` still work.
2. Files passed explicitly to ESLint that match an ignore pattern: `--no-warn-ignored` already suppresses the warning, so the ignore pattern makes the hook pass on fixture-only commits. With `{staged_files}` empty-after-ignore, `--no-error-on-unmatched-pattern` is needed (already present).
3. The local hook has no `glob`, so it also gets non-JS/TS files (e.g. `.md`, `.json`). Adding `glob: "*.{js,ts}"` like the shipped hook is a reasonable small fix but not required; the plan should decide.
4. Biome: `biome.json` already excludes fixtures; confirm with a test that `biome check --files-ignore-unknown=true <fixture file>` passes when passed explicitly. No change expected unless it fails. The `.repos/**` exclusion is also in `npm run lint` for ESLint; the hook should mirror it (clones are never staged, so low priority).
5. The proof needs lefthook run against staged files. `lefthook run pre-commit --file <path>` is the form in the issue; it does not need a real commit. A node:test in `src/` (or a documented command in AGENTS.md) can run it. A test must not touch the real git index; `--file` avoids that. Test runtime and coverage thresholds (`--test-coverage-lines=80`) must stay satisfied.

## Assumptions
- Fix is limited to the pre-commit hook config and its supporting files in `pulse-config`; the shipped `lefthook.yml`, `eslint.config.js`, `biome.json`, `bin/pulse-eslint.js` behavior stay unchanged. Consumers need no pin change.
- The `files` list in `package.json` must not need new entries (new local config is not published). Verify the new file is not added to `files`/`exports`.
- "Biome, if it would check them": it does not, so no Biome change.
- No decision needed from a person; no hold.

## Derived acceptance check
In `lorenzh/pulse-config` after the change:
1. `npx lefthook run pre-commit --file test/fixtures/floating-promise/src/index.ts --no-tty` exits 0 (ESLint and Biome do not fail on the fixture).
2. `npx lefthook run pre-commit --file src/<file with a deliberate lint error, e.g. an un-awaited promise>` exits non-zero with an ESLint error (in a test via a temp file that is removed, or a documented command).
3. The `test/fixtures/**` exclusion is defined once and used by both `npm run lint` and the hook; `npm run check` passes.
4. `git diff` shows no change to the shipped files (`eslint.config.js`, `lefthook.yml`, `biome.json`, `bin/pulse-eslint.js` default behavior), and `npm pack --dry-run` lists no new file.
