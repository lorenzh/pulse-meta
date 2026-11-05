# Spec #754: console: one sentence on the 404 page

## Goal

The signed-in shell 404 page of the console shows its title once and one plain sentence. Today
it shows two sentences. The `Go to the overview` link stays. This fixes a defect that the review
of pulse-console#11 (child #748 of #741) found: the #741 spec asks for "one plain sentence", but
its decision D6 fixed a two-sentence literal. The review note on #741 suggests the new wording.

## Sources

- Issue #754 and its one comment (the Factory issue-review claim). No decisions from earlier runs.
- `.factory/work/754/issue-review.md`: no blocking questions. Its open points 1–6 are settled
  below.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/754`
  answered `HTTP 404`, so this feature has no findings yet. That is the normal case for a feature
  with no children.
- Console clone `.repos/console` on `main` at `9a3ef14` (merge of console PR #11). The #741
  shell, account pages and 404 shell page are already on `main`. Do not redo them.

## Current behavior (console `main` 9a3ef14)

- `src/states.ts:90-94`: `notFoundState()` returns
  `<p>There is no page at this address. Check the address, or go to the overview.</p>` followed
  by `link("/", "Go to the overview")`, which renders `<p><a href="/">Go to the overview</a></p>\n`
  (`src/states.ts:16-18`). The function adds no heading of its own.
- `src/shell.ts:58-61`: the shell writes the title once as `<h1>` inside
  `<main id="main" class="shell-main">`, then the body.
- `src/server.ts:1010-1019` (`sendNotFound`): the shell 404 is used only for a signed-in `GET`
  or `HEAD` after setup that passes the host check. Every other unknown-path request gets the
  plain text 404.
- Other callers of the same renderer: `src/team-routes.ts:59` and `test/fixture-routes.ts:244,332`.
  They get the new wording through the shared renderer and need no change of their own.
- Assertions of the old wording: `src/states.test.ts:87-89` (full literal),
  `src/server.security.test.ts:605-607` (full `<p>` literal), `src/server.confirm.test.ts:215,225`
  (prefix `There is no page at this address.`), `e2e/run.ts:374-375` (full sentence).
- Docs that quote the old wording: `README.md:12` and `docs/configuration.md:115`.
- Bun 1.4.0 has `Intl.Segmenter`. A local
  `bun -e` with `new Intl.Segmenter("en", { granularity: "sentence" })` that dropped
  whitespace-only segments counted 2 for the current sentence and 1 for the new one.

## Scope

- The console only: the fixed copy in `notFoundState()`, the tests that assert it, one new
  sentence-count test, and the two docs that quote the copy.

## Non-goals

- No change to status codes, routing, `GET`/`HEAD` handling, the plain text 404, the shell
  markup, the `h1`, the document `<title>`, the link (`href="/"`, label `Go to the overview`),
  session or role gates, security headers, CSP, form tokens, or the `Link not valid` page.
- No new packages, pins, config, or CI changes. No other repository changes.

## Required behavior

1. `notFoundState()` returns exactly
   `<p>There is no page at this address; go to the overview.</p>\n<p><a href="/">Go to the overview</a></p>\n`.
   The new sentence is the one the #741 review note suggests. The issue gives it as an example,
   and the issue review (open point 1) takes it without a decision from a person.
2. The signed-in shell 404 (`GET /no-such-page`) still answers 404. It has one `<h1>Page not
   found</h1>`, no `<h2>Page not found</h2>`, the `<title>` with `Page not found`, and the link.
   Inside `main`, the body has exactly one explanatory paragraph: a `<p>` that is not only a link.
   That paragraph holds exactly one sentence.
3. `HEAD` of the same path still answers 404 with an empty body. Unsigned and `POST`
   unknown-path requests still get the plain text 404.

## Definition: sentence count

- Input: the text of the explanatory paragraph(s) in the rendered `main` of the HTTP response
  body. An explanatory paragraph is a `<p>…</p>` inside `<main id="main" …>…</main>` that holds
  no `<a`. Leave out the `<h1>`, the link paragraph, the header, the navigation and the `<head>`.
  Take its text content: remove tags and decode the entities that `escapeHtml` writes.
- Segmenter: `new Intl.Segmenter("en", { granularity: "sentence" })`. Count the segments whose
  `segment.trim()` is not empty.
- Expected: exactly 1 explanatory paragraph and exactly 1 sentence. Both are literals in the
  test. The test never takes its input from `src/states.ts` or from a hard-coded copy of the
  sentence. It reads the input only from the body that the server rendered.

## Performance impact

None expected: the change replaces one static string of about 80 bytes with one of about 50.
It touches none of the metrics in `bench/budgets.json` of the api repository (startup CPU, load
CPU, idle and peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per
second, image size), and the console is not benchmarked there. No A/B measurement is needed.

## Security impact

Security impact: no
Only fixed, non-external page copy changes. There is no change to auth, the order of checks,
status codes, parsers, logs carrying external data, file writes, dependencies, Dockerfile or CI.

## Rollout order

One repository: only the console changes, and no other repository reads the 404 copy.

## Counterexamples

- The old copy `There is no page at this address. Check the address, or go to the overview.`
  gives 2 sentences. The new test must fail on `main` 9a3ef14 with an actual count of 2 against
  the expected 1.
- A wrong check counts all of `main`. The `h1` `Page not found` and the link label
  `Go to the overview` would each add a segment, so a correct one-sentence body would fail.
  Count only the explanatory paragraph.
- A wrong fix splits the copy into two `<p>` elements of one sentence each. The paragraph-count
  assertion (exactly 1) must reject it.
- A wrong fix removes the link or changes its `href`. The existing
  `<a href="/">Go to the overview</a>` assertions and the browser click must reject it.
- A wrong fix adds a body heading (`<h2>Page not found</h2>`). The existing
  `not.toContain("<h2>Page not found</h2>")` and `split("Page not found")` length-3 assertions
  must reject it. The three parts come from the two occurrences: `<title>` and `<h1>`.
- A self-confirming test, one that counts the sentences of a string literal or of `notFoundState()`
  itself, cannot fail on `main` in the way required here. It does not meet the acceptance check.

## Contract fields

No new names. The change adds no field, key, route or name. It only replaces page copy.

## Repository: console

Files:
- `src/states.ts` (change: the copy in `notFoundState()`)
- `src/states.test.ts` (change: the full literal at lines 87-89)
- `src/server.security.test.ts` (change: the literal at lines 605-607; add the sentence-count test)
- `src/server.confirm.test.ts` (change: the prefixes at lines 215 and 225)
- `e2e/run.ts` (change: the sentence in `checkNotFound`, lines 374-375; add the same count in the browser)
- `README.md` (change: the quoted sentence at line 12)
- `docs/configuration.md` (change: the quoted sentence at line 115)

Behavior change: yes
The rendered 404 page copy changes from two sentences to one.

### Behavior

- Set the copy in `notFoundState()` (`src/states.ts:92`) to
  `There is no page at this address; go to the overview.`. Keep the `link("/", "Go to the overview")`
  line and add no heading.
- Change nothing else in `src/`. The diff of `src/` outside tests must be this one line.

### Tests (TDD order)

1. Red: write the sentence-count test first, in `src/server.security.test.ts`, next to
   "GET of an unknown path with a session is the shell 404" (line 597). Use the existing
   `signedIn()` and `getPage()` helpers. `GET /no-such-page` and assert status 404. Take the
   `main` element from `res.body`. Collect its `<p>…</p>` elements that hold no `<a` and assert
   that there is exactly 1. Strip tags, decode entities, and count the sentences as defined in
   "Definition: sentence count". Assert `toBe(1)`. Run
   `bun test src/server.security.test.ts --test-name-pattern "<new test name>"` on unchanged
   `main` 9a3ef14 and record that it fails with `Expected: 1` / `Received: 2`.
   Keep the count assertion separate from any literal assertion, so the red run proves the
   sentence defect and not a changed literal. If the extraction helper is needed by only this
   test, keep it in this test file (console `AGENTS.md`: "Keep a helper beside its only caller").
2. Green: change the copy in `src/states.ts`. Re-run the same command and record that it
   passes.
3. Update the stale assertions to the new copy:
   - `src/states.test.ts:87-89`:
     `'<p>There is no page at this address; go to the overview.</p>\n<p><a href="/">Go to the overview</a></p>\n'`.
   - `src/server.security.test.ts:605-607`:
     `"<p>There is no page at this address; go to the overview.</p>"`.
   - `src/server.confirm.test.ts:215,225`: `"There is no page at this address; go to the overview."`.
   - `e2e/run.ts:374`: the new sentence. Also count it in `checkNotFound`: read the
     `textContent` of the `main#main p` elements that contain no `a`. Assert exactly 1
     element. Count its sentences with the same segmenter and empty-segment rule and assert 1.
     Keep the one-visible-title check and the click to `/`.
4. Keep the existing checks: one `h1`, no `h2`, `split("Page not found")` length 3, the link,
   `expectShell(res)` (headers and scripts), `HEAD` 404 with an empty body, and "other
   unknown-path requests keep the plain 404". Do not weaken or delete any of them.

### Docs

- `README.md:12` and `docs/configuration.md:115`: replace the quoted
  `There is no page at this address. Check the address, or go to the overview.` with
  `There is no page at this address; go to the overview.`. Change no other text.

### Tool facts (verified)

- Bun 1.4.0: `package.json` `engines.bun` and `packageManager` (lines 8-10 and 35); CI
  `browser` job `bun-version: 1.4.0` (`.github/workflows/ci.yml`, `browser` job, step
  `oven-sh/setup-bun`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json`
  `scripts.check`). `lint` = `biome check . && pulse-eslint . && pulse-workflows`. `typecheck`
  also type-checks `e2e` (`-p e2e`). `check:browser` = `bun e2e/run.ts`.
- `bunfig.toml` `[test]`: `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`
  (lines 1-3).
- Biome: `biome.json` extends `@lorenzh/pulse-config/biome.json`. At the pin
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json` devDependency), that file includes
  `**`, ignores `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 10-17),
  and sets `lineWidth` 100 (line 23). The pinned file is the same as the config clone `main`.
- CI: `.github/workflows/ci.yml` job `check` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`.
  At that pin, it runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and
  `bun run test` (lines 25-38). The pinned file is the same as the config clone `main`. The
  `docker` (both architectures), `deploy-dev` and `browser` (`bun run check:browser`) jobs also
  run on pull requests.

### Completion evidence

- The red/green record from Tests 1-2: the command, the baseline revision `9a3ef14`, and the
  output `Received: 2` before and the pass after. The expected value 1 is a literal in the test.
- `bun run check` passes, and so does `bun run check:browser` (after
  `bunx playwright install chromium`).
- One manual run through the running service: `bun e2e/run.ts --serve`, sign in, open
  `/does-not-exist`. Expect status 404, one `Page not found` heading, the sentence
  `There is no page at this address; go to the overview.` and a working `Go to the overview` link.
- `git grep -n "Check the address, or go to the overview"` returns nothing.
- `git diff main -- src ':!src/*.test.ts'` shows only the one-line copy change in `src/states.ts`.
- All PR CI jobs are green: `check`, `docker` (x86 and arm), `browser` and `deploy-dev`.

## Acceptance

The new test in `src/server.security.test.ts` counts sentences with `Intl.Segmenter` on the
explanatory paragraph of the rendered `GET /no-such-page` body. It fails on console `main`
`9a3ef14` (received 2, expected the literal 1) and passes after the change. `bun run check`,
`bun run check:browser` and the console PR CI are green.
