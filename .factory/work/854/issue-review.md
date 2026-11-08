# Issue review: #854

Ready for `plan`. No decision from a person is needed.

## Request, instructions and prior decisions

Correct the status and console operator documentation that still assigns the
whole-stack Compose setup to pulse-api. This is documentation only; no runtime,
container, networking, dependency, CI or Compose configuration change is needed.

Read meta `AGENTS.md` and `README.md`, and the status, console and deploy
`AGENTS.md` files. The read-only target clones were inspected directly. Issue
#854 comments were fetched through GitHub: the only comment was the current
Factory claim, with no earlier decision or unresolved question. #528 is closed;
its recorded plan at `.factory/work/528/plan.md:432-437` explicitly defers the
status and console references. It also defers website work, which this issue does
not request. Do not reopen that migration or add website work.

## Recorded evidence

These are the inspected clone heads, not promises about future implementation
bases. Each child must record its own implementation base before editing.

| Repository | Inspected HEAD |
| --- | --- |
| meta | `76dde87c70f782688dab73b2e69d15221a20570e` |
| status | `b3a29d5873b56f34de847dfb53a11f5d6d48b2a7` |
| console | `574742314cfdbf14f126fe5e571e14ae104bfc2a` |
| deploy | `9853c6dfc0f2b6acc8584a2e4c5311cece8db885` |
| api | `a7e9c844f659b9ae536b60cca145cbd5b9d3efba` |

- `git -C .repos/api ls-files compose.yaml compose.yml docker-compose.yml`
  returns no paths. The remaining `bench/compose.bench.yaml` is not a stack
  replacement and must not become the documentation destination.
- deploy `full/README.md:3` says that `full` replaces pulse-api's former
  `compose.yaml`. `full/compose.yaml` exists, names the project `pulse`, and has
  api, probe, status, notify and console, plus the secrets initializer.
- deploy `full/compose.yaml:62-68`: status publishes
  `${PULSE_STATUS_PORT:-8080}:8080`, on all interfaces.
- deploy `full/compose.yaml:82-94`: console publishes
  `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082`.
- deploy `full/compose.yaml:31-46` and `common/services.yaml:7-13`: api has no
  published host port. `common/services.yaml:24-30,43-49` sets
  `PULSE_API_URL: http://api:3000` for status and console through `extends`.
- Neither full's console environment nor its common service passes the host
  variable `PULSE_CONSOLE_PORT` into the container. The same separation holds
  for status's host variable `PULSE_STATUS_PORT`; its server setting is `PORT`.
  deploy `full/.env.example:8-11` and `full/README.md:69-70` agree.
- status `src/settings.ts:191` defaults to container port 8080 and its
  `Dockerfile:15` exposes 8080. console `src/settings.ts:11` defaults to 8082;
  its `Dockerfile:9,16` sets host `0.0.0.0` and exposes 8082. Changing a Compose
  host port does not change these container ports.
- `minimal` lacks status and console. `dev` builds sibling checkouts and
  publishes api on loopback; `demo` publishes status on loopback. These are
  distinct setups. Do not apply their port descriptions to `full`.

## Open points resolved as assumptions

1. Use `full` as the operator whole-stack destination. It is the documented
   replacement and contains both affected services. Link its setup instructions
   at `https://github.com/lorenzh/pulse-deploy/blob/main/full/README.md` and its
   actual Compose file at
   `https://github.com/lorenzh/pulse-deploy/blob/main/full/compose.yaml`.
   Each corrected passage must identify pulse-deploy, `full` and
   `full/compose.yaml`; a repository-root link alone is insufficient.
2. The three locations in the issue are examples, not an exhaustive inventory.
   The standing inventory rule requires two more corrections in the same two
   targets: status `docs/install.md:3` and console `docs/index.md:15`. Leaving
   them would continue sending operators to api for the moved stack.
3. Preserve the valid API install/configuration links where they explain the
   API service itself. In console's docs index, separate that link's service
   purpose from a deploy link for stack variables. No general prose cleanup.
4. Preserve loopback publishing means retain console's existing loopback
   description and all configuration bytes. It does not mean describe full's
   status page as loopback-only: full's status page publishes on all interfaces.
5. Explain host-port interpolation separately from container environment. Avoid
   the overly broad claim that Compose can never pass dotenv values into a
   container; the verified fact is that this setup does not forward the host
   port variable as a container setting.
6. Prefer short links to deploy's setup instructions over duplicating secret
   initialization or migration instructions. Any start command included must
   state that it runs from a pulse-deploy checkout and use
   `docker compose -f full/compose.yaml up -d`, with the documented initialization
   prerequisite. Do not leave plain `docker compose up` as a command to run
   from pulse-api or a service checkout.

## Exact documentation scope

status Files:

- `README.md`
- `docs/install.md`

Behavior change: no
Only the location of existing operator setup documentation changes.

console Files:

- `README.md`
- `docs/configuration.md`
- `docs/index.md`

Behavior change: no
Only references and descriptions of the existing Compose setup change.

The plan and child tasks must retain these exact file lists. Both READMEs are
included; console's named configuration document is included too. No README
exemption is needed. No deploy or api child is needed. The two children can
proceed independently because the referenced deploy setup already exists.

## Documentation inventory

Searched both targets' README and every file under `docs/` directly with:

```sh
rg -n -i '\bcompose\b|\bstacks?\b|PULSE_(STATUS|CONSOLE)_PORT|808[02]|:3000' .repos/status/README.md .repos/status/docs .repos/console/README.md .repos/console/docs
```

Also searched those locations for `pulse-api`, `api/compose` and
`docker-compose`. API endpoint, authentication and UI descriptions do not claim
ownership of the stack and remain untouched. Line numbers below refer to the
recorded heads. “Changed” is the required implementation disposition, not a
claim that this review edited target documentation.

| Hit | Disposition and proving line or source |
| --- | --- |
| status `README.md:59` | Changed: replace API ownership and ambiguous command with deploy full setup and Compose links. |
| status `docs/install.md:3` | Changed: same stale ownership claim; retain the valid API prerequisite link. |
| console `README.md:70` | Changed: replace API stack reference with deploy full links; retain container `0.0.0.0:8082` and loopback host publishing. |
| console `docs/configuration.md:101,103` | Changed: identify deploy full and link its actual file and setup instructions; preserve host interpolation, container 8082 and internal API URL. The heading may stay. |
| console `docs/index.md:15` | Changed: API docs remain a service reference; stack variables point to deploy full. |
| status `README.md:22,48,51` | Unchanged and still true: source defaults, standalone Docker publishing and environment handling, independently supported by `src/settings.ts:191`, `src/main.ts:33` and `Dockerfile`. |
| status `docs/install.md:11,17,20,24,28` | Unchanged and still true: source/standalone image instructions, not stack ownership; same source/default and Dockerfile evidence. |
| status `docs/configuration.md:7,8,41` | Unchanged and still true: `PORT` and API URL are server settings; see `src/settings.ts:191` and the explicit standalone example at line 41. |
| status `docs/development.md:9` | Unchanged and still true: explicit local source command, not Compose. |
| status `docs/operation.md:47` | Unchanged and still true: both deploy `full/compose.yaml:66` and `dev/compose.yaml:69` set `PULSE_STATUS_SHOW_CHECKS` to true. |
| status `docs/theming.md:95,102,103,104` | Unchanged and still true: local source example and requests use source defaults, not Compose host ports. |
| status `docs/troubleshooting.md:20,35` | Unchanged and still true: valid URL example and local proxy check; neither assigns stack ownership. |
| status `docs/index.md:14,15` | Unchanged and still true: API configuration and concepts links describe the upstream service. |
| console `README.md:7,16` | Unchanged and still true for these claims: full has five application services; generated probe Compose snippets are separate from the whole-stack file. |
| console `README.md:29` | Unchanged and still true: parameterized owner-recovery command already targets deploy's `<setup>/compose.yaml`. |
| console `README.md:47,50,56,65,77` | Unchanged and still true: source default 8082, standalone loopback publish examples, and the service listen-port setting; see `src/settings.ts:11,12,115,116` and `Dockerfile:9,16`. |
| console `docs/configuration.md:3,10,29,30,45,77,107` | Unchanged and still true: service port parsing/errors, URL example, token file and image defaults describe the service; they do not claim Compose owns or forwards those settings. |
| console `docs/development.md:9,12,77,78,90` | Unchanged and still true for these claims: local commands and image-test port descriptions are separate; line 90 already names deploy's `dev/compose.yaml`, which exists. |
| console `docs/tokens.md:185,186` | Unchanged and still true: generated per-probe Compose file and project command, not a replacement for the stack. |

Search hits for error “stack”, font “stack” or incident “composer” do not concern
deployment. No additional affected deployment claim was found. Re-run the
inventory on the implementation bases and report changed passages with final
line numbers. Protect every unchanged document, including status
`docs/configuration.md`, `docs/development.md`, `docs/index.md`,
`docs/operation.md`, `docs/theming.md`, `docs/troubleshooting.md`, and console
`docs/checks.md`, `docs/development.md`, `docs/incidents.md`,
`docs/maintenance.md`, `docs/team.md`, `docs/tokens.md`.

## Derived acceptance checks

1. Review the five changed passages against the independent deploy files above.
   Every corrected stack reference names pulse-deploy's `full` setup and actual
   `full/compose.yaml` and provides navigable links. Check destination paths and
   any anchor against the deploy checkout. No touched-target README/docs claim
   that pulse-api still owns the whole-stack Compose setup or its variables.
   Valid service-specific API links and generated probe snippets remain valid.
2. Compare the port prose with these literal expectations, independently
   established by deploy: status `${PULSE_STATUS_PORT:-8080}:8080`, all
   interfaces; console `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082`; API reachable
   inside the network at `http://api:3000` with no published host port in full.
   Changing host variables to 18080 and 18082 would change only the published
   ports, leaving container targets 8080 and 8082. Distinguish the console image
   bind address from its loopback host binding. Reject a description that says
   full publishes API 3000 or that its status page is loopback-only.
3. Enforce the exact allowed list separately in each child against its recorded
   `BASE`. After its last commit, `git diff --name-only "$BASE" HEAD` must equal
   that target's sorted file list above, not merely have an allowed extension.
   Both `git diff --name-only --cached` and `git diff --name-only` must be empty,
   and `git status --porcelain` must be empty. Also require
   `git diff --exit-code "$BASE" HEAD -- <protected files>` to pass. Protected
   files are every tracked base path outside the exact allowed list, including
   all unchanged docs, `AGENTS.md`, `CLAUDE.md`, `Dockerfile`, runtime sources,
   assets, tests, scripts, locks, package/tool configuration and CI. Enumerate
   this complement from `git ls-tree -r --name-only "$BASE"`; do not silently
   omit protected paths. The allowed-list check also rejects new extra files.
4. Demonstrate the scope checks with a disposable fixture, without committing a
   helper or modifying protected target files. Show an allowed docs-only commit
   passes with a clean index/worktree; an extra protected committed path fails
   the base-to-HEAD checks; an extra protected staged path fails the index
   check; an extra protected unstaged path fails the worktree check; an
   untracked path fails the status check. Include both concealment cases:
   stage a protected change then restore only its worktree to base (index still
   detected), and commit a protected change then restore only its worktree to
   base (HEAD still detected). An empty aggregate `git diff "$BASE"` must never
   substitute for these independent checks. Remove fixture artifacts before
   final scope validation.
5. Run `git diff --check` and each target's required `bun run check` at build
   handoff, per its `AGENTS.md`. No application regression test file, Docker
   startup or browser test is needed to demonstrate a Markdown link correction;
   the acceptance evidence is the independent documentation/configuration
   comparison. No test or tool configuration change is allowed to obtain a
   passing result. Report unrelated failures explicitly.

## Validation and standing-rule applicability

This issue-review performed source inspection and inventory only. No baseline
test suite, Compose deployment or performance benchmark has been run, and no
baseline pass count or coverage figure is claimed. The plan must not describe a
control as passing on its recorded base unless it actually passes three times,
with exit 0 and the expected pass count. Do not make a known-flaky file a
mandatory passing baseline control. If a focused Bun control is introduced,
verify its empty-config coverage-disabled invocation on the base; preserve the
repository coverage threshold in the full check. Any added regression check
must fail reliably on the base for the documented stale-reference reason.

Documentation-only scope needs no new test files or explanatory comments. If a
later state proposes a test file, reconcile the file list first and apply the
issue's reliable red/green requirements. Each new test file may carry only one
comment line naming its class and expected outcome. Read all added lines and
report every added comment, including inline comments, in the PR; say “none”
only after that read.

Runtime performance impact is none expected: no executable input changes. Do
not run the Docker bench (#834). If reporting test CPU measurements, use
interleaved base/branch runs and report the delta as information, without a
timing gate on this shared machine. No metrics or exact coverage expectation is
justified by this review.

## Review execution notes

The initial artifact-directory lookup confirmed `.factory/work/854` did not yet
exist. Creating this file creates the directory; the work directory is not
ignored. No target clone was edited. The cloud runtime skill was read; its
environment-status tool is not exposed in this session. This did not block the
local source reads or successful GitHub issue/comment reads.
