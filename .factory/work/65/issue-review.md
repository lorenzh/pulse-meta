# Issue review: MIT licence in every package manifest (#65)

## Findings from the clones
- Targets: contract, probe, api, status, notify. Each has `LICENSE` ("MIT License", Lorenz Hilpert) and `README.md`.
- None of the five `package.json` files has a `"license"` field today.
- api, probe, status, notify are `"private": true`; contract is not.
- Each `package-lock.json` has a root `packages[""]` entry (name, version, dependencies) with no `license`. The `"license": "MIT OR Apache-2.0"` lines in the locks belong to third-party dependencies and must not change.
- No README mentions a licence now. README endings differ (prose, code blocks, a `## TLS checks` section), so "at the end" means appending a final line.
- The meta repo (this one) is not a target, and its `package.json` is out of scope.

## Open points (none blocking)
1. Lockfile: npm copies `license` into `packages[""]` of the lock when it regenerates it. Run `npm install --package-lock-only` (or add the line by hand) so the root entry gets `"license": "MIT"`. The diff must contain no other lock change, such as dependency or git-pin changes.
2. README line wording and link: use `## License` plus a line like `MIT, see [LICENSE](LICENSE).`, or a bare single line. The issue says "one line", so assume a single line with no heading: `Licensed under the MIT licence, see [LICENSE](LICENSE).` The link is relative so it works on GitHub.
3. Field position in `package.json`: not specified. Assume it goes after `version` or `private`, keeping the existing key order and formatting. Biome must pass on the file (lefthook pre-commit).
4. Five repos means five separate PRs or branches. Each CI must be green. The api, status and notify locks pin the contract by commit, and this change does not touch those pins.
5. contract has a `dist` directory. Check whether it is committed. If it is, it needs no change because the manifest is not built.

## Assumptions
- SPDX id `MIT` is used exactly, as in the issue.
- No `LICENSE` file changes; no code, dependency or other manifest changes.
- Trailing newline is kept in the README, with one blank line before the licence line.

## Acceptance check
In each of contract, probe, api, status, notify:
- `npm pkg get license` prints `"MIT"`.
- `git diff` of `package.json` is exactly one added `"license": "MIT"` line.
- `package-lock.json` differs only by `"license": "MIT"` in `packages[""]`, and `npm ci` still works.
- The last non-empty line of `README.md` names the MIT licence and links to `LICENSE`.
- `LICENSE` is unchanged.
- CI (lint, typecheck, tests) is green.
