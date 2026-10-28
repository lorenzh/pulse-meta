# Spec: Biome formatting/linting with a Lefthook pre-commit hook (#21)

## Goal
Every pulse target repo (contract, probe, api, status) formats and lints with Biome under one shared style, and a Lefthook pre-commit hook blocks badly formatted/linted staged files before a commit.

## Scope
Per repo: Biome and Lefthook devDependencies, identical `biome.json` and `lefthook.yml`, scripts `lint`, `format`, `prepare`, updated `check`, formatting/lint-only fixes to existing code, README and AGENTS.md docs, updated package-lock.json.

## Non-goals
Runtime changes, new runtime dependencies, bumping the pinned contract SHA, hooking typecheck/tests, unsafe autofixes, a shared config package, changing CI workflows (CI already runs `npm run check`), changes to the meta repo.

## Shared decisions (apply identically in all four repos)
- Biome 2.x, same exact version in all repos (caret per repo convention is acceptable only if lockfiles resolve the same version; prefer exact pin). Lefthook latest stable. Both in `devDependencies` only.
- `biome.json`: byte-identical in all repos. `$schema` matches installed Biome version. Biome `recommended` rules; formatter style chosen from existing code to minimise churn (check indent, quotes, line width first). Rules that would force behaviour changes (e.g. `noNonNullAssertion`, `noExplicitAny`) are turned off rather than rewriting code. Import organising must keep `import type` for type-only imports (Node 24 type stripping). VCS integration enabled with ignore file use. `files.includes` excludes `dist`, `node_modules` (harmless where absent, keeps file identical). Config must not need per-repo overrides.
- status `public/`: `public/client.js` is linted/formatted. `public/index.html` is excluded from Biome via a shared ignore only if Biome cannot format it cleanly; since the file must stay identical, decide by trying: if the chosen version formats HTML cleanly, include it; else add `!**/*.html` to the shared config (harmless in other repos).
- Scripts: `lint` = `biome check .` (read-only); `format` = `biome check --write .` (safe fixes only); `prepare` = guarded Lefthook install that never fails and does nothing when there is no git checkout or in CI (e.g. `lefthook install || true`, or a guard on `.git`/`CI`), because contract is installed as a git dependency by api/probe/status and `npm ci` runs in CI; `check` runs lint first.
- `lefthook.yml` byte-identical: pre-commit command runs `biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}` (read-only, no restaging), failing the commit on errors. Invoke via `npx`/local binary so it works without a global install.
- Lockfile: regenerated with `npm install`; must contain Linux optional deps for Biome and Lefthook so `npm ci` works on ubuntu CI.

## Required behavior
1. `npm install` in a fresh clone creates `.git/hooks/pre-commit` managed by Lefthook; `npm ci` without git/with CI exits 0.
2. `npm run lint` exits 0 on a clean tree and changes no files.
3. `npm run format` changes nothing on a clean tree and fixes a badly formatted file.
4. `npm run check` passes; lint runs first.
5. Committing a staged badly formatted file is rejected; a formatted one succeeds.
6. Existing code passes; src diff is formatting/lint only, tests unchanged and green.

## Risks
- `prepare` failing in the contract git-dependency install or CI (mitigated by the guard).
- Autofix of import ordering/`import type` breaking Node type stripping (verify via tests and typecheck).
- Config drift between repos (verify byte equality with `cmp`/checksum against contract's copy).
- Lockfile missing platform optional deps.
- Lint rules forcing behaviour changes (relax the rule instead).

## Acceptance evidence
Per repo, in the PR: output of `npm run check`, `npm run lint` followed by clean `git status`, proof of hook block (a commit of a badly formatted file rejected) and pass, `sha256sum biome.json lefthook.yml` equal across repos, `git diff` limited to formatting/lint in `src`/`test`/`public`, `package.json` diff showing devDependencies only. Tests are not added: this is a tooling-only change, verified by the checks above.

## Repository: contract
Files: `package.json`, `package-lock.json`, `biome.json`, `lefthook.yml`, `src/**`, `test/**`, `README.md`, `AGENTS.md`.
- `check` = `npm run lint && npm run build && npm run typecheck && npm run test`.
- `dist/` is excluded from Biome; `npm run build` leaves `dist/index.js` and `dist/index.d.ts` byte-identical to committed (no dist diff in the PR).
- This repo originates the canonical `biome.json`/`lefthook.yml` the others copy; other repos work in parallel from the spec above, and final byte equality is checked in review.
- Docs: README and AGENTS.md describe `npm run lint`, `npm run format`, and the pre-commit hook.
- Evidence: acceptance list above, plus unchanged `dist`.

## Repository: probe
Files: `package.json`, `package-lock.json`, `biome.json`, `lefthook.yml`, `src/**`, `README.md`, `AGENTS.md`.
- `check` = `npm run lint && npm run typecheck && npm run test`.
- Pinned contract SHA unchanged. `npm ci` must still pass, including installing contract from git.
- Docs as above. Evidence: acceptance list above.

## Repository: api
Files: `package.json`, `package-lock.json`, `biome.json`, `lefthook.yml`, `src/**`, `checks.example.json` (formatted if Biome covers JSON), `README.md`, `AGENTS.md`.
- `check` = `npm run lint && npm run typecheck && npm run test`.
- Pinned contract SHA unchanged; `checks.json` and `pulse.db*` remain gitignored and not linted.
- Docs as above. Evidence: acceptance list above.

## Repository: status
Files: `package.json`, `package-lock.json`, `biome.json`, `lefthook.yml`, `src/**`, `public/client.js`, `public/index.html` (per HTML decision above), `README.md`, `AGENTS.md`.
- `check` = `npm run lint && npm run typecheck && npm run test`.
- Formatting of `public/client.js` and any HTML changes must not alter served behaviour; tests green.
- Pinned contract SHA unchanged.
- Docs as above. Evidence: acceptance list above, plus statement of how `index.html` was handled.
