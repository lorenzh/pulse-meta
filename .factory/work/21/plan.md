# Spec: Biome formatting/linting with a Lefthook pre-commit hook (#21)

## Goal
Every pulse target repo (contract, probe, api, status) formats and lints with Biome under one shared style, and a Lefthook pre-commit hook blocks badly formatted/linted staged files before a commit.

## Scope
Per repo: Biome and Lefthook devDependencies, identical `biome.json` and `lefthook.yml`, scripts `lint`, `format`, `prepare`, updated `check`, formatting/lint-only fixes to existing code, README and AGENTS.md docs, updated package-lock.json.

## Non-goals
Runtime changes, new runtime dependencies, bumping the pinned contract SHA, hooking typecheck/tests, unsafe autofixes, a shared config package, changing CI workflows (CI already runs `npm run check`), changes to the meta repo.

## Shared decisions (apply identically in all four repos; copy verbatim, do not re-decide)
Decided from inspecting the clones: all code uses double quotes, semicolons, 2-space indent, lines up to 100 columns, `import type`, ESM, `tsconfig` with `verbatimModuleSyntax`. Only the contract has a `dist`; only status has HTML (`public/index.html`).

- Versions (devDependencies only, exact pins, no caret): `@biomejs/biome` `2.6.3`, `lefthook` `2.2.2`. Install with `npm install --save-dev --save-exact @biomejs/biome@2.6.3 lefthook@2.2.2`. If the registry lacks either version, stop and report instead of picking another.
- `biome.json` (exact content, byte-identical, 2-space indent, trailing newline):

```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.3/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!**/dist", "!**/node_modules", "!**/package-lock.json", "!**/*.html"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "off"
      },
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  }
}
```

  If Biome 2.6.3 rejects a key (check with `npx biome check biome.json`), fix the key spelling per Biome's error message and make the same fix in all four repos; the executor reports the final text in the PR. Do not add per-repo overrides. Any other recommended rule that fires and would need a behaviour change is fixed by a formatting/lint-only change where possible; otherwise it is set `"off"` in this same file in all four repos and the PR says so.
- HTML decision (final): all `*.html` is excluded by `"!**/*.html"` above. `status/public/index.html` is neither formatted nor linted and stays unchanged. `public/client.js` is formatted and linted.
- `lefthook.yml` (exact content, byte-identical, trailing newline):

```yaml
pre-commit:
  commands:
    biome:
      glob: "*.{js,ts,json,jsonc}"
      run: npx --no-install biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}
```

- `package.json` scripts (exact strings):
  - `"lint": "biome check ."`
  - `"format": "biome check --write ."`
  - `"prepare": "lefthook install || true"` (never fails: when lefthook is not installed, as in a git-dependency install of the contract, or there is no `.git`, the `|| true` swallows the error)
  - `check` per repo section below, with `npm run lint` first.
- Lockfile: regenerate with `npm install`; it must include the Linux x64 optional deps of Biome and Lefthook so `npm ci` works on ubuntu-24.04 CI (verify with `npm ci` in a clean copy).

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
- Uses the `biome.json`/`lefthook.yml` text embedded above; every repo copies the same text, so no repo depends on another.
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
Files: `package.json`, `package-lock.json`, `biome.json`, `lefthook.yml`, `src/**`, `public/client.js`, `public/index.html` (excluded, unchanged), `README.md`, `AGENTS.md`.
- `check` = `npm run lint && npm run typecheck && npm run test`.
- Formatting of `public/client.js` and any HTML changes must not alter served behaviour; tests green.
- Pinned contract SHA unchanged.
- Docs as above. Evidence: acceptance list above, plus confirmation that `index.html` is untouched.
