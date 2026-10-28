# Issue review: #66 SonarJS quality checks without a Sonar server

Verdict: specifiable. No blocking question.

## Findings from the clones
- Targets: contract, probe, api, status, notify. This meta repo has no product code and is not a target.
- All five have identical `biome.json` (2.6.3), `lint` = `biome check .`, `test` = `node --test`, and a CI with `Lint` / `Typecheck` / `Test` steps. CI runs `npm run lint` and `npm run test`, so no CI change is needed.
- Sources are TypeScript (Node 24 type stripping, `typescript ^7.0.2`). Tests: `src/*.test.ts` (api, probe, status), `test/*.test.ts` (contract, notify). notify also has `test/support.ts`; contract has `test/types.fixture.ts`.
- contract: `src/index.ts` is types only and `dist` is committed (Biome already ignores it). Little or no executable code.
- status has `public/` (HTML, ignored by Biome).
- Each repo has an `AGENTS.md` whose Commands section lists lint/check; keep it consistent.

## Open points (non-blocking)
1. ESLint needs a TypeScript parser (`typescript-eslint`), which the issue does not list. Assumption: add `typescript-eslint` as a third exact-version devDependency, same in every repo. Check it works with TypeScript 7 (native). If not, only the parser needs a fix; do not change the `typescript` version.
2. "One shared configuration, identical in every repository": there is no shared package. Assumption: an identical `eslint.config.js` is committed in each repo (byte-identical, verified by diff). Only the SonarJS recommended rules are enabled (`sonarjs.configs.recommended`), plus `sonarjs/cognitive-complexity: ["error", 15]`. No ESLint core or other plugin rules. Set `linterOptions.reportUnusedDisableDirectives` consistently.
3. ESLint scope: lint `**/*.ts`, `**/*.js`; ignore `dist`, `node_modules`, and `public` inline HTML. Decide whether test files are linted for SonarJS (assumption: yes, with the same config, since "every pulse repository" and no exclusion is stated; if test noise needs line-disables, list them in the PR).
4. Some SonarJS recommended rules overlap Biome (e.g. unused variables, duplicate branches). That is fine as long as ESLint only runs the SonarJS rules; Biome stays the formatter. Do not add `eslint-config-prettier`-style configs.
5. `npm run lint` becomes `biome check . && eslint .`. `format` stays Biome-only. Lefthook hook (runs Biome on staged files) may stay unchanged; the issue says the hook "picks it up", so check each `lefthook.yml` runs `npm run lint` or add a SonarJS command if it runs Biome directly.
6. Coverage: `node --test --experimental-test-coverage --test-coverage-lines=80`, with `--test-coverage-exclude` for test files (`**/*.test.ts`, `test/**`) and `dist/**`. Verify the flag names in Node 24 (`--test-coverage-exclude`, `--test-coverage-lines`). Node's coverage glob handling and exclusion of test files by default differ; verify per repo.
7. contract has almost no runtime code. Coverage of a types-only file may report 0 lines or nothing; the 80 % threshold must still pass and still be able to fail. Decide per repo (may need a small runtime test or accept an empty report). If the threshold cannot be meaningfully evaluated, record it in the PR.
8. Existing coverage in each repo may be below 80 % today. Issue says nothing on adding tests; assumption: add small tests only as needed to reach 80 %, no behaviour change. Report the number per repo.
9. Findings policy: fix small, behaviour-neutral findings; otherwise per-line `// eslint-disable-next-line sonarjs/<rule> -- <reason>`; list these in each PR. Functions over complexity 15 that need refactoring more than trivially count as such findings.
10. Dependency version: pin the latest `eslint`, `eslint-plugin-sonarjs`, `typescript-eslint` at implementation time (exact, no `^`), check peer ranges (eslint 9 vs 10, Node >=24), and use the same versions in all five lockfiles.
11. Dependent repos use the contract via a git SHA; no contract release is needed for this change (devDependencies only).
12. Each README: one line naming the checks (Biome, SonarJS via ESLint, coverage ≥ 80 %) and the commands `npm run lint`, `npm test`. Update `AGENTS.md` commands too (assumption, small).
13. Delivery: one PR per target repo (five), since Factory works per repo. "CI green" must hold in each.

## Derived acceptance check (per target repo)
1. `npm ci && npm run lint && npm test` pass; `npm run check` passes.
2. `package.json` has `eslint`, `eslint-plugin-sonarjs` (and parser) with exact identical versions in all five; `eslint.config.js` is identical across the five (`diff`).
3. ESLint config enables only SonarJS rules (`eslint --print-config` shows no non-`sonarjs/` rules besides parser setup), cognitive-complexity 15.
4. Adding a function with cognitive complexity 16 makes `npm run lint` fail; Biome output unchanged; Biome config/version untouched.
5. Deleting tests so line coverage falls below 80 % makes `npm test` fail with the coverage threshold error; test files and `dist` do not appear in the coverage report.
6. CI workflow unchanged and green.
7. README has the one-line quality-checks statement; PR body lists every line-level disable with its reason and the coverage number.
