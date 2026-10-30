# Factory and contributing

pulse is built by Paragon Factory agents from issues in this repository. Do not change a target repository by hand for a feature. Write an issue instead.

1. Open a feature issue here. [AGENTS.md](../AGENTS.md) says how to write one.
2. The `spec` workflow (`issue-review`, `plan`, `plan-review`) writes a spec in `.factory/work/<issue>/plan.md` and the target list in `targets.json`. The result is a spec pull request here.
3. Merge the spec pull request to approve the spec.
4. `factory-fan-out.yml` opens one child issue per target, linked as "blocked by" along `dependsOn`, and starts the children that wait for nothing.
5. Each child runs the `build` workflow (`implement`, `review`, and `security` when the spec says `Security impact: yes`) in its repository and opens one pull request that says `Closes lorenzh/pulse-meta#<child>`.
6. If the base branch conflicts, run `factory start --issue <child> --workflow merge --apply`.
7. Merge the pull requests. `factory-unblock.yml` starts waiting children and closes the feature when all are done.

## Quality gates and failure reports

**Build review gates.** The `review` state (`.factory/prompts/review.md`) sends a change back to `implement` when any of these holds: a defect proved by a failing test or command, red or unfinished CI on the pull request (`gh pr checks --watch`, 15-minute limit), new tests that also pass on the base version of the changed source files (the mutation step; refactors and docs are exempt), acceptance evidence missing from the pull request body, or a security checklist item without a test or command. It reads the whole diff, and it cannot return `complete` without that. Its outcome message ends with `verdict: ship` or `verdict: fix first`.

**Spec sections.** `plan` writes four sections before the repository sections, and `plan-review` sends the spec back when one is missing, empty, or contradicts the behavior: `## Security impact` (first line `Security impact: yes` or `no`, with a reason), `## Rollout order` (merge order and the older consumers on old pins at each step), `## Counterexamples` (one per hard rule; statistics defined exactly, never an average of percentiles), and `## Contract fields` (each new name with the search that shows no collision). Each repository section starts with a `Files:` list.

**Security state.** When the spec says `Security impact: yes`, the reviewer moves a clean change to `security` instead of `complete` (Factory has no conditional transitions, so the reviewer chooses). `security` (`.factory/prompts/security.md`, reviewer profile) runs the code locally, sends hostile inputs for each checklist item that applies, and records a test or command with its output for each. A finding goes back to `implement`; otherwise it completes. A spec without the section counts as `no`.

**Implementer evidence.** `implement` (`.factory/prompts/implement.md`) runs every acceptance check of its spec section, including the compose end-to-end test, runs the mutation step, and writes the results into the pull request body through `gh api -X PATCH` (`gh pr edit` fails on the token scopes). In its first run it opens the draft pull request itself. Build targets do not commit `.factory/`, so the pull request body is the only place for the evidence.

The security checklist covers secrets and server texts in errors, logs and responses; auth order and status codes; body and size limits on every method; input validation at trust boundaries, with validators that never throw; accessor and getter execution; SSRF, redirects and header forwarding; atomic, path-safe file writes; and dependency pins.

**Reviewer profile.** Both roles run on Claude (`.factory/config.yaml`, `models`): the worker on `claude-opus-5-5` at effort `medium`, the reviewer on `claude-opus-5-5` at effort `high`, with an adversarial prompt.

**Agent CLI versions.** `factory-run.yml` installs Claude Code at the version in `FACTORY_CLAUDE_VERSION` (`latest` by owner decision; `2.1.314` when unset) and skips the Codex CLI, which no model in the loop uses. The repository variables `FACTORY_CLAUDE_VERSION` and `FACTORY_CODEX_VERSION` accept only an exact `MAJOR.MINOR.PATCH`, `latest` or `skip`. The step "Install agent CLIs" fails on anything else, such as a range or a `v` prefix.

**Failure comments.** When a job of `factory.yml`, `factory-run.yml`, `factory-fan-out.yml` or `factory-unblock.yml` fails, its last step comments on the issue with the run link, the failed step, and the command that starts it again. This also covers failures before the Factory claim, which leave no Factory comment.

**Sweeper.** `factory-sweep.yml` runs every 30 minutes. It comments once on each open issue that has a `factory/<workflow>/<state>` label, no open blocker, no hold, no active run, and no change for 60 minutes (repository variable `FACTORY_STALL_MINUTES`). An active run is any `factory-run.yml` run in status `in_progress`, `queued`, `waiting`, `requested`, or `pending`, found through every page of each status. It changes no labels and no claims. It does not comment again while its own or a failure comment is the last comment on the issue.

**Security audit issues.** `factory-security-audit.yml` opens one issue every Monday, for one target repository in rotation by ISO week (or the one picked on a manual run). The issue is labelled `security` and `target/<repo>` and asks for an audit of `main` with hostile inputs. It gets no `factory/` label, so nothing starts it; the lead decides how it runs. An open audit issue of the same repository blocks a new one.

**Workflow script tests.** `.github/workflow-tests/test.sh` runs the scripts of the sweeper and the audit workflow against fixtures with a stub `gh` (needs bash, jq, python3 with PyYAML).

## Prompt injection and credentials

**Remaining risk.** The issue title, body and every comment, from any author, reach the agent. The agent runs with `permissionMode: auto` and holds the bot token (`GH_TOKEN`, write access to every pulse repository) and the Claude OAuth token in its environment. A comment on an issue with a `factory/` label can therefore try to make the agent push code or leak a token. Filtering comments by author needs a Factory feature (paragondata/factory#292). Giving the token only to the Factory publish, not to the agent, needs another one (paragondata/factory#292 or the linked upstream issue). Both are open.

**What the workflows do now.** No checkout keeps credentials (`persist-credentials: false`). No step runs `gh auth setup-git` or `gh auth login`. Git gets the token only through `GIT_ASKPASS` on the steps that run Factory, so no git config and no gh file stores one. Every action is pinned by commit SHA. The report loads d3 with Subresource Integrity.

**Interim rule.** Only the repository owner applies `factory/` labels. Before a person starts or restarts a run (label, `factory start`, `admission=restart`), they read every comment that arrived since the last run, and they remove or answer any comment that asks the agent to do something outside the issue.

Each repository's `AGENTS.md` holds its code conventions (test-driven development, end-to-end tests, lint). Its `docs/development.md` shows the commands.

Back to the [index](index.md).
