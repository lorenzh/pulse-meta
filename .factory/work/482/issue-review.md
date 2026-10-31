# Issue review #482: Factory prompts: no silent no-change, verified tool assumptions, independent expected values

Verdict: the feature can be specified. No question blocks it. This is a meta-only prompt change that a
person applies after the spec merges, as in #352, #377 and #455. The points below are for the plan to
settle.

No earlier decisions in the issue comments: the only comment is the claim of this run.

## Verified current state (on `main` of pulse-meta, `@paragondata/factory-cli` 0.8.0)

- The line counts in the issue match: `implement.md` 92, `review.md` 90, `plan.md` 71, `plan-review.md` 51.
  None of the three rules is present today:
  - (a) `implement.md` 91 transitions to `review` "when the change, its checks, and the pull request
    body are complete". Nothing covers a run that finds no defect and changes nothing. The mutation
    exemption ("A pure refactor or a docs-only change is exempt", `implement.md` 47, `review.md` 43)
    is the loophole: an empty or test-only diff has no "changed source files" to restore, so the
    mutation step does nothing. The `review.md` gates (57-67) have no gate for "no source change".
  - (b) `plan.md` 17-22 asks only for Performance impact, plus the four sections at 25-46 and the
    repository sections at 48-52. Nothing asks the plan to verify tools. `plan-review.md` 41-43 checks
    that `Files:` exist, but not tool claims.
  - (c) No prompt mentions where expected values come from.
- Outcome contracts (`.factory/config.yaml`): `implement` → `review`; `review` → `implement` |
  `security` (terminal, `complete`); `plan` → `plan-review`; `plan-review` → `plan` (terminal). The
  status `needs-input` has `source: agent` and needs no transition entry. The new rules use only
  these, so `config.yaml` stays unchanged.
- `npx factory validate` passes today ("Valid: pulse-meta has 3 workflow(s) and 8 state(s).", run
  from the outer checkout, where `node_modules` lives).
- Tool facts that rule (b) points at. All eight targets have `package.json`, `biome.json`,
  `bunfig.toml` and `.github/workflows/ci.yml`. But:
  - Each target's `biome.json` is only `{"extends": ["@lorenzh/pulse-config/biome.json"]}` (for
    example `api/biome.json`). The real `files.includes` scope (`!**/dist`, `!**/*.html`,
    `!**/test/fixtures`, ...) is in `config/biome.json` 8-17.
  - CI lint, typecheck, build and test come from the reusable workflow
    `lorenzh/pulse-config/.github/workflows/check.yml@<sha>` (`api/.github/workflows/ci.yml`), with
    the steps at `config/.github/workflows/check.yml` 26-38. The target's own `ci.yml` does not show
    them.
  - The targets pin config by SHA (`api/package.json` 23, `probe/package.json` 23:
    `github:lorenzh/pulse-config#51e95b0…`). The config clone is a shallow `main` (HEAD `01a57a7`),
    and the pinned SHA is not in it (`git log 51e95b0…` gives "bad object"). So the clone can differ
    from what the target actually runs.
- The Factory test repositories `lorenzh/todo-cli` and `lorenzh/snake-cli` cannot be resolved with
  this run's token (`gh repo view`: "Could not resolve"). They are private or do not exist. The plan
  cannot inspect them.
- Fan-out on a meta-only spec: in #455, `targets.json` = `[]` failed fan-out ("must be a nonempty JSON
  array"). The `FAN_OUT_PLAN_MISSING` path ends with a notice instead.

## Open points (for the plan, none blocks)

1. **targets.json for a meta-only spec.** There is no target section, so there is no child issue. Use
   the #455 precedent: write `[]` and tell the person to delete `.factory/work/482/targets.json` from
   the spec branch before the merge, or accept one failed fan-out run. The plan states which. Never
   list `meta`.
2. **"Source file" and "requires a behavior change" need definitions**, or (a) is ambiguous:
   - Source file: a non-test, non-doc file that ships or runs the behavior. A diff that only adds tests
     or docs counts as "no source change" for (a). Otherwise an implementer could add a passing test
     and escape the hold, which is the same silent pass.
   - How the implementer and reviewer know that a section requires a behavior change: from the
     section's required-behavior text, or from an explicit marker that `plan.md` adds to each
     repository section (for example a `Behavior change: yes|no` line, like `Security impact:`). A
     marker is deterministic but adds a plan rule and a plan-review check. Without one, the prompts
     must say "the section's required behavior describes new or changed behavior". The plan decides.
     If it adds a marker, older specs without it fall back to reading the text, as `review.md` 73-75
     does for `Security impact`.
   - The mutation exemption ("pure refactor or docs-only") must not apply to a section that requires a
     behavior change. Say so in both prompts.
3. **After the hold.** When a person answers "the behavior already exists, no change is needed", the
   prompts must say what follows. Otherwise the run loops between the implement hold and the review
   gate:
   - an empty diff gives no pull request (no commit to push), so the review cannot run. Recommended:
     the person closes the child issue, and the implementer does not transition. Or, if the person asks
     for tests only, the implementer adds the regression tests and transitions to `review`. The review
     then accepts a test-only diff when an issue comment of a person allows it. The plan picks one path
     and writes it into both prompts.
   - "needs-input when the implementer already held once": the reviewer finds this in the issue
     comments (Factory record comments with the hold, plus the person's answer). The text must name
     what the reviewer looks for.
4. **The `needs-input` hold content** (issue): what the spec asked (quote or cite the section line),
   what was found, the command or test with its output that shows the current behavior already
   matches, and the question. The prompt keeps the existing hold mechanism (`implement.md` 17-19) and
   adds this case to it. It adds no new status.
5. **Where tool facts live (b).** The verification rule must cover the indirection above: Biome scope
   via `extends` → `config/biome.json`; CI steps via the reusable `check.yml` in config; the pinned
   config ref versus the `main` clone. Suggested rule: cite the target file and line, and when the
   value comes from config, also cite the config file and line, noting whether the target pins the same
   ref (read the pinned version with `gh api repos/lorenzh/pulse-config/contents/<path>?ref=<sha>` when
   the clone is newer). Tool versions: `package.json` (`packageManager`/`engines`, devDependency pins
   such as `@biomejs/biome`), the `bun-version` in the workflow. Test runner flags: `bunfig.toml`
   `[test]` and the `test` script.
6. **plan-review (b).** An unverified tool assumption is a defect → transition to `plan`. The reviewer
   repeats the check for at least one cited tool claim, like the `## Contract fields` search
   (`plan-review.md` 38-39).
7. **Scope of (c) and a gap in the issue.** Required behavior lists (c) for `plan.md`, `implement.md`
   and `review.md`. The acceptance criterion asks for grep evidence of (b) and (c) in all four prompts,
   `plan-review.md` included. Assumption: add (c) to `plan-review.md` too, as a check that every
   acceptance check in the spec names a literal or an independent source. That keeps the grep
   criterion satisfiable and is still within the four prompts.
8. **Wording of (c), so that legitimate checks stay allowed.** "Derives its expected value from the
   file it checks" must not forbid comparing two independent artifacts. Examples in the targets: the
   `dist` check (`git diff --exit-code -- dist` after a build, `config/.github/workflows/check.yml`
   36) and served bytes compared with the `public/` files. Forbidden: the expected hash, list, count or
   snapshot is read from, or regenerated from, the file or code under test in the same run. The rule
   applies to new and changed checks. It does not rewrite existing tests.
9. **Exact text.** The spec gives the full new prompt text, or unified diffs against `main` at
   `94f026b`, for all four prompts. It must apply cleanly. If another prompt PR merges first, the
   person rebases the text by hand. Keep the house style: short sentences, numbered gates, the
   `verdict:` line in `review.md` unchanged.
10. **Failing-before acceptance (a).** It needs a run with the old prompt and a run with the new one on
    the same issue. pulse-meta's prompts only govern pulse-meta's targets. A pulse target issue works
    (a throwaway feature whose section asks for a behavior that the code already has, for example a
    section that asks api `GET /healthz`/`/readyz` to return what it already returns). The test repos
    use their own Factory config, so the person would have to copy the prompts there. The spec gives
    the steps (old run first, before the prompts are applied, or with `--prompts` from a ref if the
    CLI supports it). The person links both runs in an issue comment. This run cannot do it.
11. **Interaction with `security.md` and merge prompts.** Out of scope (non-goal). The new review gates
    come before the `security` decision (`review.md` 72-75) and do not change it.

## Assumptions

- No change to `.factory/config.yaml`, the workflows, `preamble.md`, `issue-review.md`,
  `merge-*.md` or `security.md`.
- (c) is also added to `plan-review.md` (open point 7).
- A test-only or doc-only diff counts as "no source change" for a section that requires a behavior
  change (open point 2).
- The meta target has no `build` workflow (`config.yaml`: `meta.workflows: [spec, merge]`), so the
  plan state does not edit `.factory/prompts/`. It writes only `plan.md` and `targets.json` under
  `.factory/work/482/`.

## Derived acceptance check

1. The spec (`.factory/work/482/plan.md`) has the exact new text for `implement.md`, `review.md`,
   `plan.md` and `plan-review.md`. It applies cleanly to `main` (`git apply --check` or a full-file
   replacement), and then `npx factory validate` prints "Valid: pulse-meta has 3 workflow(s) and 8
   state(s)." `config.yaml` is unchanged.
2. Grep evidence in the person's PR, one hit per file:
   - (a): `grep -n 'needs-input' implement.md` shows the no-change hold. `review.md` has a gate for "no
     source change" on a behavior-change section.
   - (b): `plan.md` and `plan-review.md` name `package.json`, `biome.json`, `bunfig.toml` and the CI
     workflow with "file and line".
   - (c): all four prompts carry the independent-expected-value rule, and `review.md` lists it under
     `## Gates`.
3. The transitions named in the four prompts are still exactly `review` / `retry` (implement),
   `implement` / `security` / `complete` (review), `plan-review` (plan) and `plan` / `complete`
   (plan-review), plus `needs-input`. The `verdict:` lines are unchanged.
4. Failing-before (person): on one test issue whose section asks for a behavior that the code already
   has, the old prompt reaches `review` and completes, and the new prompt ends in `needs-input`. The
   hold message states the spec ask, the finding with its command and output, and the question. An
   issue comment links both runs.
