# Spec: #885 contract: document every export in the API reference and check it

## Goal

Every public export of pulse-contract (`src/index.ts`) is named and described in
`docs/index.md`. A new test fails when a public export is not named there. The test runs in
`bun run check` and in CI. The change also covers the three subscription schemas of #823. #823
is already closed as superseded by this issue, so nothing has to be closed by hand.

## Evidence on the recorded base

- Contract clone at `96f33aaa85188c0794dedca89035f9c5500f85ee`, package version `2.5.2`
  (`package.json:3`). The working tree was clean.
- `src/index.ts:1-352` has only named re-export clauses of two forms:
  `export type { … } from "./x.ts";` and `export { …, type X, … } from "./x.ts";`. There is no
  `export *`, `export default`, local declaration or `as` alias in the file.
  `grep -nE '^export \*|export \{[^}]* as ' src/index.ts` printed nothing.
- These clauses name **316 distinct public names**: 195 values and 121 types. 8 of the types use
  the inline `type X` form in a value clause: `src/index.ts:63-65`, `:69-72` and `:351`. This spec run
  enumerated them with a Python probe that only reads files (`re` over `export (type )?{…} from`).
- **49 of the 316 do not occur in `docs/index.md` as a complete identifier.** Here a complete
  identifier is a match not preceded or followed by `[A-Za-z0-9_$]`. With plain substring search
  only 48 are missing, because `AdminConfigSummary` occurs inside `validateAdminConfigSummary`.
  The 49 names are the literal list in "Baseline missing names" below. They match the list in
  `.factory/work/885/issue-review.md`.
- `docs/index.md:10` says "Every type exported from `src/index.ts`." That claim is false today:
  12 exported types are missing from the reference.
- Some modules export schemas that `src/index.ts` does not re-export, for example
  `checkStatusSchema` at `src/schema.ts:97`. They are not public, and the inventory must not
  include them.
- No existing test reads `docs/index.md` (`grep -ln 'docs/index' test/*.ts` finds nothing). The
  runtime-key assertion at `test/smoke.test.ts:57` covers only runtime exports, not docs or types.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/885` returned
  HTTP 404, so this feature has no findings yet.

### Baseline missing names (literal, at `96f33aa`)

| Module | Missing public names |
| --- | --- |
| `admin.ts` | `AdminCheckSource`, `AdminConfigSummary`, `AdminExportRedaction`, `adminComponentSchema` |
| `audit.ts` | `auditEntrySchema`, `auditPageSchema` |
| `client.ts` | `FetchJsonError`, `FetchJsonOptions`, `FetchJsonResult`, `ManualIncidentReadOptions`, `RequestJsonOptions`, `RequestJsonResult` |
| `schema.ts` types | `ManualIncidentImpact`, `ManualIncidentStatus` |
| `schema.ts` schemas | `availabilityTargetSchema`, `checkLatencySchema`, `dnsCheckSchema`, `dnsRecordTypeSchema`, `domainCheckSchema`, `expectedStatusSchema`, `headerValueSchema`, `httpMethodSchema`, `internalManualIncidentSchema`, `jsonAssertSchema`, `latencyDaySchema`, `locationSchema`, `manualIncidentDraftInputSchema`, `manualIncidentDraftSchema`, `manualIncidentNoteInputSchema`, `manualIncidentNoteSchema`, `manualIncidentVisibilitySchema`, `sloSchema`, `tcpCheckSchema` |
| `schema.ts` constants | `MANUAL_INCIDENT_IMPACTS`, `MANUAL_INCIDENT_MAX_BODY_BYTES`, `MANUAL_INCIDENT_MAX_COMPONENTS`, `MANUAL_INCIDENT_MAX_UPDATES`, `MANUAL_INCIDENT_MESSAGE_MAX`, `MANUAL_INCIDENT_STATUSES`, `MANUAL_INCIDENT_TITLE_MAX` |
| `subscriptions.ts` | `subscriptionAnswerSchema`, `subscriptionRequestSchema`, `subscriptionTokenRequestSchema` |
| `tokens.ts` | `tokenCreateInputSchema`, `tokenMetadataSchema`, `tokenScopeSchema`, `tokenSecretResponseSchema`, `tokensResponseSchema` |
| `version.ts` | `WireVersionCheck` |

In total: 12 types, 30 schemas and 7 constants, 49 names.

## Scope

- `docs/index.md`: add an entry for each missing name, next to the related section.
- `test/docs-inventory.test.ts`: a new inventory test that `bun run check` runs through
  `bun test`.
- `README.md` (Development) and `AGENTS.md` (This repository): one or two sentences on the new
  rule ("every public export is named in `docs/index.md`; `test/docs-inventory.test.ts` checks
  it").

## Non-goals

- No change to `src/`, `dist/`, `package.json` (version included), `bun.lock`, `biome.json`,
  `tsconfig*.json`, `bunfig.toml`, `eslint.config.js`, `lefthook.yml`, `.github/` or any
  existing test file.
- No new public export, no rename, no wire-version change, no release bump. This is a docs-only
  patch, and consumers do not need a new pin.
- No documentation generator and no general scope framework. No fixture files on disk.
- The check enforces that each name appears. It does not judge the quality of the descriptions;
  review does that.
- Do not redo the features of contract#53, #54 and #56. They documented their own exports.

## Required behavior

### Documentation (`docs/index.md`)

For each of the 49 names, add a short, plain entry in the style of its neighbours:

- **Types** (`AdminCheckSource`, `AdminConfigSummary`, `AdminExportRedaction`,
  `ManualIncidentImpact`, `ManualIncidentStatus`, `WireVersionCheck`, `FetchJsonError`,
  `FetchJsonOptions`, `FetchJsonResult`, `RequestJsonOptions`, `RequestJsonResult`,
  `ManualIncidentReadOptions`): give the shape or the union.
  - The schema and admin types go into the "Type reference" table, so the claim at
    `docs/index.md:10` becomes true.
  - The client types go into "API client". Use the generic form where the type is generic
    (`FetchJsonResult<T>`, `FetchJsonOptions<T>`, `RequestJsonOptions<T>`,
    `RequestJsonResult<T>`). Take the shapes from `src/client.ts:10-40`, `:262-280` and `:386`.
  - `WireVersionCheck` goes into "Wire-format version" as the union `{ status: "ok" } |
    { status: "absent" } | { status: "mismatch"; error: string }` (`src/version.ts:10-13`).
- **Schemas** (30): name the type that each schema checks, or its value set, and a key limit
  where one applies. Link the shared rule instead of copying every validator rule.
  - `subscriptionTokenRequestSchema` bounds `token` to at most 128 characters, with error
    `must be at most 128 characters` (`src/subscriptions.ts:31,123-130`). The route-level token
    patterns (`SUBSCRIPTION_CONFIRM_TOKEN_PATTERN`, …) are a separate check; say so.
  - `subscriptionRequestSchema` accepts only a normalized address, with error
    `must be a normalized email address` (`src/subscriptions.ts:111-120`).
  - `subscriptionAnswerSchema` is the strict `{ status }` with a `SUBSCRIPTION_RESULTS` value
    (`src/subscriptions.ts:137-140`).
  - An error text quoted in the docs must be copied exactly from `src/` (or from an existing
    test). Do not invent error text. Do not say that a Zod schema never throws: only the
    `validate*` functions have that guarantee. `schema.parse` throws.
- **Constants** (7 `MANUAL_INCIDENT_*`): give the value and its meaning (`src/schema.ts:849-860`):
  `MANUAL_INCIDENT_TITLE_MAX` 200, `MANUAL_INCIDENT_MESSAGE_MAX` 2000,
  `MANUAL_INCIDENT_MAX_UPDATES` 100, `MANUAL_INCIDENT_MAX_COMPONENTS` 50,
  `MANUAL_INCIDENT_MAX_BODY_BYTES` 16384 (16 KiB), `MANUAL_INCIDENT_IMPACTS`
  `["none","minor","major","critical"]`, and `MANUAL_INCIDENT_STATUSES` as listed in the source.
  Name them in "Manual incidents" next to the limit sentence at `docs/index.md:271-274`.
- A bare list of identifiers does not meet the requirement. Each new name needs at least a
  short phrase that says what it is.

### Inventory test (`test/docs-inventory.test.ts`)

The test reads `src/index.ts` and `docs/index.md` with `readFileSync(new URL("../…",
import.meta.url))`, the pattern already used at `test/client.test.ts:404`. It finds the export
names from the source and asserts that `docs/index.md` names each one. It keeps no hand-kept
list of names and no fixed count.

1. **Export discovery.** Remove `/* … */` and `// …` comments from the source first. Then accept
   only statements of the form `export type { specifiers } from "<path>";` and
   `export { specifiers } from "<path>";`. Clauses may span several lines and end with a
   trailing comma. Each specifier is `Name` or `type Name`, where `Name` matches
   `[A-Za-z_$][A-Za-z0-9_$]*`. The public name is `Name`.
2. **Fail closed.** The test fails with a message that names the offending text when any of the
   following is left in the comment-free source:
   - an `export` token outside an accepted statement (`export *`, `export default`,
     `export const`, `export function`, `export type X =`, `export =`);
   - a specifier that does not have the form `Name` or `type Name`, such as `a as b` or
     `default`;
   - the same name exported twice.

   Supporting `as` aliases is not required. Rejecting them is the defined behavior.
3. **Cross-check against the runtime.** Every key of `await import("../src/index.ts")` (195
   keys on the base) must be in the discovered set. Do this with a small helper that returns the
   runtime keys missing from a discovered list. This catches a parser that skips value exports,
   and the runtime keys do not depend on the parser. Fixtures cover type-only names, which the
   runtime erases. A fixture case calls the helper with literal lists: runtime `["a", "b"]`
   against discovered `["a"]` returns `["b"]`.
4. **Matching.** A name counts as documented when `docs/index.md` contains it as a complete,
   case-sensitive identifier: a match not preceded or followed by `[A-Za-z0-9_$]`. Use the
   whole file, not only code spans. On the base, a code-span-only rule would wrongly report
   `StatusLockedField` (`docs/index.md:555-556`, a code span over a line break). This rule
   accepts `Validation<T>`, `fetchJson(url, options)`, `` `StatusLockedField`s `` and
   `MAX_MAINTENANCE_TIME` inside a longer span. It rejects `validateAdminConfigSummary` as
   evidence for `AdminConfigSummary`.
5. **Diagnostics.** On failure, list all missing names in source order, each once, so that one
   run shows the whole gap.
6. **Structure.** Keep the parse and match helpers in the test file. Do not export them and do
   not add them to `src/`. Keep each function at a SonarJS cognitive complexity of 15 or less
   (see the tool facts). Do not add a dependency. Use only `bun:test`, `node:assert/strict`,
   `node:fs` and string or RegExp built-ins.
7. **Fixture cases** in the same file, with literal inline strings (no files on disk) and literal
   expected results:
   - a type-only clause, a mixed clause with inline `type X`, and a multi-line clause with a
     trailing comma: the expected name lists are written out;
   - `/* export { Hidden } from "./h.ts"; */` and `// export { Gone } from "./g.ts";` add no
     names;
   - `export * from "./x.ts";`, `export { a as b } from "./x.ts";` and `export const z = 1;` each
     make the parse fail;
   - docs `validateAdminConfigSummary(raw)` with export `AdminConfigSummary` reports
     `["AdminConfigSummary"]` missing;
   - docs `` `Validation<T>` `` and `` `fetchJson(url, options)` `` cover `Validation` and
     `fetchJson`;
   - a synthetic source that adds `export { undocumentedExtra } from "./x.ts";` to an otherwise
     covered fixture reports `["undocumentedExtra"]`, and no expected list has to change;
   - a fixture where removing the one occurrence of a name from the docs makes it missing.

### README.md and AGENTS.md

- `README.md` "Development" (from `README.md:51`): add one sentence. `bun run test` (and so
  `bun run check`) includes `test/docs-inventory.test.ts`, which fails when an export of
  `src/index.ts` is not named in `docs/index.md`.
- `AGENTS.md` "This repository" (next to `AGENTS.md:111`): add one bullet. A new public export
  is named and described in `docs/index.md` in the same change, and
  `test/docs-inventory.test.ts` enforces it.

## Risks

- **A silent parser gap** gives a false green. Mitigations: fail-closed parsing (rule 2), the
  runtime cross-check (rule 3), and fixtures with literal expectations.
- **Prose matches.** Short type names such as `Check` or `Result` can match ordinary words in
  headings. On the base every such name already has a real entry. This is a known limit of
  whole-file matching, and review covers it. Do not narrow matching to code spans: see rule 4.
- **Wrong error texts** in the new entries. Copy them from `src/` and check each one quoted.
- **main moving.** If contract `main` advances past `96f33aa` before implementation, record the
  new `BASE`, re-enumerate the exports and the missing names, and document any new names too.
  The literal 49 list stays as the expected value only for `96f33aa`. For a newer base, the
  expected list is the one from an independent enumeration (a separate script or a manual
  listing), not from the new test.

## Performance impact

The `api` repository's `bench/budgets.json` lists two keys for contract: `test_cpu_s` (budget 9.0
s, floor 2) and `build_cpu_s` (budget 6.4 s).

- `test_cpu_s`: the change adds a small cost. It is one test file that reads two files (about 9 KB
  and 78 KB), runs a few regex passes over 316 names and does one `import` of
  `src/index.ts`, which other tests already load. Expected: under 0.1 s more CPU, within
  noise.
- `build_cpu_s`: none expected. The build covers only `src` (`tsconfig.build.json` `include`),
  which does not change.
- Consumer metrics (startup CPU, load CPU, idle and peak RSS, wall-clock startup, p95 latency,
  rps, image size of api, probe, status and notify): none expected. `src/` and `dist/` are
  byte-identical, and no consumer pin changes.

How to measure: run the full `bun run test` with the same Bun 1.4.0, the same lockfile install
and the same coverage settings. Measure process CPU (user plus system, including children, for
example with `/usr/bin/time -f '%U %S'`). Take five samples per revision, interleaved: base,
branch, base, branch, … (10 runs, none running at the same time). Report the raw samples, the
median per revision (the 3rd of the 5 sorted samples), the absolute delta in CPU seconds and the
delta in percent of the base median. Do not run the Docker bench (#834).

## Security impact

Security impact: no. The change touches only documentation and one test that reads two committed
files. It changes no validator, parser, client, dependency, Dockerfile or CI file, and it writes
no files.

## Rollout order

One repository: only `contract` changes. It is a docs-and-test patch with no change to `src/`,
`dist/` or the package version. Every consumer on any older contract pin (api, probe, status,
notify, console) keeps working unchanged, and none needs a pin bump.

## Counterexamples

The hard rules here are the inventory rules. Each case below must give the stated result, and a
wrong implementation would get it wrong.

| Case | Required result | What a wrong implementation does |
| --- | --- | --- |
| Docs name only `validateAdminConfigSummary`; export `AdminConfigSummary` | `AdminConfigSummary` missing | Substring search counts it as present (the baseline would then show 48 names, not 49). |
| `export { DEFAULT_MAX_BODY_BYTES, type FetchJsonError, fetchJson } from "./client.ts";` | names `DEFAULT_MAX_BODY_BYTES`, `FetchJsonError`, `fetchJson` | Dropping the `type`-prefixed specifier, or reading it as the name `type`. |
| `export type { A, B } from "./a.ts";` | names `A`, `B` | A runtime-only inventory (`Object.keys(import)`) cannot see them. On the base it would miss all 121 type names, 12 of which are undocumented. |
| Clause over several lines with a trailing comma | every name, no empty name | A split on `,` keeps `""` as a name. |
| `/* export { Hidden } from "./h.ts"; */` | no name `Hidden` | Parsing before comments are removed adds it. |
| `export * from "./x.ts";` | the test fails with "unsupported export" | Skipping it silently: names behind `*` are never checked. |
| `export { a as b } from "./x.ts";` | the test fails | Recording `a` (not public) or `a as b` as the name. |
| `checkStatusSchema` (exported by `src/schema.ts:97`, not by `src/index.ts`) | not in the inventory | Scanning every `src/*.ts` makes it a required name. |
| Docs `` `Validation<T>` `` or `fetchJson(url, options)` | `Validation`, `fetchJson` documented | Requiring an exact backtick span `` `Validation` `` reports documented names such as `Validation`, `fetchJson` and `MAX_MAINTENANCE_TIME` as missing (the issue review counted nine on the base). |
| Docs `` `StatusLockedField`s `` inside a code span that crosses a line break | documented | A code-span-only matcher reports it missing. A single-line span parser gave 50 instead of 49 on the base, and a multi-line one mis-pairs backticks around the fenced blocks. |
| Base `96f33aa`, unchanged docs | fails with exactly the 49 names of the baseline table | Any other count shows a parser or matcher bug. |

There are no statistics in this change.

## Contract fields

No new names: no new export, field, key, route or constant. The only new file name is
`test/docs-inventory.test.ts`. It does not collide with anything:
`grep -rn 'docs-inventory\|docsInventory' .repos/contract/src .repos/contract/test .repos/config`
printed nothing, and `ls .repos/contract/test` shows no file of that name.

## Repository: contract

Files:
- `docs/index.md` (changed)
- `test/docs-inventory.test.ts` (new)
- `README.md` (changed)
- `AGENTS.md` (changed)

Behavior change: no. The change is docs plus one new test file only. `src/`, `dist/`, the
package metadata and the tooling config do not change.

### Tool facts (cited)

- Bun 1.4.0: `package.json:7` (`packageManager`), `package.json:9` (`engines`), and the pinned
  CI `check.yml:24`.
- `bun run check` = `bun run lint && bun run build && bun run typecheck && bun run test`
  (`package.json:28`). `test` is `bun test` (`package.json:24`), so a new `test/*.test.ts` runs
  in `check` without a script change. `build` uses TypeScript 7 (`package.json:22`, `:36`).
- Typecheck covers the new test: `tsconfig.json:3` includes `test`, and it extends the pinned
  `tsconfig.base.json:8-14` (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`). The build includes
  only `src` (`tsconfig.build.json` `include: ["src"]`, `rootDir: "src"`), so `dist/` is not
  affected.
- Coverage: `bunfig.toml:2-4` sets coverage on, a line threshold of 0.8, and ignores `test/**`,
  so the new file does not change the coverage denominator.
- Biome: `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At pin
  `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:32`, `ci.yml:17`) its
  `files.includes` (`:10-17`) lints `**` except `dist`, `node_modules`, `bun.lock`, `*.html` and
  `**/test/fixtures`. The new test file is linted. Fixtures under `test/fixtures` would not be,
  which is one more reason to keep fixtures inline. `noExplicitAny` is `error` (`:49`).
- ESLint: `eslint.config.js:3` spreads the pinned `eslint.config.js`. At the pin, `:16` sets
  `sonarjs/cognitive-complexity` to 15 and `:27-48` sets the `no-floating-promises` rule, with
  `bun:test` `test` and `describe` allowed.
- Pre-commit: `lefthook.yml:1-2` extends the pinned `lefthook.yml:1-8`, which runs Biome and
  ESLint on staged files.
- CI: `.github/workflows/ci.yml:16-19` calls the pinned `check.yml` with `build: true`. Its steps
  (`:25-38`) are: install `--frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run build`, `git diff --exit-code -- dist`, `bun run test`.
- The pinned files above (`biome.json`, `tsconfig.base.json`, `eslint.config.js`,
  `lefthook.yml`, `.github/workflows/check.yml`) were read with
  `gh api …/contents/<path>?ref=51e95b0…`. They are identical to the config clone (`main` at
  `bc87049`).

### Steps

1. Record `BASE=<full SHA of contract main>` before any edit. Install with
   `bun install --frozen-lockfile`. Run `bun run check` on the unchanged base and record the
   result. This is the baseline control. If it fails on the base, record the failing step and
   stop: do not hide it in this change.
2. Enumerate the public exports of `BASE` independently of the new test. Use a one-off script
   outside the repository, or a manual listing of `src/index.ts`. Record the count and the
   missing names. At `96f33aa` the expected values are literally 316 and the 49-name table
   above.
3. Write `test/docs-inventory.test.ts` (red). Run it alone three times against the unchanged
   `docs/index.md` of `BASE`: `bun test test/docs-inventory.test.ts`, three runs. Each run must
   fail only on the inventory assertion, and the reported missing set must equal the
   independent list of step 2. It must include `subscriptionRequestSchema`,
   `subscriptionTokenRequestSchema`, `subscriptionAnswerSchema` and the 12 type names. All
   fixture cases must pass in these runs: only the real-inventory assertion fails.
4. Document the missing names in `docs/index.md` (green), then update `README.md` and
   `AGENTS.md`.
5. Run `bun test test/docs-inventory.test.ts` and `bun run check`. Both pass.
6. Commit with a Conventional Commit subject (for example
   `docs: document every public export and check the inventory`).

### Acceptance

Where each expected value comes from is stated in brackets.

1. **Baseline control.** `bun run check` on `BASE` with lockfile-installed dependencies: the
   result is recorded, and it passes on `96f33aa`. [The command's exit status on the base. If it
   does not pass there, record the failure and do not claim it as a control.]
2. **Regression.** `bun test test/docs-inventory.test.ts` with the new test on `BASE` docs fails
   3 out of 3 runs. The missing names it reports equal the 49 names of the baseline table.
   [Literal list in this spec, from an enumeration independent of the test.] Run this in an
   isolated writable checkout of the implementation repository, never in `.repos/`. Copy in only
   the new test file. A missing file, missing `node_modules` or a different failing assertion is
   not regression evidence.
3. **Fixtures.** Every fixture case of "Inventory test" item 7 passes, with literal expected
   name lists and literal expected failures. [Literals written in the test, not computed by the
   parser.]
4. **Runtime cross-check.** The assertion that every key of `import("../src/index.ts")` is
   discovered passes on the final commit. Its literal fixture (runtime `["a", "b"]`, discovered
   `["a"]`, which gives `["b"]`) passes. [The runtime module keys come from a source that does
   not depend on the parser. The fixture values are literals.]
5. **Green.** On the final commit, `bun test test/docs-inventory.test.ts` passes. `bun run check`
   passes, with the steps lint, build, typecheck and test (exit 0). The output of `bun run check`
   shows `docs-inventory.test.ts` among the test files, which proves that `check` runs the
   inventory assertion. [The commands' exit statuses.]
6. **Docs content.** The 49 names (or the re-enumerated list for a newer base) each appear in
   `docs/index.md` with a short description and their type, signature or value. The three
   subscription schemas are named explicitly. Every error text quoted in a new entry occurs
   verbatim in `src/`: `grep -F '<text>' src/*.ts` finds each one. `docs/index.md:10` ("Every
   type exported …") is true: each of the 12 missing type names now appears in docs. [The
   baseline table, and `src/` for the error texts.]
7. **dist unchanged.** After `bun run build`, `git diff --exit-code -- dist` exits 0, and
   `git diff --exit-code "$BASE" HEAD -- dist` exits 0. [The committed dist against a fresh
   build, two independent artifacts.]
8. **Scope**, checked after the last commit; each check is separate:
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly
     `AGENTS.md`, `README.md`, `docs/index.md`, `test/docs-inventory.test.ts`. [This literal
     allowlist.]
   - `git diff --name-only --cached` prints nothing, and `git diff --name-only` prints nothing.
   - `git status --porcelain` prints nothing (this also covers untracked files).
   - `git diff --exit-code "$BASE" HEAD -- src dist package.json bun.lock biome.json
     tsconfig.json tsconfig.build.json bunfig.toml eslint.config.js lefthook.yml .github .npmrc
     .gitignore CLAUDE.md LICENSE test/types.fixture.ts test/reference` and
     `git diff --exit-code "$BASE" HEAD -- $(git ls-tree -r --name-only "$BASE" test)` both exit
     0.
   - **Proof of the controls**, in a disposable Git fixture repository (not the implementation
     branch). For each case, record the command, the expected rejection and the result:
     - (a) An unstaged change to a protected file: `git diff --name-only` is not empty.
     - (b) A staged change: `git diff --name-only --cached` is not empty.
     - (c) A committed change: the allowlist and the `--exit-code` diff reject it.
     - (d) Restored-worktree, staged: stage a protected change, then restore only the worktree to
       the base content. The worktree-to-base diff looks clean, but `--cached` and
       `git status --porcelain` reject the state.
     - (e) Restored-worktree, committed: commit a protected change, then restore the worktree
       file to the base content. `git diff "$BASE" -- <file>` (worktree to base) looks clean,
       but `git diff --exit-code "$BASE" HEAD -- <file>` and `git status --porcelain` reject the
       state.
     - (f) A clean committed change to an allowed path only: every check passes.
9. **Test comments.** `test/docs-inventory.test.ts` has no explanatory comments, except at most
   one line naming the test class and the expected outcome. The PR body lists every comment
   added in the change (none, or that one line).
10. **Performance.** The PR reports test CPU as described in "Performance impact": 5 interleaved
    samples per revision, the raw values, the medians, and the delta in seconds and percent. No
    Docker bench.
11. **PR.** The PR body names #885 (child issue `Closes lorenzh/pulse-meta#<child>`). It also
    lists the checks that ran and their results, the recorded `BASE`, the known limit (prose
    matches of short names count as documented), and that #823 is covered.
