# Factory and contributing

pulse is built by Paragon Factory agents from issues in this repository. Do not change a target repository by hand for a feature. Write an issue instead.

1. Open a feature issue here. [AGENTS.md](../AGENTS.md) says how to write one.
2. The `spec` workflow (`issue-review`, `plan`, `plan-review`) writes a spec in `.factory/work/<issue>/plan.md` and the target list in `targets.json`. The result is a spec pull request here.
3. Merge the spec pull request to approve the spec.
4. `factory-fan-out.yml` opens one child issue per target, linked as "blocked by" along `dependsOn`, and starts the children that wait for nothing.
5. Each child runs the `build` workflow (`implement`, `review`) in its repository and opens one pull request that says `Closes lorenzh/pulse-meta#<child>`.
6. If the base branch conflicts, run `factory start --issue <child> --workflow merge --apply`.
7. Merge the pull requests. `factory-unblock.yml` starts waiting children and closes the feature when all are done.

## Quality gates and failure reports

**Build review gates.** The `review` state (`.factory/prompts/review.md`) sends a change back to `implement` when any of these holds: a defect proved by a failing test or command, red or unfinished CI on the pull request (`gh pr checks --watch`, 15-minute limit), new tests that also pass on the base version of the changed source files (the mutation step; refactors and docs are exempt), acceptance evidence missing from the pull request body, or a security checklist item without a test or command. It reads the whole diff, and it cannot return `complete` without that. Its outcome message ends with `verdict: ship` or `verdict: fix first`.

**Implementer evidence.** `implement` (`.factory/prompts/implement.md`) runs every acceptance check of its spec section, including the compose end-to-end test, runs the mutation step, and writes the results into the pull request body through `gh api -X PATCH` (`gh pr edit` fails on the token scopes). In its first run it opens the draft pull request itself. Build targets do not commit `.factory/`, so the pull request body is the only place for the evidence.

The security checklist covers secrets and server texts in errors, logs and responses; auth order and status codes; body and size limits on every method; input validation at trust boundaries, with validators that never throw; accessor and getter execution; SSRF, redirects and header forwarding; atomic, path-safe file writes; and dependency pins.

**Reviewer profile.** Both roles run on Claude (`.factory/config.yaml`, `models`): the worker on `claude-opus-5-5` at effort `medium`, the reviewer on `claude-opus-5-5` at effort `high`, with an adversarial prompt.

**Agent CLI versions.** `factory-run.yml` installs exact versions of the agent CLIs. The repository variables `FACTORY_CLAUDE_VERSION` and `FACTORY_CODEX_VERSION` override the defaults; `skip` leaves one out.

**Failure comments.** When a job of `factory.yml`, `factory-run.yml`, `factory-fan-out.yml` or `factory-unblock.yml` fails, its last step comments on the issue with the run link, the failed step, and the command that starts it again. This also covers failures before the Factory claim, which leave no Factory comment.

**Sweeper.** `factory-sweep.yml` runs every 30 minutes. It comments once on each open issue that has a `factory/<workflow>/<state>` label, no open blocker, no hold, no active run, and no change for 60 minutes (repository variable `FACTORY_STALL_MINUTES`). It changes no labels and no claims. It does not comment again while its own or a failure comment is the last comment on the issue.

Each repository's `AGENTS.md` holds its code conventions (test-driven development, end-to-end tests, lint). Its `docs/development.md` shows the commands.

Back to the [index](index.md).
