# Issue review: #21 Biome + Lefthook

Verdict: specifiable. No blocking questions.

## Current state (inspected in .repos/*)
- contract, probe, api, status: ESM, Node >=24, TypeScript, `node --test`, no formatter/linter, no hooks, no `prepare` script.
- `check` today: contract = `build && typecheck && test`; others = `typecheck && test`.
- contract commits `dist/index.js` and `dist/index.d.ts` (.gitignore only ignores node_modules); `build` regenerates it.
- status has `public/client.js` and `public/index.html` (browser code, handwritten, committed).
- api/probe/status depend on contract via a pinned git SHA; CI runs `npm ci` then `npm run check`.
- Each repo has AGENTS.md listing commands (`npm run check`) – should be updated too, alongside README.
- The meta repo (this one) is not a target; it has no code to lint.

## Open points (non-blocking)
1. **Contract check order**: "lint before typecheck and tests" – proposed `npm run lint && npm run build && npm run typecheck && npm run test` for contract (lint first, build remains before typecheck as today).
2. **`prepare` in CI and as a git dependency**: api/probe/status install contract from GitHub, so npm runs contract's `prepare` in a context with no `.git`/hooks dir; also CI `npm ci` has no need for hooks. `prepare` must not fail there. Assume `lefthook install` is guarded (e.g. `lefthook install || true`, or skip when not in a git checkout/`CI` set). Verify `npm ci` in CI still passes. Note: that git dep only picks up the guarded prepare after the contract SHA is bumped; bumping the pin is out of scope unless contract's published content changes (it does not at runtime).
3. **"Same biome.json in each repo"**: no shared package exists, so each repo gets an identical copy. Assume identical file content incl. `$schema` pinned to the installed Biome version; exact Biome version pinned (same version in all four) to keep outputs identical. Per-repo differences (ignores) conflict with "identical": assume `dist` exclusion is put in the common file for all repos (harmless where absent) so files stay byte-identical.
4. **Style choices unspecified**: assume Biome defaults except what is needed for the existing code (e.g. indent, quote style, line width chosen to minimise churn; look at current code style first). Recommended rules: `recommended`; any rule that would force behaviour changes (e.g. non-null assertions, `noExplicitAny`) is disabled/relaxed rather than code rewritten.
5. **Type-only imports**: Node 24 type stripping needs `import type`/erasable syntax; Biome `useImportType`/organizeImports autofix must not break this (use `verbatimModuleSyntax`-compatible style). Check that `npm run format` autofixes keep `check` green.
6. **status `public/` and HTML**: assume Biome lints/formats `public/client.js` (browser JS); HTML formatting is not mature in Biome – assume `index.html` is excluded unless the chosen version formats it cleanly. Decide in plan.
7. **`lint` vs `format` semantics**: `lint` = `biome check` (read-only; formatting + lint + import sorting); `format` = `biome check --write` (safe fixes only, no `--unsafe`).
8. **Hook scope**: lefthook pre-commit runs `biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}`; read-only (no auto-fix/restage), blocks on error. `lefthook.yml` identical in all repos. Not hooking typecheck/tests.
9. **Tests for hook**: no unit test framework fits; acceptance is manual/scripted. Existing AGENTS.md says every change gets tests – assume N/A for tooling-only change, documented in the plan.
10. **Lockfiles**: each repo's package-lock.json updated; Lefthook has platform optional deps – make sure the lockfile includes Linux entries so `npm ci` works in CI (ubuntu-24.04).
11. **Delivery**: one PR per target repository (4 PRs); contract's committed `dist` must remain unchanged (build output identical).

## Assumptions
- Biome 2.x and Lefthook latest stable, exact-pinned or caret per repo convention (existing deps use caret).
- No runtime dependency changes; `dependencies` untouched.
- Hook install is local-only; CI continues to run `npm run check` (now including lint).

## Acceptance check (per target repo: contract, probe, api, status)
1. Fresh clone, `npm install` → `.git/hooks/pre-commit` exists (Lefthook-managed); `npm ci` in a no-git/CI context exits 0.
2. `npm run lint` exits 0 on a clean tree and modifies no files (`git status` clean after).
3. `npm run format` on a clean tree changes nothing; on a badly formatted file it fixes it.
4. `npm run check` exits 0 (contract: lint, build, typecheck, test; others: lint, typecheck, test), and lint runs first.
5. Staging a badly formatted `.ts` file and running `git commit` is rejected by the hook with non-zero exit; formatted file commits.
6. `biome.json` and `lefthook.yml` are byte-identical across the four repos.
7. `biome` and `lefthook` appear only in `devDependencies`; `dependencies` and `src` runtime behaviour unchanged; `git diff` of src shows formatting/lint-only changes; tests pass unchanged.
8. contract `dist/` is ignored by Biome and unchanged after `npm run build`.
9. README (and AGENTS.md) in each repo documents `npm run lint`, `npm run format`, and the pre-commit hook.
