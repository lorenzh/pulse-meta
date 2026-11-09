# AGENTS.md

pulse-meta is the meta repository of pulse (uptime monitor and status page). Overview, repositories and local run: `README.md`.

## What lives here
- Feature issues, specs (`.factory/work/<issue>/plan.md`, `targets.json`), Paragon Factory config (`.factory/config.yaml`, `.factory/prompts/`) and runner workflows (`.github/workflows/factory*.yml`).
- The Factory report (`report/`): `data.mjs` builds `data.json` from the public issues, Actions runs and pull requests; the Factory workflow `report` writes `narrative.json`; `check.mjs` checks the text against the data; `index.html` is the fixed template. `factory-report-open.yml` opens the daily report issue, `factory-report.yml` publishes the merged report on GitHub Pages. See `docs/factory.md#factory-report`.
- No product code. Never change a target repository by hand from here: write a feature issue and let Factory build it.
- Targets: `contract`, `probe`, `api`, `status`, `notify`, `config`, `kit`, `website`, `console`, `deploy`, `agent` (`lorenzh/pulse-<name>`). Their code conventions are in each target's `AGENTS.md`.
- The common code convention is [docs/code-conventions.md](docs/code-conventions.md) (easy and reusable code); it applies to every target.
- Runtime dependencies in a target come only from [docs/approved-packages.md](docs/approved-packages.md).

## How a feature flows
1. A person opens a feature issue here.
2. `factory start --issue <n> --workflow spec --apply` runs `issue-review`, `plan`, `breakdown`, `plan-review`; the result is a spec PR here.
3. Merging the spec PR approves the spec. `factory-fan-out.yml` opens one child issue per target in `targets.json`, linked as "blocked by" along `dependsOn`, and starts those that wait for nothing.
4. Each child runs `build` (`implement` and `task-review` per task, then `review`) in its target and opens a PR with `Closes lorenzh/pulse-meta#<child>`.
5. A person merges the target PRs. `factory-unblock.yml` starts the waiting children and closes the feature when all are done.
- Merge conflict on a child: a person runs `factory start --issue <child> --workflow merge --apply`.
- A `needs-input` hold means the agent waits for a decision from a person in the issue comments.

## Writing a feature issue
Match the closed issues (for example #65):
- Intro paragraph: what and why.
- `## What it must do`: bullet list of required behavior, per target where it matters.
- `## Constraints`: what must not change.
- `## Done when`: one observable check.
- If a shared helper or module exists that the change must extend, name it.

Lessons:
- A plan sees only `main` of each target at its start, not features still in flight.
- If a feature builds on another, say so: name the issue, what it provides and what must not be redone.
- Link that dependency as a native GitHub "blocked by", not only in the body.

## Designs
- `design/<target>/` holds read-only exports of the design canvases: `design/website/` and `design/console/`. Read the README in each folder first: it lists the boards and the export version.
- The claude.ai artifacts are the source of truth; never edit the exported files by hand:
  - pulse Website: https://claude.ai/artifact/TTYEJrYqPVdDdEeYwwdhvA
  - pulse Console: https://claude.ai/artifact/LfbJQnnkNCF8VHGnTnYWnP
  - losoft (design system of the website): https://claude.ai/artifact/LpY9zNebhf9hVcb8cJwbwH
  - losoft App (design system of the console): https://claude.ai/artifact/1EbvYkD4WhfdNqD7HygC2q
- Each README records the artifact version and the design system version of the export, so a later change can be traced and diffed.
- The Console canvas marks v1 scope: boards whose title starts with "SH" ("SH · …" or "SH <n> · …") are v1 wherever they sit on the canvas. "Hosted, later" and "Later" boards are not a source for v1 work items.
- To check an export for drift or to update it, use the `syncing-designs` skill (`.agents/skills/syncing-designs/SKILL.md`; Claude with the Artifact tool only). A sync PR bumps the recorded versions and adds a "Changes in version <id>" section; Factory plans from the diff. Sync only when asked.

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
| Build the report numbers locally | `GH_TOKEN=<token> node report/data.mjs /tmp/data.json --previous report/data.json` |
| Check and test the report | `node report/check.mjs`, `node --test 'report/*.test.mjs'` |
| Test the workflow scripts | `bash .github/workflow-tests/test.sh` |

## Rules
- Public repository: no secrets, tokens or private details in issues, specs or config.
- Commit messages and PR bodies carry no AI attribution: no "Generated with" line, no session link, no Co-Authored-By or similar trailer. Factory agents get this rule from `.factory/prompts/preamble.md`.
