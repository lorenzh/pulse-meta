# Spec: Move the website to Bun (#367)

## Goal
`lorenzh/pulse-website` uses Bun 1.4.0 as package manager, runtime and unit-test runner, like the other pulse repositories (#352). The built site stays the same static HTML.

## Scope
- Package manager and runtime for build, scripts and tests; `bun.lock`, `packageManager: bun@1.4.0`, `engines.bun: 1.4.0`.
- Unit tests on `bun:test`. Playwright is used as before, through its library API in `scripts/check-a11y.ts`.
- CI with `oven-sh/setup-bun` pinned by SHA.
- README and AGENTS.md name Bun instead of Node/npm.
- Meta: `docs/approved-packages.md` no longer lists the website as an exception (done in this spec PR).

## Non-goals
- No change to pages, content, styles, `budget.json`, `biome.json`, ESLint config or `tsconfig.json` strictness.
- No new runtime dependency. No Bun-specific APIs outside `bun:test`; `node:` built-ins stay.
- No change to the docs pinning model.

## Required behavior
- All scripts run with `bun` (`bun scripts/build.ts`, etc.); `check:site`, `check` and `check:all` chain `bun run`.
- `docs.config.json` SHAs are the only docs source; the build fetches only those; `scripts/bump-docs.ts` writes `docs.config.json` in the same format (key order, trailing newline).
- Build output is the same static HTML and assets.

## Risks
- Playwright under Bun (library API) may behave differently; verify in CI. If it fails, stop with `needs-input`, do not silently keep Node for it.
- Coverage under Bun counts only loaded files; the 80 % line gate must pass without new excludes.
- `bun test` discovers by pattern; it must run exactly the former `src/**/*.test.ts` and `scripts/**/*.test.ts` set (`test/` holds only fixtures; no `*.spec.ts` exists).
- Bun lockfile must carry the same dependency versions as `package-lock.json`, or output differs.
- The `check` job needs a pulse-config ref whose `check.yml` uses Bun (config `main` does).

## Acceptance evidence
1. `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun test` pass; same test count as before (or each removal explained).
2. `bun run build`, `check:links`, `check:budget`, `check:a11y` pass in CI job `site`.
3. `diff -r` of `dist/` from a Node build of the base commit and the Bun build, with the same docs SHAs, is empty or explained in the PR.
4. The PR reports build time before (Node) and after (Bun): same machine, several runs, with docs cached, plus a cold run; after is not worse (noise about ±10 % counts as equal).
5. No `npm`, `package-lock.json`, `setup-node` or Node-version mention remains in workflows, scripts, README or AGENTS.md.

## Repository: website
Files and behavior:
- `package.json`: add `packageManager: "bun@1.4.0"`; replace `engines.node` with `engines.bun: "1.4.0"`. Scripts: `bun scripts/*.ts`, `bun run` chaining, `"test": "bun test"`, `"typecheck": "bun node_modules/typescript7/bin/tsc --noEmit"` with `typescript7` as `npm:typescript@7.0.2` (as in probe/api; keep the exact pin), keep `lint`, `format`, `prepare`, `check`, `check:all`. Add `@types/bun` `1.4.0`; keep `@types/node` only if still needed for types. Move `@lorenzh/pulse-config` to a config SHA with the Bun `check.yml` (config `main` is `86896e9ff02e6458e431aa3417ee81d3b1cbc335`; probe pins `51e95b0eb463b27a196a33b428607bd92443e4f0`; use the one that passes `pulse-eslint` and `tsconfig` types). All other dependency versions unchanged.
- Delete `package-lock.json`; add `bun.lock` with the same versions. Check `.gitignore` and `.npmrc` still fit (`.npmrc` token for GitHub Packages stays if needed).
- `bunfig.toml`: `[test] coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, `coveragePathIgnorePatterns` for `**/*.test.ts`, `**/test/**`, `.build/**`, `dist/**`. Ensure `bun test` only runs the intended files (use `root`/paths if required) and does not touch `dist/` or `.build/`.
- The 19 test files: `node:test` to `bun:test` (`describe`, `it`/`test`, hooks, `mock`/`spyOn`, fake timers if used). `node:assert` may stay. Do not drop or weaken a test; tests keep using injected fake `fetch` and their own `mkdtemp` directory.
- `scripts/*.ts`, `src/build/*`: confirm they run under Bun (esbuild JS API, `renderToStaticMarkup`, TSX compiled by esbuild in `load-site.ts`/`assets.ts`, `import.meta` paths, child processes). Change only what Bun requires.
- `.github/workflows/ci.yml`: bump the `check` job's `pulse-config` workflow ref to the same config SHA as `package.json`; job `site`: replace `actions/setup-node` with `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`, `bun-version: 1.4.0`, `bun install --frozen-lockfile`, `bunx playwright install --with-deps chromium`, then `bun run build`, `check:links`, `check:budget`, `check:a11y`.
- `README.md`, `AGENTS.md`: Bun 1.4.0 instead of Node 24/npm/`node:test`; command table uses `bun install --frozen-lockfile`, `bun run ...`, `bun test <file>`, `bunx playwright install ...`. Keep the rule that built-ins use the `node:` prefix; update the TypeScript note that scripts no longer rely on Node type stripping (erasable-syntax rule may stay as a style rule if the lint config enforces it).
- Do not add `.factory/` or note files. The PR description carries the `dist/` diff result and the build-time table (method, runs, cold and cached).

Checks: `bun run check:all` locally plus the CI jobs `check` and `site`; `bun run docs:bump` leaves `docs.config.json` byte-identical when the pins are already `main` (or an offline test proves the same format).

Completion evidence: green CI on the PR; PR text with the `dist/` diff outcome and before/after build times; `Closes lorenzh/pulse-meta#<child>`.
