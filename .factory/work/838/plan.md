# Spec #838: console: no empty heading in the empty incident preview

## Goal

The incident composer at `/incidents/new` opens with an empty title. Its status-card preview then
renders `<h3 data-part="title"></h3>` (pulse-console `src/incident-preview.ts:84`), and an
unrestricted axe run reports the best-practice rule `empty-heading`. The repository's browser audit
uses only WCAG tags (`e2e/run.ts:111`, `AXE_TAGS`; `e2e/run.ts:663-669`, `axeOn`), so it misses
this. After this change the title heading is hidden while the preview title is empty. This holds
for the server render and for the live update by the console script. The browser check proves it
with an axe run that uses all default rules.

Follow-up to feature #569 (child #787, lorenzh/pulse-console#19, merged). That feature built the
preview, the console script update and the browser runner. Reuse them and do not rebuild them.

## Inspected state

- Console clone `main` at `aa5dc1808d55f9e6655f4da78388957b522c189a`. The implementer records its
  own starting commit as `BASE` and re-runs the baseline controls below on that commit.
- `src/incident-preview.ts:77-89` `previewSection` always renders the title `h3`. It already sets
  `hidden` on the empty affects line (line 79, line 85).
- `src/console-script.ts:59-62` `setPart` sets `textContent` only. `renderPreview` (lines 67-92)
  sets the title at line 71 only when the form has `input[name="title"]`. It sets
  `affects.hidden` at line 91. It runs on `input` and `change` (lines 93-101).
- `src/styles.ts:6` has `[hidden] { display: none !important; }`, so `hidden` on the `h3` works
  inside the flex container `.incident-preview` (`src/styles.ts:270-271`).
- `src/incident-routes.ts:377` builds the composer preview with `openPreview(view.input, ...)`
  for `GET /incidents/new` and for every `POST /incidents/new` re-render (`Update preview`, `422`).
  `src/incident-routes.ts:272` builds the update form preview from the stored title, and line 570
  builds the resolve preview. The update and resolve forms have no title input.
- Status renderer (status clone `b3a29d5`, `src/render.ts:655-667` `manualHead`) renders the
  escaped raw title in `<span class="name">`. The contract gives a published incident a title of
  1 to 200 characters (console `docs/incidents.md:32`), so the status page never shows an empty
  title. Hiding the preview title only while it is empty cannot break parity with any state that
  the status page can show.
- `e2e/run.ts`: `previewParts` (2517-2525) records `[part, textContent, hidden]` for each part.
  `incidentLivePreview` (2587-2623) compares the live preview with the server preview after
  `Update preview`. `checkIncidentsWith` (2845-2883) runs with JavaScript on (layout, axe with
  WCAG tags, live preview) and off. `runChecks` calls it at lines 3563-3564.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/838` answered
  `HTTP 404` on 2026-11-08, so there are no findings yet.

## Scope

- One repository: `console`.
- Server render: `previewSection` adds the `hidden` attribute to `<h3 data-part="title">` when
  `parts.title === ""`. The element stays in the DOM.
- Client: `renderPreview` sets the title heading's `hidden` property to `title.value === ""`
  each time it sets the title text. It does this only when the form has a title input.
- Tests: unit cases in `src/incident-preview.test.ts` and browser cases in `e2e/run.ts`.
- Docs: `README.md`, `docs/configuration.md`, `docs/incidents.md`, `docs/development.md`.

## Non-goals

- No change to routes, form fields, validation, CSP, the API body or the preview text of a
  filled title.
- No trimming and no new title classifier. A title of only spaces or only `U+200B` keeps today's
  behavior: visible heading, raw text (`docs/incidents.md:36`). Whether axe flags such a heading is
  out of scope (see Risks).
- No change in pulse-status or any other repository.
- No placeholder text, no `aria-hidden`-only or CSS-only hiding, and no removal of the element.
  The issue allows omitting the element, but this spec picks `hidden` on the kept element. The
  script finds the same element through `[data-part="title"]` again when the title is refilled.
- The existing WCAG-tagged audits of other pages stay as they are.

## Required behavior

1. `previewSection({ ..., title: "" })` renders `<h3 data-part="title" hidden></h3>`. For any
   title with one or more code units it renders `<h3 data-part="title">` + `escapeHtml(title)` +
   `</h3>` with no `hidden` attribute, exactly as today.
2. Initial HTML of `GET /incidents/new` and `GET /incidents/new?from=<id>` carries the hidden
   title heading before any script runs. A `POST /incidents/new` re-render (`Update preview` or a
   `422`) with an empty title carries it as well.
3. With JavaScript on, the title heading is visible after a non-empty title is typed. It is
   hidden again after the field is cleared, and visible again after a new title is typed. Each step
   happens on the `input` event (Playwright `fill`) and on `change`. No request, timer or storage is
   added.
4. On the update and resolve forms (no title input) the stored title stays visible and unchanged
   while the message or status is edited.
5. The live preview still equals the server preview after `Update preview`
   (`previewParts`, which includes `hidden`), for the filled case and the empty case.
6. An axe run of the whole `/incidents/new` page uses all default rules: no `withTags`, no
   `disableRules`, no `include`/`exclude`. It reports `violations.length === 0` for the empty
   title, for a filled title and for a title that was filled and then cleared.

## Risks

- A title of only whitespace or only `U+200B` still renders a visible heading with no visible
  text. axe may flag that as `empty-heading`. The issue covers only the empty title, and changing
  this needs a title classifier in the script. That is out of scope. Report it as a known limit in
  the PR.
- Seeded incident #12 has the title `U+200B` (`e2e/run.ts:2490-2499`). Its pages stay under the
  WCAG-tagged audit only. Do not add them to the new unrestricted audit.
- `e2e/run.ts` stops at the first failure. Suites earlier in `runChecks` could stop the run
  before the new case. For red evidence on the base, run a disposable copy of the runner that
  calls only `checkIncidentsWith` (see the console section). Do not add a tracked helper for it.
- `axeOn` navigates before it analyzes (`e2e/run.ts:664`). If it is called after typing, the
  state under test is lost. Run `new AxeBuilder({ page }).analyze()` directly on the current page.
- Tool trap, verified on Bun 1.4.0: `bun test --config <path>` (with a space) still loads the
  repository `bunfig.toml`. It prints the coverage table and exits 1 on the 80 % threshold even
  when all tests pass. `bun test --config=<path>` (with `=`) uses the empty file and turns coverage
  off. Use the `=` form only.

## Performance impact

None expected. `bench/budgets.json` in pulse-api (`api`, `probe`, `status`, `notify`,
`contract`, `kit`, `config` sections) has no console entry. The change adds one attribute to a
template string and one property assignment to the client script. It cannot move startup CPU,
load CPU, idle or peak RSS, build CPU, wall-clock startup, p95 latency, requests per second or
image size of any service. Console test CPU grows by about two unit tests (well under 1 % of the
full `bun run test`, which took about 66 s of test time on the base). `check:browser` gains a few
axe runs, a few seconds of browser time, which is not a budget metric. The implementer reports
test CPU as information only. Do not run the Docker bench (#834).

Measurement (information, not a gate): five interleaved pairs, base then branch, each sample one
full `bun run test` with the repository `bunfig.toml` (coverage on), same Bun 1.4.0 and lockfile.
CPU = user + system seconds of the command and its children (`/usr/bin/time -f '%U %S'`). Per
revision, the median is the 3rd of the 5 sorted samples. Report all ten samples, both medians,
`median_branch - median_base` in seconds (2 decimals) and as a percent of `median_base`
(1 decimal). For the base timing, use the unchanged base suite with no temporary red tests.

## Security impact

Security impact: no

The change touches no admin route or authentication, no trust-boundary parser or validator, no
probe client, no file write, no error or log text, no dependency, no Dockerfile and no CI file. The
title text still goes through `escapeHtml`. Only a static attribute is added.

## Rollout order

One repository: only pulse-console changes. No other repository pins pulse-console, and the
change adds no API, contract or config surface. pulse-api and pulse-status keep working against
any console version.

## Counterexamples

- Title `""` on the server render: a wrong implementation renders `<h3 data-part="title"></h3>`.
  It must render the heading with `hidden` (the base fails this, verified below).
- Client-only fix: with JavaScript off, `GET /incidents/new` and `Update preview` with an empty
  title must already show the heading as hidden. A fix only in `console-script.ts` fails this.
- Server-only fix: type `A`, then clear the field. A wrong script leaves the heading hidden after
  `A` (stuck hidden), or visible after the clear (stuck visible). Check each of
  empty → `A` → `""` → `<b>B</b> ` and the `hidden` state at each step.
- Update and resolve forms: a script that sets `heading.hidden = !(titleInput && titleInput.value)`
  hides the stored title on `/incidents/resolve?id=40` as soon as the message is typed. The title
  must stay visible with its 200 `x` characters.
- Trimming: a title of `" <b>x</b> "` must stay visible with the literal text `" <b>x</b> "`.
  A trim must never change it, and no `<b>` element may appear in the preview. A title of `" "` is
  not "empty" under this spec. An implementation that hides it deviates from the rule
  `title === ""`.
- Restricted audit: an axe run with `withTags(AXE_TAGS)`, with `disableRules(["empty-heading"])`,
  scoped to `.incident-preview`, or that counts only some rule ids would pass on the base. It must
  be the default rule set on the whole page, asserting `violations.length === 0`. The base fails it
  for the reason `empty-heading` (issue #838 report).
- Navigation before analysis: calling `axeOn(page, url, ...)` after `fill` reloads the empty
  form, so the "filled" and "cleared" audits would really test the fresh page.
- Hidden attribute serialization: the server writes the bare attribute ` hidden`, the same way as
  the affects line (`src/incident-preview.ts:79`). The unit test asserts this exact string, as in
  Required behavior 1. In the browser, check the DOM state with `hasAttribute("hidden")` and
  visibility, not the serialization.
- Statistic: the test-CPU delta is a difference of medians of 5 samples each. It is not a mean
  of means and not a percentile.

## Contract fields

No new names. The change adds no field, key, route, setting or type. It only adds the HTML
`hidden` attribute to an existing element (`data-part="title"`), which is local to pulse-console
markup and not part of the contract or the config.

## Repository: console

Files:
- `src/incident-preview.ts`
- `src/incident-preview.test.ts`
- `src/console-script.ts`
- `e2e/run.ts`
- `README.md`
- `docs/configuration.md`
- `docs/incidents.md`
- `docs/development.md`

Behavior change: yes. The preview title heading becomes hidden while the title is empty, on the
server render and in the live script. If the code already does this, hold instead of review.

### Tool facts (verified)

- Bun `1.4.0`: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`). The CI
  browser job uses `bun-version: 1.4.0` (`.github/workflows/ci.yml:302`). The pinned shared check
  uses the same (`lorenzh/pulse-config` `.github/workflows/check.yml:24` at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`). Verified locally: `bun --version` prints `1.4.0`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`). Lint
  = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`). Typecheck runs `tsc`
  for the root and for `-p e2e` (`package.json:13`). Test = `bun test` (`package.json:14`).
- `bun run check:browser` = `bun e2e/run.ts` (`package.json:19`). CI runs it in the `browser`
  job (`.github/workflows/ci.yml:291-308`). Playwright `1.64.1` (`package.json:28`),
  `@axe-core/playwright` `4.14.0` (`package.json:22`).
- Coverage: `bunfig.toml:1-4` sets `[test] coverage = true` and
  `coverageThreshold = { lines = 0.8, functions = 0 }`.
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`,
  pinned at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). The pinned
  `biome.json:10-17` includes `**` except `dist`, `node_modules`, `bun.lock`, `*.html` and
  `test/fixtures`, so `e2e/run.ts` and `src/` are linted. Line width 100 (pinned `biome.json:23`).
  The pinned file and `check.yml` were read with `gh api ...?ref=04108fa...` and are byte-identical
  to the config clone.
- CI `check` job: `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa...`
  (`.github/workflows/ci.yml:18`). It runs install, lint, typecheck and test (pinned `check.yml:25-38`).

### Implementation

1. `src/incident-preview.ts`: in `previewSection`, add ` hidden` to the title `h3` when
   `parts.title === ""`, in the same way as the affects line. Do not change any other markup.
2. `src/console-script.ts`: in `renderPreview`, when `title` (the `input[name="title"]`) exists,
   keep `setPart(preview, "title", title.value)` and also set the `hidden` property of
   `preview.querySelector('[data-part="title"]')` to `title.value === ""`. Do not touch the
   heading when the form has no title input. Plain ES2020 inside the template string, as the rest
   of `CONSOLE_JS`. The module comment (lines 11-12) already says "only through `textContent` and
   `hidden`"; keep it true.
3. `src/incident-preview.test.ts`: add tests through `openPreview`/`previewSection`:
   - `title: ""` → the output contains `<h3 data-part="title" hidden></h3>` and no
     `<h3 data-part="title">` without `hidden`.
   - `title: " <b>x</b> "` → the output contains `<h3 data-part="title"> &lt;b&gt;x&lt;/b&gt; </h3>`
     (no `hidden`, outer spaces kept, no `<b>`).
   - The three existing tests stay unchanged and pass. The resolved preview with title `" Slow"`
     stays visible.
4. `e2e/run.ts`: add the empty-title checks to the incident journey in `checkIncidentsWith`.
   - JavaScript on, fresh authenticated `GET /incidents/new`:
     - the title input value is `""`;
     - `.incident-preview [data-part="title"]` has `hidden` and is not visible;
     - `new AxeBuilder({ page }).analyze()` (no tags, no rule changes, whole page) gives
       `violations.length === 0`.
     - Then, without navigating: `fill` `A` → visible, text `A`; `fill` `""` → hidden; `fill`
       `<b>B</b> ` → visible, text `<b>B</b> `, no `.incident-preview b`. Run the unrestricted axe
       after the filled step and after the cleared step, each with `violations.length === 0`.
     - Count page requests during the fill steps only (not during axe): expect `0`. Expect
       `api.writes()` unchanged, no CSP violation and no page error. The rest of the preview
       (impact, status, affects, update) keeps its text and `hidden` state through the steps:
       compare `previewParts` without the title entry before and after.
   - JavaScript on: on `/incidents/resolve?id=40`, fill the message. The title heading stays
     visible with its stored text.
   - JavaScript on: with an empty title, `Update preview` → the server preview equals the live
     preview (`previewParts`, which includes `hidden`) and the title is hidden. The existing filled
     comparison in `incidentLivePreview` stays.
   - JavaScript off: on `GET /incidents/new` the title heading has `hidden`. After `Update preview`
     with an empty title it has `hidden`. After `Update preview` with title `Checkout slow` it has
     no `hidden` and the text `Checkout slow`. `api.writes()` stays unchanged. Do not inject axe
     with JavaScript off.
   - Print one `ok:` line per case. One of them must contain the literal text
     `incident composer, empty title: axe default rules 0 violations` so the run log shows the new
     case.
   - Comments: only where the code cannot say it, for example why axe does not use `axeOn`. List
     every added comment in the PR body.
5. Docs, all in this change:
   - `README.md`: the Incidents sentence says that the preview shows the title heading only once
     the title is not empty.
   - `docs/configuration.md`: one sentence beside the form layout text (the paragraph at line 139)
     says the same and points to `incidents.md`.
   - `docs/incidents.md` "Preview": the server preview and the script hide the title heading while
     the title is empty and show the raw title once it has a character. Untitled-title rules
     (line 36) stay as they are.
   - `docs/development.md` line 61: the browser run also checks the incident composer with an
     empty, filled, cleared and refilled title. It runs axe with all default rules there, separate
     from the WCAG-tagged audits, and checks the hidden title with JavaScript off after
     `Update preview`.
   - None of the four docs may change an endpoint, field, setting or CSP description.

### Baseline controls (verified on `aa5dc18`, Bun 1.4.0)

Setup: a disposable copy of the base (`git archive HEAD | tar -x -C <tmp>`), then
`bun install --frozen-lockfile`. Create an empty file `<abs>/empty.toml` with the file tools.

- B1 (control, passes): `bun test --config=<abs>/empty.toml ./src/incident-preview.test.ts`.
  Expected: exit `0`, `3 pass`, `0 fail`, no `All files` coverage table. Observed 3 of 3 runs on
  2026-11-08: exit 0, 3 pass, 0 fail, no table.
- B1 negative (do not use): `bun test --config <abs>/empty.toml ./src/incident-preview.test.ts`
  (space instead of `=`). Observed 3 of 3 runs: `3 pass`, but the coverage table is printed and the
  exit code is `1`. Plain `bun test ./src/incident-preview.test.ts` also exits 1.
  `--coverage=false` is not a Bun 1.4.0 flag.
- R1 (red on base, verified): a probe test asserting that
  `previewSection(openPreview({ title: "", ... }, []))` does not contain
  `<h3 data-part="title"></h3>`, run with the B1 command. Observed 3 of 3 runs: exit 1, failing
  with `Expected to not contain: "<h3 data-part=\"title\"></h3>"`. The new unit test must fail on
  the base for this reason, 3 of 3 runs. The filled-title test must pass on the base, 3 of 3 runs.
- Full `bun run check` on the base: one run on 2026-11-08 gave exit 0, `1991 pass`, `0 fail`,
  98 % lines. It is not claimed as a three-run baseline. The final gate below needs it to pass on
  the branch. If it fails on `BASE` for an unrelated reason, report that and do not weaken
  anything.
- Browser red (to produce during implementation, not verified here): in a disposable copy at
  `BASE` with Chromium installed, run a temporary runner copy that calls only
  `checkIncidentsWith(browser, true)` and `checkIncidentsWith(browser, false)` with the new
  checks and the unchanged production code. Expected: the empty-title case fails 3 of 3 runs,
  on JavaScript on with axe id `empty-heading` and on JavaScript off on the missing `hidden`.
  Auth, dependency or Chromium install failures are not the intended red.

### Acceptance

1. `bun test --config=<abs>/empty.toml ./src/incident-preview.test.ts` on the branch: exit 0,
   `5 pass` or more (3 existing plus at least 2 new), `0 fail`, 3 of 3 runs. The expected count is
   the literal 3 from the base plus the new tests that the PR lists.
2. `bun run check` on the branch: exit 0 with the repository `bunfig.toml` (coverage threshold
   on). It runs lint (Biome, pulse-eslint, pulse-workflows), both typechecks and all tests.
3. `bun run check:browser` on the branch: exit 0. The log contains
   `ok: incident composer, empty title: axe default rules 0 violations` (literal text from this
   spec) and the other new `ok:` lines.
4. Red/green: R1 and the browser red fail on the base for the stated reasons, 3 of 3 runs, and
   pass on the branch.
5. Service exercise (console `AGENTS.md`, "End-to-end checks"): start the console once and open
   `/incidents/new` with an empty title, then type, clear and retype a title. Prefer `bun start`
   with `PULSE_API_URL` pointing at a local fake API and a temporary data directory. If
   `/incidents/new` cannot be reached that way, use `bun e2e/run.ts --serve` (it starts the real
   server on the stateful incidents fake) and say why. Report the command and the observed
   hidden/visible states. No external writes.
6. Scope, with `BASE` recorded before the first edit and checked after the last commit:
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly the sorted `Files:` list above
     (8 paths). Any other path fails.
   - `git diff --name-only --cached` is empty, and `git diff --name-only` is empty.
   - `git status --porcelain` is empty, including untracked files.
   - `git diff --exit-code "$BASE" HEAD -- <protected>` exits 0. `<protected>` lists
     `AGENTS.md CLAUDE.md package.json bun.lock bunfig.toml biome.json eslint.config.js
     tsconfig.json e2e/tsconfig.json Dockerfile lefthook.yml .github assets scripts test
     src/server.ts src/incident-routes.ts src/incident-pages.ts src/incident-form.ts
     src/incident-read.ts src/incident-write.ts src/styles.ts docs/index.md`. Also run
     `git diff --exit-code "$BASE" HEAD -- . ':(exclude)<each allowed path>'` so every path
     outside the list is protected.
   - README changes in this task, so it is in the allowed list and not protected.
7. Scope-check proof with a disposable fixture repository outside the clones. Use one allowed
   path and one protected path. Show that:
   - a clean committed allowed change passes all checks;
   - a committed protected change fails the diff and protected checks;
   - an index-only protected change fails `--cached`;
   - a worktree-only protected change fails `git diff --name-only` and `status`;
   - an untracked file fails `status`;
   - restored worktree, case 1: stage a protected change, then restore only the worktree file to
     the base content. `--cached` still fails.
   - restored worktree, case 2: commit a protected change, then restore only the worktree file
     to the base content. The `"$BASE" HEAD` and protected checks still fail.
   Put the outputs in the PR body.
8. Comments: read every added line, inline comments included. List every added comment in the PR
   body, or write "none" only after that read. No new test file is created. If one becomes
   necessary, hold first: the file list here, in the task and in the issue review must agree.
9. Documentation: the four docs describe the same behavior (title heading hidden only while the
   title is empty, on the server and in the live preview). The diff of these docs changes no
   endpoint, form field, setting or CSP text. The reviewer checks this by reading the doc diff.
10. Performance: report the interleaved test-CPU samples, medians and delta as described in
    "Performance impact" (information only). No Docker bench.
11. The PR body names `Closes lorenzh/pulse-meta#<child>`, the checks that ran, the known limit
    (whitespace-only or `U+200B`-only titles) and the added comments.
