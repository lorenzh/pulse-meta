# Spec #927: Name the code conventions in every target's AGENTS.md

## Goal

`docs/code-conventions.md` in pulse-meta (merged in #925) is the one rule for easy and reusable code.
Agents in a target repository read that target's `AGENTS.md`, not the meta docs. Each of the eleven
targets gets a short `## Code conventions` entry in its root `AGENTS.md`. The entry links the meta
document and says in one or two sentences what the rule means in that repository. The console
entry also states the page-module rule.

## Scope

- One root `AGENTS.md` per target: `contract`, `probe`, `api`, `status`, `notify`, `config`, `kit`,
  `website`, `console`, `deploy`, `agent`.
- `agent` has no `AGENTS.md` on `main` yet (clone `e72ddb2`: only `LICENSE` and `README.md`). Its
  task creates a minimal one.

## Non-goals

- No product code, test, CI, dependency, lockfile, `README.md`, `docs/`, version or `dist/` change.
- No copy of the convention text (rules list or examples) into a target. Name and link it only.
- No refactor of existing duplication, and no audit that existing code or tests comply. Existing
  gaps, for example console `src/server.*.test.ts` files that do not yet call `expectCalloutsOnly`,
  are follow-up issues.
- No new enforcement (lint rule, test, CI step).
- No change to `CLAUDE.md` (each one imports `AGENTS.md`), Factory config or meta docs.

## Required behavior

### The common entry

Every target gets a new section headed exactly `## Code conventions`. It holds:

1. A Markdown link whose destination is exactly
   `https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md`. A relative
   `docs/code-conventions.md` would resolve inside the target and break. Use a sibling path or a
   `.repos/meta` path for the same reason: never. The URL was checked on 2026-11-08:
   `curl -s -o /dev/null -w '%{http_code}' <url>` returned `200`, and
   `gh api repos/lorenzh/pulse-meta/contents/docs/code-conventions.md?ref=main` returned blob
   `f41345e955e95619b1cbddcb9401c9bc06179f77`.
2. One or two sentences in that repository's terms that cover all three points:
   - **search first:** look for an existing helper (name where it lives in this repository) before
     writing a new one;
   - **second copy:** the second copy of a pattern goes into a shared helper, not a copy;
   - **small and pure:** keep functions small and pure where the layer allows it, and keep I/O where
     the repository already keeps it.

The meaning counts, not an exact template. The text below each repository section is the proposed
wording. The implementer may adjust it to the file's current state on `main`, but must keep all
three points and the link.

Placement: directly after the section that holds the repository's design rules (`## Code design`,
or `## Rules` in `deploy`). Existing text stays as it is. No existing line contradicts the entry:
the line "Keep a helper beside its only caller; move it out when a second module needs it" in
`contract`, `probe`, `api`, `status`, `notify`, `config`, `kit` and `console` describes where a
helper lives, and the new entry says that a second copy becomes a helper. Both hold, so the line
stays. The stricter rules already in place (use pulse-kit before a local helper, never copy kit or
contract code into a service) stay and are not repeated.

### The console entry

On top of the common entry, the console entry states:

- `*-pages.ts` modules are pure: data in, markup out, no I/O.
- Inputs, selects, choices, field errors, tables, callouts, empty states and outcome pages come
  from shared helpers (`src/html.ts` for form controls, `src/states.ts` for callouts and states).
  A screen does not write its own copy. When a category has no shared helper yet, the first screen
  that needs a second copy adds the helper there, with its test.
- Every `src/server.*.test.ts` that renders a page runs `expectCalloutsOnly` from
  `test/rendered-audit.ts` on the rendered body.

All eight categories must be named. The entry may be a few sentences longer than the others.

## Risks

- **Stale wording.** A target's `main` can move between this spec (clones listed below) and the
  implementation. The implementer re-reads `AGENTS.md` on current `main` and places the entry
  against that text. If `main` already has a `## Code conventions` section, extend it instead of
  adding a second one.
- **Helper names that do not exist.** The console entry names helper modules, not helper
  functions that do not exist yet. Evidence from console `f0988d9`: `src/html.ts` exports `field`,
  `textareaField`, `submitButton` and `formErrorSummary` (lines 88, 104, 115, 134). `src/states.ts`
  exports `callout`, `alertCallout`, `emptyState` and the state pages (lines 31, 59, 66, 85–171).
  `test/rendered-audit.ts:7` exports `expectCalloutsOnly(body)`. There is no shared select, choice,
  table or outcome-page helper yet. `checkTypeChoiceHtml` (`src/check-editor-page.ts:544`) is
  local to one page. So the rule names the place, and says a missing helper is added there.
- **Reading the rule as a refactor order.** The console rule describes how new and changed code
  must look. Today only `src/server.checks.test.ts`, `src/server.checks-write.test.ts` and
  `src/server.checks-change.test.ts` of 30 `src/server.*.test.ts` files reference
  `expectCalloutsOnly`. This feature does not change them. The PR states this as a known limit.
- **Growth.** A long entry dilutes the rule. The common entry has at most three lines of prose
  after the heading. The console entry has at most six.

## Acceptance evidence

1. **Diff scope (per PR).** `git diff --name-only origin/main...HEAD` prints exactly `AGENTS.md`.
   The expected value is the literal `AGENTS.md`. For existing files,
   `git diff origin/main...HEAD -- AGENTS.md | grep '^-[^-]'` prints nothing. Expected: an
   empty output, because only lines are added.
2. **Link (per PR and after merge).** `grep -c 'https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md' AGENTS.md`
   prints at least `1`, and `grep -c '^## Code conventions$' AGENTS.md` prints `1`. The URL
   answers `200` for an unauthenticated `curl -s -o /dev/null -w '%{http_code}'`. Expected values
   are the literals `1` and `200`.
3. **Meaning (per PR, by reading).** The reviewer reads the entry and confirms each of the three
   points (search first, second copy, small and pure). The entry also must not copy the seven rules
   or the examples of the meta document.
4. **Console (per PR, by reading and grep).** Each of these literal strings occurs in the console
   entry: `*-pages.ts`, `no I/O`, `inputs`, `selects`, `choices`, `field errors`, `tables`,
   `callouts`, `empty states`, `outcome pages`, `src/server.*.test.ts`, `expectCalloutsOnly`,
   `test/rendered-audit.ts`.
5. **Repository checks (per PR).** Run the check command that the target already has, unchanged
   (cited per section), and report the result. A failure that the `AGENTS.md` change cannot cause
   is reported as a known limit, not fixed.
6. **After merge (feature close).** For each of the eleven targets, read `AGENTS.md` on `main`,
   repeat checks 2–4, and record the `main` SHA that was read.

## Performance impact

None expected. Only Markdown instruction files change. `api/bench/budgets.json` has no metric that
`AGENTS.md` can move: no startup or load CPU, RSS, test or build CPU, latency, throughput or
image size. No service reads or ships it: the `Dockerfile`s of api, probe, status, notify and console copy only `package.json`, `bun.lock`, `src` and asset folders (for example `api/Dockerfile:13-14`), so
`AGENTS.md` is not in any image. No measurement needed.

## Security impact

Security impact: no. Documentation only. No admin route, parser, probe client, file write, error
text, dependency, Dockerfile or CI file changes.

## Rollout order

One repository per child, no order. Each target change is self-contained. Nothing is pinned,
built or released from `AGENTS.md`: `contract` and `kit` commit `dist/`, which does not contain
it. The `website` docs pipeline fetches only the `docs/*.md` paths listed in `docs.config.json`
(for example lines 8–15), not `AGENTS.md`. The referenced meta document is already on pulse-meta
`main`. Older consumers on any pin keep working because no code changes.

## Counterexamples

| Rule | Input a correct implementation rejects, or a wrong one gets wrong |
| --- | --- |
| Link destination is the absolute meta URL | `[conventions](docs/code-conventions.md)` in a target: resolves to `lorenzh/pulse-<target>/blob/main/docs/code-conventions.md`, which does not exist. Reject. `../pulse-meta/docs/code-conventions.md` or `.repos/meta/docs/code-conventions.md`: workspace-dependent. Reject. |
| Link the rule, do not copy it | An entry that lists "1. Reuse before you write … 7. How a reviewer checks it" or pastes the `fieldError` example. Reject: the rule would exist twice. |
| All three points present | "See the code conventions." alone. Reject: no target sentence. An entry with search and second copy but no "small and pure". Reject. |
| Existing text stays | A diff that rewrites "Keep a helper beside its only caller; move it out when a second module needs it." Reject: it does not contradict the entry. |
| Only `AGENTS.md` changes | A diff that also touches `CLAUDE.md`, `README.md` or a test (for example adding `expectCalloutsOnly` to `src/server.team.test.ts`). Reject. |
| Console names all eight categories | An entry that names "form controls and callouts" instead of inputs, selects, choices, field errors, tables, callouts, empty states and outcome pages. Reject. |
| Console test rule scope | "`src/server.checks*.test.ts` run `expectCalloutsOnly`". Reject: the rule is every `src/server.*.test.ts` that renders a page. |
| One section | A second `## Code conventions` heading when `main` already has one. Reject: `grep -c` must print `1`. |

No statistics are defined by this feature.

## Contract fields

No new names. The feature adds no field, key, route or exported name. The section heading `Code
conventions` is prose. A check of the clones for a code identifier was not needed. For the record:
`grep -rn 'code-conventions' .repos/contract/src .repos/config/src` prints nothing.

## Repository: contract

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, which starts at
  line 46 at clone `6370c25`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Before adding a schema, validator or wire helper, search `src/schema.ts`, `src/validate.ts` and `src/version.ts` for one that does the job, and turn the second copy of a shape or check into one shared schema or helper. Validators stay small, pure functions.
```

Shared modules named: `src/schema.ts`, `src/validate.ts`, `src/version.ts` (from the existing "This
repository" section).

Checks: acceptance 1–3. Run `bun run check` (`package.json:28`: `bun run lint && bun run build &&
bun run typecheck && bun run test`). The build rewrites `dist/` from `src/`, which is unchanged, so
`git status` must stay clean apart from `AGENTS.md`.

Completion evidence: PR diff with only `AGENTS.md`, the grep outputs from acceptance 2, and the
`bun run check` result.

## Repository: probe

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 46 at clone
  `5cc1e32`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search `src/` and `@lorenzh/pulse-kit` for an existing helper before writing one, and move the second copy of a pattern into a shared helper. Keep check and schedule logic in small pure functions; HTTP, timers and the clock stay injected.
```

Shared modules named: `src/` modules listed in "This repository" (`check.ts`, `client.ts`,
`scheduler.ts`, `buffer.ts`) and `@lorenzh/pulse-kit`.

Checks: acceptance 1–3. Run `bun run check` (`package.json:19`).

Completion evidence: as for contract.

## Repository: api

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 47 at clone
  `5d87c59`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search `src/`, `test/` and `@lorenzh/pulse-kit` for an existing helper, query or test setup before writing one, and move the second copy of a pattern into a shared helper. Keep logic in small pure functions; HTTP stays in the server module and SQL in `src/service.ts`.
```

Shared modules named: `src/service.ts` (SQL, from "This repository"), `@lorenzh/pulse-kit`.

Checks: acceptance 1–3. Run `bun run check` (`package.json:20`).

Completion evidence: as for contract.

## Repository: status

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 45 at clone
  `cd7904e`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search the browser modules (`src/render.ts`, `src/sections.ts`, `src/components-view.ts`), `@lorenzh/pulse-kit` and the contract before writing a helper, and move the second copy of markup or formatting into a shared one. Rendering and formatting stay small pure functions of their input.
```

Shared modules named: the browser modules in `tsModules` (`src/server.ts`), as listed in "This
repository", and the browser-safe kit imports.

Checks: acceptance 1–3. Run `bun run check` (`package.json:19`).

Completion evidence: as for contract.

## Repository: notify

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 46 at clone
  `a833e6b`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search `src/channels/` (`http-post.ts`, `message.ts`), `src/errors.ts`, `@lorenzh/pulse-kit` and `test/support.ts` before writing a helper or test setup, and move the second copy of a pattern into a shared one. Keep message building and routing in small pure functions; senders, clock and ledger stay injected.
```

Shared modules named: `src/channels/http-post.ts`, `src/channels/message.ts`, `src/errors.ts`,
`test/support.ts` (all from "This repository").

Checks: acceptance 1–3. Run `bun run check` (`package.json:17`).

Completion evidence: as for contract.

## Repository: config

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 46 at clone
  `bc87049`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change and to the shared configs this repository ships. Search the shared files, `bin/` and the existing tests before adding a rule, script or test setup, and move the second copy of a pattern into a shared file or helper. Keep script logic in small pure functions; file and process I/O stays in the `bin/` entry points.
```

Shared modules named: the shared files from "This repository" (`biome.json`, `tsconfig.base.json`,
`eslint.config.js`, `lefthook.yml`, `.github/workflows/check.yml`), `bin/pulse-eslint.js` and
`bin/pulse-workflows.js`.

Checks: acceptance 1–3. Run `bun run check` (`package.json:40`). The entry does not change a
shared file, so no target pin is bumped.

Completion evidence: as for contract.

## Repository: kit

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 46 at clone
  `536133f`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search the exports in [`docs/index.md`](docs/index.md#exports) before writing a helper, and extend an existing helper with a parameter before adding a variant; the second copy of a pattern becomes one shared helper. Helpers stay small and pure, with side effects passed as parameters.
```

Shared modules named: the export list in `docs/index.md#exports` (from "This repository").

Checks: acceptance 1–3. Run `bun run check` (`package.json:39`: lint, build, typecheck, test).
`dist/` must stay unchanged.

Completion evidence: as for contract.

## Repository: website

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 44 at clone
  `d5e725f`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search `src/components/`, `src/lib/` and `src/build/` before writing a component or helper, and move the second copy of markup or logic into a shared one. Components and content logic stay small pure functions of their props; I/O stays in `scripts/` and `src/build/`.
```

Shared modules named: `src/components/` (for example `ButtonLink.tsx`, `Document.tsx`),
`src/lib/`, `src/build/` (for example `url-safety.ts`).

Checks: acceptance 1–3. Run `bun run check` (`package.json:25`). Tests that mention
`../AGENTS.md` (`src/docs/links.test.ts:61`, `src/docs/page.test.ts:25`,
`src/build/url-safety.test.ts:34`) use it as a literal fixture string and do not read the file.
`check:site` is not needed: `AGENTS.md` is not part of the built site.

Completion evidence: as for contract.

## Repository: console

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Code design`, line 49 at clone
  `f0988d9`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search `src/html.ts`, `src/states.ts`, `@lorenzh/pulse-kit` and `test/` before writing a helper or test setup, and move the second copy of markup or logic into a shared helper; keep functions small and pure.

- `*-pages.ts` modules are pure: data in, markup out, no I/O.
- Inputs, selects, choices, field errors, tables, callouts, empty states and outcome pages come from shared helpers (`src/html.ts` for form controls, `src/states.ts` for callouts and states). A screen does not write its own copy; when a helper is missing, add it there with its test.
- Every `src/server.*.test.ts` that renders a page runs `expectCalloutsOnly` (`test/rendered-audit.ts`) on the rendered body.
```

Shared modules named: `src/html.ts` (`field`, `textareaField`, `submitButton`,
`formErrorSummary`), `src/states.ts` (`callout`, `alertCallout`, `emptyState` and the state
pages), `test/rendered-audit.ts` (`expectCalloutsOnly`).

Existing text: "Keep logic pure. I/O … stays in `main.ts` and the server module." and the "This
repository" page list (`src/pages.ts`, `src/shell.ts`, `src/states.ts`) do not contradict the entry
and stay as they are. No test changes, including the 27 `src/server.*.test.ts` files that do not
call `expectCalloutsOnly` today. The PR names this as a known limit.

Checks: acceptance 1–4. Run `bun run check` (`package.json:18`).

Completion evidence: PR diff with only `AGENTS.md`, the grep outputs from acceptance 2 and 4, and
the `bun run check` result.

## Repository: deploy

Files:
- `AGENTS.md` (changed: new section `## Code conventions` after `## Rules`, line 21 at clone
  `9853c6d`)

Behavior change: no. Documentation only.

Proposed entry:

```md
## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change, also to Compose files and scripts. Search `common/services.yaml`, `scripts/`, `e2e/` and `cli/` for an existing service block, shell function or helper before writing one, and move the second copy into a shared one. Keep CLI logic in small pure functions; Docker, files and the network stay at the edge.
```

Shared modules named: `common/services.yaml` (shared service config), the helpers in `scripts/` and
`e2e/` (for example the `metric_is`, `manual_count` and `published_port` helpers), and `cli/`
modules.

Checks: acceptance 1–3. Run `bun run check` (`package.json:18`). `biome.json` excludes `*.md`
(`"!*.md"` in its `files.includes`), so the CLI checks do not read `AGENTS.md`. Shell, JSON and
Compose checks do not read Markdown either. Nothing else is required.

Completion evidence: as for contract.

## Repository: agent

Files:
- `AGENTS.md` (new; clone `e72ddb2` holds only `LICENSE` and `README.md`)

Behavior change: no. Documentation only.

If `main` has gained an `AGENTS.md` by implementation time, keep it and add the section after its
design rules instead. Otherwise create:

```md
# AGENTS.md

Instructions for coding agents in this repository. They bind every change.

pulse-agent is the Linux host agent of pulse, written in Rust; see `README.md`. Work arrives as an issue with an approved spec from the meta repository; implement only the section for this repository.

## Code conventions

The pulse [code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md) apply to every change. Search the crate for an existing function or module before writing one, and move the second copy of a pattern into a shared one. Keep metric parsing and formatting in small pure functions; reading the host and sending to pulse-api stay at the edge.
```

Do not add commands, toolchain versions, Rust tooling, a `CLAUDE.md` or code: the repository has
none yet, and inventing them is out of scope.

Checks: acceptance 1–3, with acceptance 1 reading "prints exactly `AGENTS.md`" and no removed
lines. The repository has no `package.json` and no CI workflow at clone `e72ddb2`, so there is
nothing to run. The PR states this.

Completion evidence: PR diff with only the new `AGENTS.md` and the grep outputs from acceptance 2.
