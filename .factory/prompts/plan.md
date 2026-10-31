# Plan

Turn the feature request into a cross-repository spec.
{{#if workspace.contextDirectory}}
Read every repository cloned at `{{project.root}}/{{workspace.contextDirectory}}/<target>` before
you make claims about current behavior: each one is a target that a feature can change. File search
skips the clones, so list or read them directly.
{{/if}}
Read the issue comments for decisions and feedback from earlier runs.

Read the open points and the acceptance check of the issue review in
`{{variables.work_directory}}/{{issue.id}}/issue-review.md`.
If that file is missing, request a hold with status `needs-input`.

State the goal, scope, non-goals, required behavior, risks, and acceptance evidence.

Write a section headed `## Performance impact` before the repository sections. It names which
metrics of `bench/budgets.json` in the api repository the change can move (startup CPU, load CPU,
idle or peak RSS, test CPU, build CPU, and the reported ones: wall-clock startup, p95 latency,
requests per second, image size), in which direction and roughly how much, and how the
implementer measures it (for example a local `bun bench/run.ts --a <ref> --b <ref>` A/B). If the
change cannot move any of them, write "none expected" with a one-line reason. If `bench/` does not
exist yet in `main` of the api repository, name the kinds of metric instead of the keys.

Write these sections before the repository sections too. Every spec has all four:

- `## Security impact`. Its first line is exactly `Security impact: yes` or `Security impact: no`,
  followed by a one-line reason. Write `yes` when the change touches any of: admin routes or
  authentication; parsers or validators at a trust boundary (contract); the probe HTTP client, its
  headers or redirects; file writes; error or log texts that carry external data; dependencies;
  Dockerfiles; CI. With `yes`, name the checklist items that apply (secrets in errors, logs and
  responses; auth order and status codes; body and size limits; input validation; accessor
  execution; SSRF and redirects; atomic, path-safe writes; dependency pins). A `yes` adds a
  security state with hostile inputs after the review.
- `## Rollout order`. When the change crosses repositories, list the merge and release order and,
  for each step, which older consumers still run (probes and services on old pins of contract,
  kit, or config; status against an older api) and why they keep working. For one repository,
  write "one repository" with the reason.
- `## Counterexamples`. For every hard rule (limits, ordering, status codes, validation,
  statistics), give at least one input or case that the rule must reject or that a wrong
  implementation would get wrong. Define every statistic exactly: window, sample set, percentile
  method, rounding. Never average percentiles; say how they are computed from the samples.
- `## Contract fields`. List every new or renamed field, key, name, or route. For each, show the
  search of the contract and config clones that proves it does not collide with an existing name
  (for example `grep -rn '<name>' .repos/contract/src`).
  If there is none, write "no new names".

Then write one section per repository that must change, headed `## Repository: <target>` with
the target name of that repository, which is also its directory name in the context directory.
Each section starts with a `Files:` list of every file it creates or changes, then names the
behavior, checks, and completion evidence of that repository's task. Leave out every repository that needs no change. Order the sections so that a repository
comes after the repositories it needs.

The line after the `Files:` list is exactly `Behavior change: yes` or `Behavior change: no`,
followed by a one-line reason. Write `no` only for a pure refactor or a change of tests or docs
alone. Every other task is `yes`, including a change of tooling or CI files. With `yes`, the
implementer requests a hold instead of a review when it finds that the code already has the
behavior.

Before a repository section relies on a tool fact, verify it in that repository's files and cite
file and line in the section. Tool facts are: a tool or runtime version, which linter, formatter,
or type checker runs, the Biome include or ignore scope, a test runner flag, and a CI step. The
files are `package.json` (`scripts`, `packageManager`, `engines`, devDependency pins such as
`@biomejs/biome`), `biome.json`, `bunfig.toml` (`[test]`), and the CI workflow
(`.github/workflows/ci.yml`). When the target file only points to config (a `biome.json` that
`extends` `@lorenzh/pulse-config/biome.json`, a CI job that `uses`
`lorenzh/pulse-config/.github/workflows/check.yml@<sha>`), cite the config file and line too, at
the ref that the target pins in `package.json` or `ci.yml`. The config clone is `main` and can be
newer than that pin. Read the pinned file with
`gh api "repos/lorenzh/pulse-config/contents/<path>?ref=<sha>" --jq .content | base64 -d`, and
say whether it differs from the clone. A tool fact without such a citation is an assumption:
verify it or leave it out.

Every acceptance check states where its expected value comes from: a literal in the check (a
status code, a count, a hash written out), or an independent source that the spec names (a
published hash, an upstream release, a separate build). An acceptance check never derives its
expected value from the file it checks: an expected value that is read from, or regenerated from,
the file or code under test in the same run makes a check that can never fail. Comparing two
artifacts that are produced independently is allowed (for example `git diff --exit-code -- dist`
after a build, or served bytes against the file in `public/`).

Create the artifact directory if needed. Write the spec to
`{{variables.work_directory}}/{{issue.id}}/plan.md`.

Write the repositories to `{{variables.work_directory}}/{{issue.id}}/targets.json`: a JSON array
with one object per repository section, in section order, such as
`[{"name":"api","dependsOn":[]},{"name":"web","dependsOn":["api"]}]`.
Never list the meta repository itself: it holds the spec, and no child issue is opened for it.
`dependsOn` names only earlier entries, and only a repository whose released change this one
needs to build or pass its checks. Repositories that share an interface that the spec defines
need no dependency: each one implements its side of it. A dependency serializes work that could
otherwise run in parallel.

Write both files in your working directory. Keep them available to later states. Do not ignore
the work directory.

If the feature needs a material decision, request a hold with status `needs-input`.
State the decision in the outcome message.
Transition to `breakdown` when the spec can be executed and checked. The next state cuts each
repository section into tasks; do not write task files yourself.
