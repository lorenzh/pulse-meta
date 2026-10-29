# AGENTS.md

pulse-meta is the meta repository of pulse (uptime monitor and status page). Overview, repositories and local run: `README.md`.

## What lives here
- Feature issues, specs (`.factory/work/<issue>/plan.md`, `targets.json`), Paragon Factory config (`.factory/config.yaml`, `.factory/prompts/`) and runner workflows (`.github/workflows/factory*.yml`).
- No product code. Never change a target repository by hand from here: write a feature issue and let Factory build it.
- Targets: `contract`, `probe`, `api`, `status`, `notify`, `config` (`lorenzh/pulse-<name>`). Their code conventions are in each target's `AGENTS.md`.

## How a feature flows
1. A person opens a feature issue here.
2. `factory start --issue <n> --workflow spec --apply` runs `issue-review`, `plan`, `plan-review`; the result is a spec PR here.
3. Merging the spec PR approves the spec. `factory-fan-out.yml` opens one child issue per target in `targets.json`, linked as "blocked by" along `dependsOn`, and starts those that wait for nothing.
4. Each child runs `build` (`implement`, `review`) in its target and opens a PR with `Closes lorenzh/pulse-meta#<child>`.
5. A person merges the target PRs. `factory-unblock.yml` starts the waiting children and closes the feature when all are done.
- Merge conflict on a child: a person runs `factory start --issue <child> --workflow merge --apply`.
- A `needs-input` hold means the agent waits for a decision from a person in the issue comments.

## Writing a feature issue
Match the closed issues (for example #65):
- Intro paragraph: what and why.
- `## What it must do`: bullet list of required behavior, per target where it matters.
- `## Constraints`: what must not change.
- `## Done when`: one observable check.

Lessons:
- A plan sees only `main` of each target at its start, not features still in flight.
- If a feature builds on another, say so: name the issue, what it provides and what must not be redone.
- Link that dependency as a native GitHub "blocked by", not only in the body.

## Changing Factory config
- Manage `.factory/config.yaml` with the `factory` CLI (`factory target add`), then run `npx factory validate`.
- A new target's `context` must list the repositories it builds on (always `meta`, usually `contract`; `api` when it calls the API).
- Add a new target to the `meta` target's `context` too, so specs can read it.
- Prompt changes go in `.factory/prompts/*.md`; keep the outcome contracts (transitions, `needs-input`) intact.

## Commands
| Task | Command |
|------|---------|
| Install | `npm ci` (needs `GITHUB_PACKAGES_TOKEN` for `@paragondata` packages, see `.npmrc`) |
| Validate config | `npx factory validate` |

## Rules
- Public repository: no secrets, tokens or private details in issues, specs or config.
