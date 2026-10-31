# Spec #482: Factory prompts: no silent no-change, verified tool assumptions, independent expected values

## Goal

The Factory prompts of pulse-meta stop three failure modes from passing silently:

- (a) An implementer reports "no bug, no change needed" for a section that requires a behavior change, and the run still goes to `review` and completes.
- (b) A plan relies on a tool fact (version, which linter runs, Biome file scope, test runner flag, CI step) that nobody checked against the target repository.
- (c) A check takes its expected value from the file it checks, so it can never fail.

## Scope

Only pulse-meta. The person applies the change; Factory builds nothing:

- `.factory/prompts/implement.md`, `review.md`, `plan.md` and `plan-review.md`.
- One sentence in `docs/factory.md` ("Build review gates"), so the docs match the new review gates.

**No target repository changes.** So the spec has no `## Repository:` section, and `targets.json` is the empty array `[]`. The meta target runs only `spec` and `merge` (`.factory/config.yaml` 59: `workflows: [ spec, merge ]`). So no `build` run applies this. A person applies the exact diff in "Changes in meta" after the spec merges, as in #352, #377 and #455.

**Fan-out (issue review point 1, #455 precedent).** `factory fan-out` rejects an empty array ("must be a nonempty JSON array"). A missing file gives the `FAN_OUT_PLAN_MISSING` notice and exits 0. So the person who merges the spec PR **deletes `.factory/work/482/targets.json` from the spec branch before the merge**. If they forget, the only effect is one failed fan-out run and its failure comment on #482. No child issue is opened.

## Non-goals

- No change to the Factory itself (`@paragondata/*`), `.factory/config.yaml`, the workflows, `preamble.md`, `issue-review.md`, `merge-resolve.md`, `merge-review.md` or `security.md`.
- No new status and no new transition.
- No rewrite of existing tests or existing specs. Rule (c) covers new and changed checks. Specs written before the `Behavior change:` line existed keep working: the prompts then read the section's required-behavior text.
- No mechanical enforcement. These are prompt rules, and the reviewer is the second line.

## Decisions

1. **An explicit `Behavior change: yes|no` line in every repository section (issue review point 2).**
   - `plan.md` writes it right after the `Files:` list, and `plan-review.md` checks it.
   - `no` only for a pure refactor or a tests-only or docs-only task. Everything else is `yes`, including tooling and CI files.
   - `implement.md` and `review.md` read the line. Without it (older specs), they fall back to the required-behavior text, the same way `review.md` 73-75 falls back for `Security impact`.
   - A marker is deterministic. Reading the text alone would leave the same judgment call that causes (a).
2. **"Source file" = a file that ships or runs the behavior: not a test, fixture or doc.** A diff that only adds or changes tests, fixtures or docs counts as "no source change". Otherwise an implementer could add a passing test and escape the hold, which is the same silent pass. Config, CI and tooling files are source files.
3. **The mutation exemption ("pure refactor or docs-only") never applies to a section with a behavior change.** Both prompts say so.
4. **After the hold (issue review point 3).** The hold message asks the person to choose one of three answers:
   - **The behavior exists.** The person closes the child issue. No PR is opened, because the implementer did not commit or push.
   - **Tests only.** The implementer adds regression tests, names the allowing comment in the PR body, and transitions to `review`. The review accepts this tests-only diff. The mutation step is exempt for it, because the tests pass on the base version by design.
   - **The behavior is missing.** The person names what is missing, and the implementer implements it as usual.
5. **How the review spots an earlier hold.** It looks for a no-change hold: an issue comment that starts with `Factory ran build/implement.`, contains the fixed phrase "The code already has the behavior", and whose `factory-record` line has `"statuses":["needs-input"]`.
   - The fixed phrase tells this hold apart from other implement holds, for example the TS 7 decision on #77.
   - The record format was checked on #77: `<!-- factory-record v3 {... "statuses":["needs-input"], ... "reason":"hold" ...} -->`.
   - If the diff has no source change, no person allowed tests only, and such a hold exists, the review requests `needs-input` instead of going back to `implement`. That stops a loop between the two states.
6. **Tool facts are cited at the config ref that the target pins (issue review point 5).**
   - Every target's `biome.json` is only `{"extends": ["@lorenzh/pulse-config/biome.json"]}` (for example `.repos/api/biome.json` 2). The real scope is in `.repos/config/biome.json` 8-17.
   - CI steps come from `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` (`.repos/api/.github/workflows/ci.yml` 17). The steps are at `.repos/config/.github/workflows/check.yml` 22-38 (bun-version `1.4.0` at 24).
   - The pin is in `.repos/api/package.json` 23. The config clone is a shallow `main` and does not contain that SHA.
   - So the rule reads the pinned file with `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=<sha>" --jq .content | base64 -d`. This command was tried in this run for `biome.json` at `51e95b0…`: it returned the same `files.includes` lines as the clone.
7. **Rule (c) is in all four prompts (issue review point 7).** In `plan-review.md` it is a check that every acceptance check names a literal or an independent source. That makes the grep criterion satisfiable. Its wording allows comparing artifacts that are produced independently: `git diff --exit-code -- dist` after a build (`.repos/config/.github/workflows/check.yml` 36), and served bytes against `public/` (point 8).
8. **The diff is the exact text.** It was generated with `diff -u` from `main` at `94f026b`. The prompts have not changed since then (`git diff 94f026b HEAD -- .factory/prompts` is empty). It was checked with `git apply --check`, and with `npx factory validate` on a patched copy of the repository.

## Required behavior

- `implement.md`:
  - A new section `## No source change` defines "requires a behavior change" and "source file".
  - When the section requires a behavior change and the implementer finds no defect and changes no source file, it does not transition to `review` and does not commit or push. It requests a `needs-input` hold instead.
  - The hold message starts with "The code already has the behavior that the section asks for." and states four things: what the spec asked (section and line), what was found (file and line), the command or test that shows the current behavior already matches (with its result line), and the question for the person.
  - The Outcome section repeats the ban on `review`. The mutation exemption does not apply to a behavior change.
  - A new checks item, "Independent expected values".
- `review.md`:
  - New steps 5 and 6 (behavior change and source change; where expected values come from).
  - Two new gates: no source change for a behavior change without allowance, and an expected value that comes from the file it checks.
  - A paragraph that turns the first gate into `needs-input` when an earlier no-change hold exists.
  - The mutation exemption is narrowed.
- `plan.md`: three new paragraphs: the `Behavior change:` line, tool-fact verification with file and line (config at the pinned ref), and where each acceptance check's expected value comes from.
- `plan-review.md`: checks the `Behavior change:` line, treats an unverified tool assumption as a defect (and repeats one citation itself), and flags an acceptance check that derives its expected value from the file it checks.
- Outcome contracts stay unchanged:
  - `implement` → `review` / `retry`.
  - `review` → `implement` / `security` / `complete`.
  - `plan` → `plan-review`.
  - `plan-review` → `plan` / `complete`.
  - Plus `needs-input` everywhere, the `verdict:` lines in `review.md`, and the files written.
- `npx factory validate` passes.

## Risks

- **A cosmetic source edit escapes the hold.** An implementer could touch a source file without changing behavior. The review still catches it: the mutation gate fails, because no new test fails on the base version for a behavior change.
- **Older specs without the `Behavior change:` line** fall back to judging the text. That is the current judgment, so these specs are no worse than today.
- **A section that is partly done already** (some behavior exists, some is missing) is not "no source change". The implementer changes the missing part, and the normal gates apply.
- **Prompts get longer.** implement grows from 92 to 128 lines, review from 90 to 118, plan from 71 to 99, plan-review from 51 to 61. That adds a few hundred input tokens per run.
- **Rebase.** If another prompt PR merges before this one is applied, `git apply` fails. The person then applies the hunks by hand. The text in "Changes in meta" is the reference.
- **Tool citations go stale** when config moves its pin later. A citation is valid for the plan's run only. Implementers still run the checks themselves.

## Acceptance evidence

Each check below states its expected value as a literal.

1. **Base unchanged.** Before applying, on `main`:
   ```sh
   sha256sum .factory/prompts/implement.md .factory/prompts/review.md .factory/prompts/plan.md .factory/prompts/plan-review.md docs/factory.md
   ```
   prints exactly:
   ```
   26705a4a9a70adc8433c78f8a3b7780dffcc39b85f78379458b134ca9887e74f  .factory/prompts/implement.md
   f00d0138edaf4c3953d78900d5efdfbbc94254b570ade2253a7ef0e5ca0a41b8  .factory/prompts/review.md
   9c343f1576d173ac4be1c5ba917af5cb1e985f318d47fa4cb411d0971ed54565  .factory/prompts/plan.md
   9158fecec4bac0d7fd4b71764f162ca432a6d22b05dce43efc7006016132d17b  .factory/prompts/plan-review.md
   4763a60620180e376786d342a8d5e66266649936584a60f2fac4e2ce048eb49f  docs/factory.md
   ```
   If a hash differs, a prompt changed after this spec. Apply the hunks by hand.
2. **Apply and validate.**
   ```sh
   awk '/^````diff$/{f=1;next} /^````$/{f=0} f' .factory/work/482/plan.md > /tmp/482.diff
   git apply --check /tmp/482.diff && git apply /tmp/482.diff
   npx factory validate
   ```
   The last command prints `Valid: pulse-meta has 3 workflow(s) and 8 state(s).`. `git diff --stat` reports `5 files changed, 109 insertions(+), 7 deletions(-)`. `git diff --quiet -- .factory/config.yaml .github` exits 0.
3. **Grep evidence (paste into the PR).** Run in `.factory/prompts`:
   - (a): `grep -c 'Behavior change:' implement.md review.md plan.md plan-review.md` gives `1`, `1`, `1`, `2`. `grep -n 'The code already has the behavior' implement.md review.md` gives one line per file. `grep -n 'diff changes no source file' review.md` gives 2 lines (the gate and the hold paragraph).
   - (b): `grep -n 'bunfig.toml' plan.md plan-review.md` gives one line per file. `grep -n "verify it in that repository's files" plan.md` gives line 60. `grep -n 'unverified tool assumption' plan-review.md` gives line 48. `grep -n 'ref=<sha>' plan.md` gives 1 line.
   - (c): `for f in implement.md review.md plan.md plan-review.md; do echo "$f $(grep -c 'derives its' $f)"; done` prints `1` for each of the four files. The `review.md` hit is under `## Gates` (`## Gates` at line 71, hit at line 82).
4. **Contracts unchanged.**
   - `grep -n '^verdict:' review.md` gives exactly `verdict: ship` and `verdict: fix first`.
   - `grep -o 'Transition to `[a-z-]*`' implement.md plan.md` gives `review` and `plan-review`.
   - No new status name: `grep -o 'status `[a-z-]*`' implement.md review.md | sort -u` prints only `` `needs-input` `` lines.
5. **Failing-before check (a), by the person.** It needs two runs on the same child issue: one with the old prompts, one with the new.
   - `factory-run.yml` reads the prompts from the default branch (`.github/workflows/factory-run.yml` 107-109). So the old run must happen **before** the prompt PR merges.
   - The test feature asks for a behavior that api already has. api `GET /healthz` answers 200 with body `ok\n` and `text/plain` (`.repos/api/src/start.test.ts` 199-202, route at `.repos/api/src/server.ts` 314-316).
   - Steps:
     1. Open a meta feature issue "Factory test #482: api GET /healthz answers 200 ok". Its spec has one section `## Repository: api` with `Behavior change: yes`, which asks that `GET /healthz` answer 200, body `ok\n`, content type `text/plain`. Run `spec`, merge the spec PR (or commit the spec on `main`), and let fan-out open the api child.
     2. **Old prompts:** run `build` on the child. Expected: `implement` transitions to `review`, and `review` ends with `complete` (or `security` → `complete`). Record the run link. Close the api PR without merge. If the old run holds by itself instead, the check shows nothing: note that in the comment and try once more.
     3. Apply this spec's diff and merge the prompt PR.
     4. Start the child again on the new prompts: `factory start --issue <child> --workflow build --apply`. Expected: `implement` ends with status `needs-input`. Its comment starts with "The code already has the behavior that the section asks for." and names `start.test.ts` (or the command run) with its result line. No new commits are on the branch.
     5. Answer "the behavior exists" and close the child issue and the test feature.
   - The comment on #482 links both runs. `lorenzh/todo-cli` and `lorenzh/snake-cli` could not be resolved with this run's token. If the person uses them instead, they copy the four new prompts into that repository's Factory config for the new run.
6. **(b) and (c) on the next real spec.** The next `plan` run after the merge writes `Behavior change:` lines, and tool facts with file and line. Nothing to run now. The grep evidence in item 3 is the check.

## Performance impact

None expected: only agent prompt text changes. No code in api, probe, status or notify changes, so no metric of `bench/budgets.json` can move. Agent runs read about 35 more prompt lines per state.

## Security impact

Security impact: no. Only prompt text and one docs sentence change. No workflow, CI, dependency, token handling or agent permission changes, and the rules add only stricter gates and holds.

## Rollout order

One repository: only pulse-meta changes.

- Factory runs that are in flight keep the prompt text they started with. Later runs read the new prompts from `main`.
- Child issues of specs written before this one have no `Behavior change:` line. The new prompts handle them with the text fallback (Decision 1).

## Counterexamples

1. **Section with `Behavior change: yes` that the code already has**, for example api `/healthz` 200 `ok\n`. The implementer changes nothing. Wrong: it transitions to `review`. Right: a `needs-input` hold whose message starts with "The code already has the behavior that the section asks for.".
2. **Same section, but the implementer adds only a passing test in `src/start.test.ts`.** Wrong: the review treats a test as a source change, or uses the mutation exemption, and returns `complete`. Right: the review gate "diff changes no source file" holds. That means `implement`, or `needs-input` if a no-change hold exists.
3. **Same section after the person wrote "tests only, please" below the hold.** Wrong: the review sends it back because the regression tests pass on the base version. Right: the review sees the allowance and the mutation step is exempt. With no other gate, the result is `complete`.
4. **An earlier implement hold for another reason** (for example the TS 7 decision on #77, without "The code already has the behavior"). Wrong: the review treats it as a no-change hold and requests `needs-input`. Right: that hold does not count, so the gate gives `implement`.
5. **Section with `Behavior change: no` (docs-only) and a docs-only diff.** Wrong: the no-source-change gate fires. Right: no gate, and the mutation exemption applies.
6. **A plan says "Biome ignores `dist/`" and cites only `api/biome.json`.** That file only `extends` config. Right: the citation names `config/biome.json` 12 at the pinned ref `51e95b0…`. Otherwise plan-review flags an unverified tool assumption and transitions to `plan`.
7. **A plan says "CI runs Bun 1.3".** The pinned `check.yml` says `bun-version: 1.4.0` (line 24 in the clone). A plan-review that repeats the citation must flag the mismatch.
8. **A test that computes `sha256(readFile("public/app.js"))` and compares it with the sha256 of the same file.** It can never fail. The review gate holds → `implement`.
9. **A test that imports the route list from `src/server.ts` (the array around line 190) as its expected value and checks the router against it.** The expected list comes from the code under test, so it is a defect. Right: the test writes the list out as literals.
10. **`bun run build && git diff --exit-code -- dist`, or served bytes compared with `public/index.html`.** Two artifacts produced independently, so this is allowed. Wrong: the reviewer flags it under rule (c).

## Contract fields

New names. All are prompt text, none is a contract or config key:

- The spec line `Behavior change: yes|no`. `grep -rn 'Behavior change' .repos/contract/src .repos/config .factory/prompts .factory/config.yaml` → no hits (count 0). Under `.factory/work`, only `482/issue-review.md` contains it.
- The hold phrase "The code already has the behavior". `grep -rn 'already has the behavior' .repos/contract/src .repos/config .factory/prompts` → no hits (count 0).
- The heading `## No source change` in `implement.md`. It is a new heading within that file only.

No new status, transition, label or route.

## Changes in meta

A person applies this after the spec merges, with `git apply` (Acceptance evidence 2), on a branch, as a PR to `main`. The PR body carries the grep evidence (Acceptance evidence 3) and later the link to the failing-before comment (Acceptance evidence 5). Unified diff against `main` at `94f026b`:

````diff
--- a/.factory/prompts/implement.md
+++ b/.factory/prompts/implement.md
@@ -18,6 +18,29 @@
 released its change yet, or if the work needs a material decision, request a hold with status
 `needs-input`. State what the person must resolve.
 
+## No source change
+
+The section requires a behavior change when its line `Behavior change:` says `yes`. A section
+without that line (a spec written before it existed) requires one when its required behavior
+describes new or changed behavior. A source file is a file that ships or runs the behavior: not a
+test, fixture, or doc. A diff that only adds or changes tests, fixtures, or docs is no source
+change.
+
+When the section requires a behavior change and you find no defect and change no source file, do
+not transition to `review`, and do not commit or push. Request a hold with status `needs-input`.
+Its message starts with "The code already has the behavior that the section asks for." and
+states:
+
+1. what the spec asked: the section and the line of the spec that you read;
+2. what you found: the file and line that already has the behavior;
+3. the command or test that shows the current behavior already matches, with its result line;
+4. the question for the person: close this issue because the behavior exists, allow a change with
+   only regression tests, or name the behavior that is still missing.
+
+After the person answers in the issue comments, follow the answer. For a change with only
+regression tests, add tests that pin the behavior, name the comment that allows it in the pull
+request body, and transition to `review`. For a missing behavior, implement it as usual.
+
 Keep changes within the section. Do not write `.factory/` or any other notes into this repository.
 
 ## Checks and evidence
@@ -45,7 +68,18 @@
    At least one of those tests must fail per behavior change, with an assertion about that
    behavior (not an unrelated setup error). If every test passes on the base version, the tests do
    not prove the change: fix them. A pure refactor or a docs-only change is exempt; say so and why.
-3. **Security checklist.** For every item that the change touches, name the test or the command
+   This exemption never applies to a section that requires a behavior change. A change with only
+   regression tests that a person allowed (see "No source change") is exempt: its tests pass on
+   the base version by design. Say so and name the comment.
+3. **Independent expected values.** A new or changed check never derives its expected value from
+   the file or code that it checks. Do not read the expected hash, list, count, or snapshot from
+   the file under test, and do not regenerate it from the code under test in the same run: such a
+   check can never fail. Write the expected value as a literal in the test, or take it from an
+   independent source that the spec names. Comparing two artifacts that are produced
+   independently is allowed (for example `git diff --exit-code -- dist` after a build, or served
+   bytes against the file in `public/`). The rule covers new and changed checks; it does not
+   rewrite existing tests.
+4. **Security checklist.** For every item that the change touches, name the test or the command
    that proves it holds:
    - secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) never
      reach errors, logs, or responses;
@@ -89,4 +123,6 @@
 in the outcome message.
 
 Transition to `review` when the change, its checks, and the pull request body are complete.
+Never transition to `review` without a source change for a section that requires a behavior
+change, unless a person allowed a change with only regression tests (see "No source change").
 Use `retry` only when useful work remains for another fresh run.
--- a/.factory/prompts/review.md
+++ b/.factory/prompts/review.md
@@ -40,10 +40,24 @@
    # Run only the new or changed tests in "$tmp" with the repository's test command.
    ```
 
-   A pure refactor or a docs-only change is exempt; say so and why.
-5. Read the pull request body (`gh api repos/<owner>/<repo>/pulls/<n> --jq .body`) and compare it
+   A pure refactor or a docs-only change is exempt; say so and why. This exemption never applies
+   to a section that requires a behavior change. A change with only regression tests that a person
+   allowed in an issue comment is exempt: its tests pass on the base version by design.
+5. Decide whether the section requires a behavior change: its line `Behavior change:` says `yes`,
+   or, in a section without that line, its required behavior describes new or changed behavior.
+   Then decide whether the diff changes a source file: a file that ships or runs the behavior, not
+   a test, fixture, or doc. A diff that only adds or changes tests, fixtures, or docs is no source
+   change. An earlier no-change hold is an issue comment that starts with
+   `Factory ran build/implement.`, contains "The code already has the behavior", and whose
+   `factory-record` line has `"statuses":["needs-input"]`.
+   A person allowed a change with only regression tests when a comment of a person after that hold
+   says so.
+6. For every new or changed check, find where its expected value comes from: a literal in the
+   test, or an independent source that the spec names. It must not be read from, or regenerated
+   from, the file or code that the check checks.
+7. Read the pull request body (`gh api repos/<owner>/<repo>/pulls/<n> --jq .body`) and compare it
    with the acceptance evidence that the spec section asks for.
-6. Go through the security checklist for every item the change touches:
+8. Go through the security checklist for every item the change touches:
    - secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) never
      reach errors, logs, or responses;
    - authentication runs before any other check, and status codes follow the spec order;
@@ -61,11 +75,25 @@
 - a defect that you proved with a failing test or command;
 - a required check fails, or the pull request's CI is red, still running, or timed out (a timeout
   means not ready);
-- no new or changed test fails on the base version for a behavior change (the mutation step);
+- no new or changed test fails on the base version for a behavior change (the mutation step; a
+  change with only regression tests that a person allowed is exempt);
+- the section requires a behavior change and the diff changes no source file, and no person
+  allowed a change with only regression tests;
+- a new or changed check derives its expected value from the file or code that it checks (for
+  example a test that reads the expected hash or list from the file it validates), so it can
+  never fail. Comparing two artifacts that are produced independently is allowed (for example
+  `git diff --exit-code -- dist` after a build, or served bytes against the file in `public/`);
 - acceptance evidence that the spec asks for is missing from the pull request body, or a check that
   the spec names was not run (including the compose end-to-end test);
 - a security checklist item that the change touches has no test or command that proves it.
 
+When the diff changes no source file for a section that requires a behavior change, no person
+allowed a change with only regression tests, and an earlier no-change hold exists, request a hold
+with status `needs-input` instead of transitioning to `implement`. Its message names the hold
+comment, the section line that asks for the behavior change, what the diff contains, and the
+question for the person: close the issue, allow a change with only regression tests, or name the
+missing behavior.
+
 Include each finding with its proof (the failing test, the command and its output) and the failed
 checks in the outcome message.
 
--- a/.factory/prompts/plan.md
+++ b/.factory/prompts/plan.md
@@ -51,6 +51,34 @@
 behavior, checks, and completion evidence of that repository's task. Leave out every repository that needs no change. Order the sections so that a repository
 comes after the repositories it needs.
 
+The line after the `Files:` list is exactly `Behavior change: yes` or `Behavior change: no`,
+followed by a one-line reason. Write `no` only for a pure refactor or a change of tests or docs
+alone. Every other task is `yes`, including a change of tooling or CI files. With `yes`, the
+implementer requests a hold instead of a review when it finds that the code already has the
+behavior.
+
+Before a repository section relies on a tool fact, verify it in that repository's files and cite
+file and line in the section. Tool facts are: a tool or runtime version, which linter, formatter,
+or type checker runs, the Biome include or ignore scope, a test runner flag, and a CI step. The
+files are `package.json` (`scripts`, `packageManager`, `engines`, devDependency pins such as
+`@biomejs/biome`), `biome.json`, `bunfig.toml` (`[test]`), and the CI workflow
+(`.github/workflows/ci.yml`). When the target file only points to config (a `biome.json` that
+`extends` `@lorenzh/pulse-config/biome.json`, a CI job that `uses`
+`lorenzh/pulse-config/.github/workflows/check.yml@<sha>`), cite the config file and line too, at
+the ref that the target pins in `package.json` or `ci.yml`. The config clone is `main` and can be
+newer than that pin. Read the pinned file with
+`gh api "repos/lorenzh/pulse-config/contents/<path>?ref=<sha>" --jq .content | base64 -d`, and
+say whether it differs from the clone. A tool fact without such a citation is an assumption:
+verify it or leave it out.
+
+Every acceptance check states where its expected value comes from: a literal in the check (a
+status code, a count, a hash written out), or an independent source that the spec names (a
+published hash, an upstream release, a separate build). An acceptance check never derives its
+expected value from the file it checks: an expected value that is read from, or regenerated from,
+the file or code under test in the same run makes a check that can never fail. Comparing two
+artifacts that are produced independently is allowed (for example `git diff --exit-code -- dist`
+after a build, or served bytes against the file in `public/`).
+
 Create the artifact directory if needed. Write the spec to
 `{{variables.work_directory}}/{{issue.id}}/plan.md`.
 
--- a/.factory/prompts/plan-review.md
+++ b/.factory/prompts/plan-review.md
@@ -39,7 +39,17 @@
   for at least one name yourself.
 
 Check that every repository section starts with a `Files:` list and that the files exist in the
-clone or are marked as new. Check the spec against itself: flag two statements that cannot both
+clone or are marked as new. Check that the line after it is `Behavior change: yes` or
+`Behavior change: no` with a reason, and flag `no` for a section that asks for new or changed
+behavior. Check every tool fact that a section relies on (a tool or runtime version, which
+linter, formatter, or type checker runs, the Biome include or ignore scope, a test runner flag, a
+CI step): it cites file and line in the target's `package.json`, `biome.json`, `bunfig.toml`, or CI
+workflow, and in config at the ref that the target pins when the target file `extends` or `uses`
+config. An unverified tool assumption is a defect. Repeat the check for at least one cited tool
+fact yourself. Check that every acceptance check names a literal expected value or an independent
+source for it. Flag an acceptance check that derives its expected value from the file it checks
+(read from, or regenerated from, the file or code under test in the same run): it can never fail.
+Check the spec against itself: flag two statements that cannot both
 hold (for example "never runs inside a request" and "runs on the first read").
 
 If either file is missing, transition to `plan` with a concise message.
--- a/docs/factory.md
+++ b/docs/factory.md
@@ -12,7 +12,7 @@
 
 ## Quality gates and failure reports
 
-**Build review gates.** The `review` state (`.factory/prompts/review.md`) sends a change back to `implement` when any of these holds: a defect proved by a failing test or command, red or unfinished CI on the pull request (`gh pr checks --watch`, 15-minute limit), new tests that also pass on the base version of the changed source files (the mutation step; refactors and docs are exempt), acceptance evidence missing from the pull request body, or a security checklist item without a test or command. It reads the whole diff, and it cannot return `complete` without that. Its outcome message ends with `verdict: ship` or `verdict: fix first`.
+**Build review gates.** The `review` state (`.factory/prompts/review.md`) sends a change back to `implement` when any of these holds: a defect proved by a failing test or command, red or unfinished CI on the pull request (`gh pr checks --watch`, 15-minute limit), new tests that also pass on the base version of the changed source files (the mutation step; refactors and docs are exempt), acceptance evidence missing from the pull request body, a section with `Behavior change: yes` and no source change (only tests, fixtures, or docs) without a person's approval, a new check whose expected value comes from the file or code it checks, or a security checklist item without a test or command. When the implementer finds that the code already has the behavior, it requests a `needs-input` hold instead of a review; after such a hold the review holds too. It reads the whole diff, and it cannot return `complete` without that. Its outcome message ends with `verdict: ship` or `verdict: fix first`.
 
 **Spec sections.** `plan` writes four sections before the repository sections, and `plan-review` sends the spec back when one is missing, empty, or contradicts the behavior: `## Security impact` (first line `Security impact: yes` or `no`, with a reason), `## Rollout order` (merge order and the older consumers on old pins at each step), `## Counterexamples` (one per hard rule; statistics defined exactly, never an average of percentiles), and `## Contract fields` (each new name with the search that shows no collision). Each repository section starts with a `Files:` list.
 
````

Resulting line counts: `implement.md` 128, `review.md` 118, `plan.md` 99, `plan-review.md` 61.
