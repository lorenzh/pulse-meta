# Spec: MIT licence in every package manifest (#65)

## Goal
Every pulse repository declares its MIT licence in `package.json`, so tools and registries show it without reading `LICENSE`. Each README ends with a one-line licence note.

## Scope
The repositories contract, probe, api, status, notify. In each: `package.json`, the root entry of `package-lock.json`, and `README.md`.

## Non-goals
- No change to `LICENSE` files, dependencies, code, the pinned contract commits, or any other manifest field.
- The meta repository is not changed.
- The committed `contract/dist` is not touched (the manifest is not built into it).

## Required behavior
1. `package.json` gets exactly one added line, `"license": "MIT"`, placed after `version` (after `private` where `private` follows it is fine; keep existing key order and formatting). Biome must pass.
2. `package-lock.json`: `packages[""]` gets `"license": "MIT"` and nothing else changes. Run `npm install --package-lock-only` and check the diff, or add the line by hand. If npm changes dependencies or git pins, revert those. The `MIT OR Apache-2.0` lines of third-party dependencies stay.
3. `README.md`: append a blank line and then a final line `Licensed under the MIT licence, see [LICENSE](LICENSE).` with no heading, keeping a trailing newline. This is also the last line in status, after its `## TLS checks` section.

## Risks
- npm regenerating the lock may alter other entries (git pins, formatting): check the diff.
- Lefthook/Biome formatting of `package.json`.
- The five changes are independent and need no ordering. The pins of contract in api, status and notify stay as they are.

## Acceptance evidence
In each repository:
- `npm pkg get license` prints `"MIT"`.
- `git diff` of `package.json` is one added line; the lock differs only by `"license": "MIT"` in `packages[""]`; `npm ci` works.
- The last non-empty line of `README.md` names MIT and links `LICENSE`.
- `LICENSE` is unchanged.
- `npm run check` (or the repo's lint, typecheck and tests) and CI are green.

## Repository: contract
Files: `package.json` (no `private` field; add after `version`), `package-lock.json`, `README.md` (ends with the "no settings and no run step" line). Do not touch `dist`. Checks: `npm run check`. Evidence: the acceptance list above.

## Repository: probe
Files: `package.json`, `package-lock.json`, `README.md` (ends with the TLS verification paragraph). Checks: the repo's lint, typecheck and tests (TLS tests need `openssl`). Evidence: as above.

## Repository: api
Files: `package.json`, `package-lock.json`, `README.md` (ends with the `@lorenzh/pulse-contract` paragraph). Checks: lint, typecheck, tests. Evidence: as above; the contract pin in the lock is unchanged.

## Repository: status
Files: `package.json`, `package-lock.json`, `README.md` (ends with the `## TLS checks` section). Checks: lint, typecheck, tests. Evidence: as above; the contract pin is unchanged.

## Repository: notify
Files: `package.json`, `package-lock.json`, `README.md` (ends with the Lefthook paragraph). Checks: lint, typecheck, tests. Evidence: as above; the contract pin is unchanged.
