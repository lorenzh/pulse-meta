# Spec: #854 status: fix the Compose links in status and console docs

## Goal

The status and console docs still send operators to a whole-stack Compose file in pulse-api.
That file is gone: `git -C .repos/api ls-files compose.yaml compose.yml docker-compose.yml`
prints nothing at api `a7e9c84`. The whole stack now lives in pulse-deploy, setup `full`
(`full/compose.yaml`). This change corrects five documentation passages in two repositories
so that each one names pulse-deploy, the `full` setup and its actual Compose file, and so that
every port description matches `full/compose.yaml`.

Spec #528 deferred these references explicitly (`.factory/work/528/plan.md:436-437`). The issue
review (`.factory/work/854/issue-review.md`) resolved every open point as an assumption; this spec
adopts them unchanged.

## Evidence on the recorded base

Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/854` answers
`HTTP 404`, so no findings exist yet. Nothing below relies on a finding.

Inspected clone heads (evidence only; each child records its own implementation base):

| Repository | HEAD |
| --- | --- |
| status | `b3a29d5873b56f34de847dfb53a11f5d6d48b2a7` |
| console | `574742314cfdbf14f126fe5e571e14ae104bfc2a` |
| deploy | `9853c6dfc0f2b6acc8584a2e4c5311cece8db885` |
| api | `a7e9c844f659b9ae536b60cca145cbd5b9d3efba` |
| config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` |

Stale passages (verbatim at the recorded heads):

- status `README.md:59`: "pulse-api's repository has a Compose file that starts the whole stack
  with `docker compose up`."
- status `docs/install.md:3`: "... The pulse-api repository also has a Compose file that starts
  the whole stack, including this page."
- console `README.md:70`: "... In the pulse Compose stack (pulse-api `compose.yaml`) the console
  is published on host loopback only."
- console `docs/configuration.md:101-103`: section "In the pulse Compose stack", "In pulse-api's
  `compose.yaml`, `PULSE_CONSOLE_PORT` is also the Compose variable for the host port. Compose
  does not pass `.env` values into the container, ..."
- console `docs/index.md:15`: "[pulse-api configuration](...), the service that the console will
  call, and the Compose variables of the stack."

Independent source of truth: pulse-deploy `main` (`9853c6d`).

- `README.md:8`: the `full` setup is "api, probe, status, notify, console", started with
  `docker compose -f full/compose.yaml up -d`.
- `full/README.md:3`: `full` "replaces pulse-api's former `compose.yaml`".
- `full/README.md` headings: `## Start, stop, reset` (line 20, anchor `#start-stop-reset`) and
  `## Variables` (line 61, anchor `#variables`). Start: `scripts/init-secrets.sh` once
  (line 23), then `docker compose -f full/compose.yaml up -d` (line 24).
- `full/compose.yaml:67-68`: status `ports: "${PULSE_STATUS_PORT:-8080}:8080"` (all interfaces).
- `full/compose.yaml:92-94`: console `ports: "127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082"`
  ("Admin UI: loopback only").
- `full/compose.yaml:31-46` with `common/services.yaml:7-13`: api has no `ports:`; `full/README.md:10`
  says "none (not published)".
- `common/services.yaml:29-30,48-49`: status and console get `PULSE_API_URL: http://api:3000`
  through `extends`.
- Neither `full/compose.yaml:62-99` nor `common/services.yaml:24-51` passes `PULSE_STATUS_PORT`
  or `PULSE_CONSOLE_PORT` into a container; `full/README.md:69-70` and `full/.env.example:8-11`
  say the same ("Host port ... Not passed into the container").
- Container ports: status `src/settings.ts:191` default 8080, `Dockerfile` exposes 8080;
  console `src/settings.ts:11` default 8082, `Dockerfile:9,16` sets `PULSE_CONSOLE_HOST=0.0.0.0`
  and exposes 8082.

Other deploy setups are not the destination: `minimal` has no status or console, `dev` builds
sibling checkouts, `demo` publishes status on loopback. api `bench/compose.bench.yaml` is a
benchmark file, not a stack.

## Scope

- status: `README.md`, `docs/install.md`.
- console: `README.md`, `docs/configuration.md`, `docs/index.md`.

The issue named three passages; the documentation inventory (below) found two more with the same
stale claim (status `docs/install.md:3`, console `docs/index.md:15`). They are in scope.

## Non-goals

- No change to runtime code, tests, Dockerfiles, CI, package files, lockfiles, tool config or
  `AGENTS.md`/`CLAUDE.md` in either target.
- No change in pulse-deploy or pulse-api. Stack Compose files are not restored in pulse-api.
- No website change. The website renders status and console docs pinned by SHA
  (`website/docs.config.json:31-43,76-81`) and keeps the old text until a later pin bump; that
  bump is separate work (#528 deferred the website too).
- No general prose cleanup of unrelated passages; no change to container ports, the console's
  loopback publishing, or the image bind address.

## Required behavior

Shared rules for every corrected passage:

1. It names pulse-deploy, the setup `full` and the file `full/compose.yaml`, with navigable links:
   - `https://github.com/lorenzh/pulse-deploy/blob/main/full/compose.yaml`
   - `https://github.com/lorenzh/pulse-deploy/blob/main/full/README.md` (optionally with
     `#start-stop-reset` or `#variables`; no other anchor).
   A link to the pulse-deploy repository root alone is not enough.
2. It no longer says or implies that pulse-api holds the whole-stack Compose file or its variables.
   Links to pulse-api docs stay only where they describe the api service itself (install,
   configuration of the api).
3. Any start command states that it runs from a pulse-deploy checkout, names
   `scripts/init-secrets.sh` as the one-time prerequisite and uses
   `docker compose -f full/compose.yaml up -d`. A bare `docker compose up` is not left as a
   command.
4. Port descriptions match `full/compose.yaml`:
   - status: host port `${PULSE_STATUS_PORT:-8080}` on all interfaces → container port 8080.
   - console: host `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}` (loopback only) → container port 8082;
     inside the container the console listens on `0.0.0.0:8082` (image default).
   - api: not published on the host; status and console reach it at `http://api:3000`.
   - The host port variables are Compose interpolation only: `full` does not pass them into the
     container. Do not write the broad claim "Compose does not pass `.env` values into the
     container".
5. Text in English, short plain sentences (status `AGENTS.md:92`, console `AGENTS.md:96`).

Per passage:

- status `README.md:59`: replace with: the `full` setup of pulse-deploy starts the whole stack,
  including this page; from a pulse-deploy checkout run `scripts/init-secrets.sh` once, then
  `docker compose -f full/compose.yaml up -d`; the page is published on host port
  `${PULSE_STATUS_PORT:-8080}` on all interfaces and listens on 8080 in the container; the api is
  not published. Links per rule 1.
- status `docs/install.md:3`: keep the first sentence and its pulse-api install link; replace the
  second sentence with: the `full` setup of pulse-deploy starts the whole stack, including this
  page, from `full/compose.yaml`. Links per rule 1. Port wording is optional here; if present it
  follows rule 4.
- console `README.md:70`: keep everything before the last sentence. Replace
  "(pulse-api `compose.yaml`)" with the `full` setup of pulse-deploy and its `full/compose.yaml`
  link, and keep "published on host loopback only", naming
  `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}` → container port 8082.
- console `docs/configuration.md:101-103`: the heading may stay or become
  "In the pulse-deploy `full` setup". The paragraph names `full` and links both URLs of rule 1;
  says `PULSE_CONSOLE_PORT` is also the Compose variable for the host port and that `full` does not
  pass it into the container, so the container listens on the image default `8082` and the host
  port `${PULSE_CONSOLE_PORT:-8082}` on `127.0.0.1` maps to it; says `full` sets
  `PULSE_API_URL: http://api:3000` and the api has no published host port. The pulse-api
  configuration link goes, or stays only as a reference for the api service itself.
- console `docs/index.md:15`: keep the pulse-api configuration link as "the service that the
  console will call"; move "the Compose variables of the stack" to a separate bullet that links
  pulse-deploy `full/README.md#variables` (and `full/compose.yaml`).

## Documentation inventory

Search run on the clones at the recorded heads, repeated by each child on its implementation base:

```sh
rg -n -i '\bcompose\b|\bstacks?\b|PULSE_(STATUS|CONSOLE)_PORT|808[02]|:3000|pulse-api|docker-compose' \
  README.md docs
```

| Hit | Disposition |
| --- | --- |
| status `README.md:59` | Changed. |
| status `docs/install.md:3` | Changed (second sentence only). |
| console `README.md:70` | Changed (last sentence only). |
| console `docs/configuration.md:101,103` | Changed. |
| console `docs/index.md:15` | Changed (split into two bullets). |
| status `README.md:22,30,48,51` | Unchanged and still true: source default port, components need, standalone Docker run and env handling (`src/settings.ts:191`, `Dockerfile`). |
| status `docs/install.md:11,17,20,24,28` | Unchanged and still true: source and standalone image instructions. |
| status `docs/configuration.md` (`PORT`, `PULSE_API_URL`) | Unchanged and still true: service settings (`src/settings.ts:191`). |
| status `docs/operation.md:47` | Unchanged and still true: `full/compose.yaml:66` and deploy `dev/compose.yaml` set `PULSE_STATUS_SHOW_CHECKS: "true"`. |
| status `docs/development.md`, `docs/theming.md`, `docs/troubleshooting.md`, `docs/index.md` | Unchanged and still true: local source examples and API service links; no stack ownership claim. |
| console `README.md:7` | Unchanged and still true: `full` has five application services. |
| console `README.md:25,29` | Unchanged and still true: pulse-deploy generates the key; owner recovery already uses `<setup>/compose.yaml`. |
| console `README.md:47,50,56,65,77` | Unchanged and still true: source default 8082 and standalone loopback publish examples (`src/settings.ts:11`, `Dockerfile:9,16`). |
| console `docs/configuration.md:77` and service settings | Unchanged and still true: describe the service, not the stack. |
| console `docs/development.md:90` | Unchanged and still true: names deploy `dev/compose.yaml`, which exists. |
| console `docs/tokens.md`, `docs/checks.md` probe Compose snippets | Unchanged and still true: generated per-probe files, not the stack. |
| console `docs/incidents.md` "composer" | Not a deployment claim. |

Changed documents: exactly the five files of the scope. Every other tracked file is protected.

## Risks

- A link to a non-existent anchor renders but does not jump. Only `#start-stop-reset` and
  `#variables` are allowed; both match headings in deploy `full/README.md:20,61`.
- Copying another setup's ports (demo publishes status on loopback, dev publishes api) would be
  wrong for `full`. Counterexamples below reject it.
- Over-correction: rewriting the console's in-container `0.0.0.0:8082` statement as loopback would
  be wrong; the loopback binding is the host side.
- pulse-deploy can move files later. The links target `main`; acceptance checks them against a
  fresh pulse-deploy `main` at implementation time.
- Website keeps rendering the old pinned text until its pin bump (non-goal).

## Performance impact

None expected: only Markdown files change; no source, dependency, image or test input changes, so
none of the api `bench/budgets.json` metrics (startup CPU, load CPU, idle or peak RSS, test CPU,
build CPU, wall-clock startup, p95 latency, requests per second, image size) can move. Do not run
the Docker bench (#834). A test-CPU delta, if reported, is information only, from interleaved
base/branch runs.

## Security impact

Security impact: no
Markdown documentation only; no auth, parser, probe client, file write, log text, dependency,
Dockerfile or CI change, and the documented loopback-only publishing of the console stays.

## Rollout order

Two repositories, independent. status and console each correct their own docs and link to files
that already exist on pulse-deploy `main`; neither needs the other merged. No release is needed:
docs are read from `main`. Older consumers are unaffected: images, Compose setups and api are
unchanged, and the website keeps its pinned older text until a separate pin bump.

## Counterexamples

Each must be rejected by review and, where a grep can see it, by the acceptance checks.

- status passage says "the status page is published on `127.0.0.1:8080`" or "loopback only":
  wrong; `full/compose.yaml:68` publishes `${PULSE_STATUS_PORT:-8080}:8080` on all interfaces
  (that loopback form is the `demo` setup).
- any passage says `full` publishes the api on port 3000 or `localhost:3000`: wrong; the api has no
  `ports:` in `full` (`full/README.md:10`).
- console passage says the console listens on `127.0.0.1` inside the container: wrong; the image
  sets `0.0.0.0` (`Dockerfile:9`), loopback is the host binding.
- `PULSE_CONSOLE_PORT=18082` in `full/.env`: correct text says the host port becomes 18082 on
  `127.0.0.1` and the container still listens on 8082. A text that says the console then listens
  on 18082 in the container is wrong. Same for `PULSE_STATUS_PORT=18080` → host 18080, container
  8080.
- a passage that links only `https://github.com/lorenzh/pulse-deploy` (root) or `minimal/`,
  `demo/` or `dev/`: rejected; rule 1 requires `full/compose.yaml` and `full/README.md`.
- a passage that links `.../full/README.md#setup` or any anchor other than `#start-stop-reset`
  or `#variables`: rejected.
- a start command `docker compose up` (no `-f full/compose.yaml`) or one that omits
  `scripts/init-secrets.sh`: rejected.
- the text "Compose does not pass `.env` values into the container": rejected (overbroad).
- a passage that links api `bench/compose.bench.yaml`: rejected.
- a diff that also touches `docs/operation.md`, `AGENTS.md`, `bunfig.toml`, a test or a new file:
  rejected by the exact-list scope checks.

No statistics are involved.

## Contract fields

No new names. No field, key, setting, route or environment variable is added or renamed; the
passages only cite existing names (`PULSE_STATUS_PORT`, `PULSE_CONSOLE_PORT`, `PULSE_API_URL`),
which already exist in deploy `full/.env.example:9,11` and `common/services.yaml:30,49`.

## Common acceptance (both repositories)

`T` is the target checkout, `BASE` the implementation base recorded before the first edit
(`git rev-parse HEAD` on a clean `main`), `ALLOWED` the sorted file list of that section,
`DEPLOY` a fresh clone of `https://github.com/lorenzh/pulse-deploy` at `main` made at
implementation time (an independent source; record its SHA).

A1. Stale claims gone (expected value: the literal patterns; exit 1 = no match):

```sh
grep -n -i -E "pulse-api('s)? (repository|repo)[^.]*compose|pulse-api('s)? \`?compose\.ya?ml|Compose variables of the stack|Compose does not pass \`?\.env|docker compose up\`" $ALLOWED
# expect exit 1
```

On the recorded heads this grep matches all five stale passages (status `README.md:59`,
`docs/install.md:3`; console `README.md:70`, `docs/configuration.md:103`, `docs/index.md:15`) and
exits 0, so it fails on the base for the stated reason. Run it on `BASE` and on `HEAD`.

A2. Required links present: each changed file prints a count ≥ 1 for
`https://github.com/lorenzh/pulse-deploy/blob/main/full/compose.yaml` and for
`https://github.com/lorenzh/pulse-deploy/blob/main/full/README.md`
(`grep -c -F '<url>' <file>`; console `README.md` needs only the `full/compose.yaml` link).
Every `pulse-deploy` URL in the diff matches
`^https://github.com/lorenzh/pulse-deploy/blob/main/full/(compose\.yaml|README\.md(#start-stop-reset|#variables)?)$`
(extract with `git diff "$BASE" HEAD | grep -o 'https://github.com/lorenzh/pulse-deploy[^) ]*' | sort -u`).

A3. Links resolve against the independent source: `git -C "$DEPLOY" cat-file -e HEAD:full/compose.yaml`
and `git -C "$DEPLOY" cat-file -e HEAD:full/README.md` exit 0;
`grep -n -x '## Start, stop, reset' "$DEPLOY/full/README.md"` and
`grep -n -x '## Variables' "$DEPLOY/full/README.md"` each print one line (only for anchors used).

A4. Port literals against the independent source: `grep -c -F '"${PULSE_STATUS_PORT:-8080}:8080"' "$DEPLOY/full/compose.yaml"`
prints `1`; `grep -c -F '"127.0.0.1:${PULSE_CONSOLE_PORT:-8082}:8082"' "$DEPLOY/full/compose.yaml"`
prints `1`; `grep -n -E '^\s+PULSE_(STATUS|CONSOLE)_PORT:' "$DEPLOY/full/compose.yaml" "$DEPLOY/common/services.yaml"`
exits 1 (the host port variables are not passed into a container). If any of these fails, the
deploy setup moved: stop and request a hold with `needs-input`. Then the reviewer compares every
port statement in the changed passages with the rule-4 literals and the counterexamples.

A5. Scope, three states separately, after the last commit:

```sh
diff <(git diff --name-only "$BASE" HEAD | sort) <(printf '%s\n' $ALLOWED | sort)   # exit 0
test -z "$(git diff --name-only --cached)"                                          # index empty
test -z "$(git diff --name-only)"                                                   # worktree empty
test -z "$(git status --porcelain)"                                                 # no untracked
git ls-tree -r --name-only "$BASE" | grep -v -x -F -f <(printf '%s\n' $ALLOWED) > /tmp/protected
xargs -a /tmp/protected -d '\n' git diff --exit-code "$BASE" HEAD --                 # exit 0
```

The protected list is the full complement of `ALLOWED` in `git ls-tree -r --name-only "$BASE"`:
it includes every unchanged doc, `AGENTS.md`, `CLAUDE.md`, `Dockerfile`, `src/`, tests, scripts,
`package.json`, `bun.lock`, `biome.json`, `bunfig.toml`, `tsconfig.json` and `.github/`. An
aggregate `git diff "$BASE"` never replaces these checks.

A6. Prove A5 with a disposable fixture: a separate `git clone` of the target into a temp
directory (never the working checkout), with no helper committed. Show, each with the exit code:
an allowed docs-only commit passes all of A5; a committed protected change (e.g. `AGENTS.md`)
fails the base-to-HEAD list and the protected diff; a staged protected change fails the index
check; an unstaged protected change fails the worktree check; an untracked file fails the status
check; stage a protected change then `git restore --worktree --source="$BASE"` it (index check
still fails); commit a protected change then `git restore --worktree --source="$BASE"` it
(base-to-HEAD checks still fail). Delete the fixture clone before the final A5 run.

A7. `git diff --check "$BASE" HEAD` exits 0. `bun run check` (lint, typecheck, test with the
repository coverage threshold from `bunfig.toml`) exits 0 at handoff. Record it on `BASE` first
(three runs, exit code and pass count); this spec claims no baseline result. If it fails on
`BASE` too, report the failure as unrelated with its output; never change tests or tool config to
pass. No new test file and no focused `bun test` run is needed: the evidence is A1-A4.

A8. Documentation inventory: rerun the inventory search on `BASE` and on `HEAD`; report the final
line numbers of the five changed passages and confirm every other hit is unchanged (covered by A5).

A9. PR body: added comments "none" (no code or test file changes), stated after reading every
added line. The PR body contains `Closes lorenzh/pulse-meta#<child>`.

## Repository: status

Files:
- `README.md`
- `docs/install.md`

Behavior change: no
Documentation only: the passages now point to the existing pulse-deploy `full` setup.

Both docs that `AGENTS.md:87-88` names as owners of how to run the repository are in the list;
`README.md` changes because the run instructions for the whole stack change location.

Tool facts (cited):
- Bun `1.4.0`: `package.json:9` (`engines.bun`) and `package.json:38` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test`: `package.json:19`;
  `lint` = `biome check . && pulse-eslint . && pulse-workflows`: `package.json:15`. Done rule:
  `AGENTS.md:22`.
- Biome `2.6.3`: `package.json:23`. `biome.json:2` extends `@lorenzh/pulse-config/biome.json`,
  pinned via `package.json:24` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. At that pin
  (`gh api .../contents/biome.json?ref=04108fa...`) the file is identical to the config clone
  (`bc87049`): `files.ignoreUnknown: true` and `includes: ["**", ...]` (config `biome.json:8-17`).
  Biome 2.6 has no Markdown support, so `.md` files are skipped as unknown; the change does not
  depend on Biome.
- Tests: `bunfig.toml:1-4`, `coverage = true`, line threshold 0.8. No test reads `README.md` or
  `docs/` (`grep -rl 'README\|docs/' --include='*.ts' --include='*.sh'` finds none at `b3a29d5`).
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa...`; that file at the pin (identical to
  the clone) runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run test` (pinned `check.yml:25-38`).

Steps:
1. Record `BASE`; rerun the inventory search (A8).
2. Edit `README.md:59` and `docs/install.md:3` per Required behavior.
3. Commit; run A1-A9 with `ALLOWED="README.md docs/install.md"`.

Completion evidence: A1 exit 1; A2 counts ≥ 1 in both files (both URLs); A3/A4 against the
recorded deploy SHA; the README passage states `${PULSE_STATUS_PORT:-8080}`, all interfaces,
container 8080 and the api not published; A5-A7 exit codes; inventory with final line numbers.

## Repository: console

Files:
- `README.md`
- `docs/configuration.md`
- `docs/index.md`

Behavior change: no
Documentation only: the passages now point to the existing pulse-deploy `full` setup.

`AGENTS.md:91-92` makes `README.md` and `docs/configuration.md` the owners of settings; both are in
the list, with the docs index.

Tool facts (cited):
- Bun `1.4.0`: `package.json:9` and `package.json:35`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test`: `package.json:18`;
  `lint`: `package.json:15`. Done rule: `AGENTS.md:26`.
- Biome `2.6.3`: `package.json:23`; `biome.json:2` extends the shared config pinned via
  `package.json:24` at `04108fa...`, identical to the clone (see status). Markdown is not linted.
- Tests: `bunfig.toml:1-4`, line threshold 0.8. No test reads `README.md` or `docs/` (same grep,
  none at `5747423`).
- CI: `.github/workflows/ci.yml:18` uses the same pinned `check.yml` (steps at pinned
  `check.yml:25-38`). The `deploy-dev` job (`ci.yml:231-289`) uses deploy `dev/compose.yaml` and
  is unaffected by docs.

Steps:
1. Record `BASE`; rerun the inventory search (A8).
2. Edit `README.md:70` (last sentence), `docs/configuration.md:101-103` and `docs/index.md:15` per
   Required behavior.
3. Commit; run A1-A9 with `ALLOWED="README.md docs/configuration.md docs/index.md"`.

Completion evidence: A1 exit 1; A2 counts (both URLs in `docs/configuration.md`; `full/README.md`
link in `docs/index.md`; `full/compose.yaml` link in `README.md`); A3/A4 against the recorded
deploy SHA; the README still says the image listens on `0.0.0.0:8082` and that `full` publishes
the console on host loopback only; `docs/configuration.md` states host
`127.0.0.1:${PULSE_CONSOLE_PORT:-8082}` → container 8082, that `full` does not pass
`PULSE_CONSOLE_PORT` into the container, `PULSE_API_URL: http://api:3000` and the unpublished
api; A5-A7 exit codes; inventory with final line numbers.
