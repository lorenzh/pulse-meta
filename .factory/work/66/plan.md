# Spec: SonarJS quality checks without a Sonar server (#66)

## Goal
Every pulse target repo (contract, probe, api, status, notify) runs the SonarJS recommended rules through ESLint inside `npm run lint`, limits cognitive complexity to 15, and enforces 80 % line coverage in `npm test`. No external service, no secrets.

## Scope
- Identical ESLint setup in all five repos; coverage gate; fixes or justified line-disables for existing findings; README and AGENTS.md updates.
- The meta repo changes nothing.

## Non-goals
- No change to Biome, its config or its version (2.6.3). No change to CI workflow steps. No `typescript` version change. No SonarQube/Cloud. No behaviour changes.

## Required behavior (shared interface, identical in every repo)
1. devDependencies, exact versions (no `^`), same in all five repos and lockfiles: `eslint`, `eslint-plugin-sonarjs`, `typescript-eslint` (parser needed for TS sources; latest at implementation time; check peer ranges and TypeScript 7 compatibility; fix only the parser side if it fails).
2. Byte-identical `eslint.config.js` in each repo (verified with `diff`):
   - files `**/*.ts`, `**/*.js`; ignores `dist`, `node_modules`, `public`, `coverage`.
   - TypeScript parser set as `languageOptions.parser`.
   - `sonarjs.configs.recommended` and `sonarjs/cognitive-complexity: ["error", 15]`.
   - No ESLint core rules, no other plugins, no formatting configs. `eslint --print-config` shows only `sonarjs/` rules. `linterOptions.reportUnusedDisableDirectives: "error"`.
   - Test files are linted too.
3. `package.json` scripts: `"lint": "biome check . && eslint ."`. `format` stays Biome-only. `check` is unchanged in shape.
4. `"test": "node --test --experimental-test-coverage --test-coverage-lines=80"` plus `--test-coverage-exclude` for test files (`**/*.test.ts`, `test/**`, `**/test/**`) and `dist/**`. Verify flag names on Node 24 and that excluded files do not appear in the report. The same flags in all repos (add repo-specific exclude globs only if a fixture or support file needs it, e.g. notify `test/support.ts`, contract `test/types.fixture.ts`).
5. Lefthook: each `lefthook.yml` runs Biome directly on staged files; add a second command running `npx --no-install eslint` on staged `*.{js,ts}` files (keep the Biome command unchanged).
6. Findings: fix small behaviour-neutral ones in code. A finding needing a behaviour change gets `// eslint-disable-next-line sonarjs/<rule> -- <reason>` on that line only. If coverage is under 80 % today, add small tests (no behaviour change).
7. README: one line stating the checks (Biome, SonarJS via ESLint with cognitive complexity ≤ 15, line coverage ≥ 80 %) and the commands `npm run lint` and `npm test`. Update the AGENTS.md Commands/hook text consistently.

## Risks
- `typescript-eslint` with TypeScript 7 (native) or Node type-stripping `.ts` files may need a parser tweak.
- contract has almost only types, so coverage may be empty or 0 lines; the gate must still pass and still be able to fail (add a small runtime test or record the situation in the PR).
- Overlap with Biome rules: acceptable because ESLint runs only SonarJS.
- Config drift across repos: guard with `diff`.

## Acceptance evidence (per repo, in the PR)
- `npm ci && npm run lint && npm test && npm run check` pass; CI green with unchanged workflow.
- Versions and `eslint.config.js` identical across repos (state versions and checksum).
- A temporary function with cognitive complexity 16 makes `npm run lint` fail; removing tests so coverage is under 80 % makes `npm test` fail (state the observed result).
- Report the coverage figure and list every line-level disable with its reason in the PR body.

The five sections are independent (no repo needs another's release); each uses the shared interface above.

## Repository: contract
Files: `package.json`, `package-lock.json`, `eslint.config.js`, `lefthook.yml`, `README.md`, `AGENTS.md`, possibly `test/`. `dist` committed and excluded from lint and coverage; do not rebuild it unless the build output changes. Handle the types-only `src/index.ts` per the risk above. Evidence: shared acceptance list.

## Repository: probe
Files: `package.json`, lockfile, `eslint.config.js`, `lefthook.yml`, `README.md`, `AGENTS.md`, fixes in `src/*.ts`, tests in `src/*.test.ts` if coverage is under 80 %. Evidence: shared acceptance list.

## Repository: api
Files: `package.json`, lockfile, `eslint.config.js`, `lefthook.yml`, `README.md`, `AGENTS.md`, fixes in `src/*.ts`, tests in `src/*.test.ts` if needed. Evidence: shared acceptance list.

## Repository: status
Files: `package.json`, lockfile, `eslint.config.js` (ignores `public`), `lefthook.yml`, `README.md`, `AGENTS.md`, fixes in `src/*.ts`, tests if needed. Evidence: shared acceptance list.

## Repository: notify
Files: `package.json`, lockfile, `eslint.config.js`, `lefthook.yml`, `README.md`, `AGENTS.md`, fixes in `src/*.ts`, tests in `test/` if needed; exclude `test/support.ts` from coverage. Evidence: shared acceptance list.
